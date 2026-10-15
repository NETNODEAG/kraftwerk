import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { getOutputDir, workspaceRoot } from "./context.js";
import { perWorkspace } from "./workspace.js";
import { getAgent, listAgents, safeAgentSlug, agentsRoot } from "./agents.js";
import { chatAwaitingApproval, createChat, postMessage } from "./chat/sessions.js";
import { pushNotification } from "./notifications.js";
import { isIdentityString, localIdentity, readIdentity, identityString } from "./identity.js";
import { gitCommit, repoRootFor } from "./git.js";

/**
 * Routines: per-agent scheduled prompts — "message your agent every
 * weekday at 9". Definitions live next to the agent (git-tracked):
 *
 *   agents/<slug>/routines.yml    # list of { id, name, schedule, prompt, enabled }
 *
 * Runtime state (last run / last session / errors) is run-state, not
 * config, so it lives in <output>/routines-state.json. The scheduler is a
 * plain interval inside the inspector server: each due routine opens a new
 * session (chat) for the agent and posts the prompt — the run shows up in
 * the agent's sessions sidebar like any conversation. Schedules use
 * standard 5-field cron in the server's local time.
 *
 * The definitions travel with the workspace's git, the state does not, so a
 * workspace cloned on three machines would fire every routine three times.
 * Each routine therefore names its runner, `runs_on: <handle>@<machine>`
 * (see identity.ts), and the scheduler is strict: a routine fires only where
 * runs_on is exactly this machine's identity. No runs_on, no runner — an
 * unassigned routine fires nowhere until someone adopts it ("run these
 * here"), which writes runs_on and commits routines.yml so the other clones
 * learn who runs it. `private:` is stored and round-tripped; nothing reads it yet.
 */

export interface Routine {
  id: string;
  name: string;
  /** 5-field cron (min hour dom month dow) or @hourly/@daily/@weekly/@monthly. */
  schedule: string;
  prompt: string;
  enabled: boolean;
  /** The one identity (`handle@machine`) that fires it. Absent: unassigned, fires nowhere. */
  runsOn?: string;
  /** Stored as given; no behaviour yet. */
  private?: boolean;
}

/**
 * Who fires a routine, seen from this machine: here, on another identity,
 * or nobody (no runs_on).
 */
export type RoutineRunner = "here" | "elsewhere" | "unassigned";

export interface RoutineStatus extends Routine {
  runner: RoutineRunner;
  /** runs_on names an identity this machine had before (identity.json `previous`): a rename left it behind. */
  retired?: boolean;
  /** Only for an enabled routine that fires here. */
  nextRunAt?: string;
  lastRunAt?: string;
  lastChatId?: string;
  lastError?: string;
  /** The last run's session holds a permission request waiting for a human. */
  awaitingApproval?: boolean;
}

/* ---------- cron ---------- */

const ALIASES: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};

interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domStar: boolean;
  dowStar: boolean;
}

function parseField(spec: string, min: number, max: number, label: string): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`invalid ${label} field "${part}"`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`invalid step in ${label} field`);
    let lo = min;
    let hi = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b ?? (m[2] ? max : a); // "a/n" means a..max stepped; bare "a" is exact
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`${label} field out of range (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronSpec {
  const fields = (ALIASES[expr.trim()] ?? expr.trim()).split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("schedule must be 5 cron fields (min hour dom month dow) or an @alias");
  }
  const spec: CronSpec = {
    minute: parseField(fields[0], 0, 59, "minute"),
    hour: parseField(fields[1], 0, 23, "hour"),
    dom: parseField(fields[2], 1, 31, "day-of-month"),
    month: parseField(fields[3], 1, 12, "month"),
    dow: new Set(
      // 7 is an alias for Sunday (0)
      [...parseField(fields[4], 0, 7, "day-of-week")].map((v) => (v === 7 ? 0 : v))
    ),
    domStar: fields[2] === "*",
    dowStar: fields[4] === "*",
  };
  return spec;
}

function cronMatches(spec: CronSpec, d: Date): boolean {
  if (!spec.minute.has(d.getMinutes())) return false;
  if (!spec.hour.has(d.getHours())) return false;
  if (!spec.month.has(d.getMonth() + 1)) return false;
  const domOk = spec.dom.has(d.getDate());
  const dowOk = spec.dow.has(d.getDay());
  // Standard cron rule: if both day fields are restricted, either may match.
  if (!spec.domStar && !spec.dowStar) return domOk || dowOk;
  return domOk && dowOk;
}

/** Next matching instant after `from`, scanning up to 60 days; undefined if none. */
export function nextRun(schedule: string, from = new Date()): string | undefined {
  let spec: CronSpec;
  try {
    spec = parseCron(schedule);
  } catch {
    return undefined;
  }
  const d = new Date(from);
  d.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 60; i++) {
    d.setMinutes(d.getMinutes() + 1);
    if (cronMatches(spec, d)) return d.toISOString();
  }
  return undefined;
}

/* ---------- definition CRUD (agents/<slug>/routines.yml) ---------- */

async function routinesFile(slug: string): Promise<string> {
  return path.join(await agentsRoot(), safeAgentSlug(slug), "routines.yml");
}

function normalizeRoutine(raw: Record<string, unknown>): Routine | null {
  const id = String(raw.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    name: String(raw.name ?? id),
    schedule: String(raw.schedule ?? ""),
    prompt: String(raw.prompt ?? ""),
    enabled: raw.enabled !== false,
    ...(typeof raw.runs_on === "string" && raw.runs_on.trim() ? { runsOn: raw.runs_on.trim() } : {}),
    ...(typeof raw.private === "boolean" ? { private: raw.private } : {}),
  };
}

/** The file's own spelling: snake_case `runs_on`, optional keys only when set. */
function serializeRoutine(r: Routine): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    schedule: r.schedule,
    prompt: r.prompt,
    enabled: r.enabled,
    ...(r.runsOn ? { runs_on: r.runsOn } : {}),
    ...(r.private !== undefined ? { private: r.private } : {}),
  };
}

/** Why a runs_on value is refused, or undefined. */
function runsOnError(value: string): string | undefined {
  return isIdentityString(value) ? undefined : `runs_on must be <handle>@<machine> (lowercase letters, digits, ".", "_", "-"), got "${value}"`;
}

export async function listRoutines(slug: string): Promise<Routine[]> {
  let raw: unknown;
  try {
    raw = parse(await fs.readFile(await routinesFile(slug), "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => normalizeRoutine((r ?? {}) as Record<string, unknown>))
    .filter(Boolean) as Routine[];
}

async function writeRoutines(slug: string, routines: Routine[]): Promise<void> {
  await fs.writeFile(await routinesFile(slug), stringify(routines.map(serializeRoutine)));
}

export interface SaveRoutineInput {
  id?: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled?: boolean;
  /** Absent: kept as it is (a new routine gets this machine's identity). null or "": unassigned. */
  runsOn?: string | null;
  private?: boolean;
}

export async function saveRoutine(slug: string, input: SaveRoutineInput): Promise<Routine> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  if (!input.prompt?.trim()) throw new Error("prompt is required");
  parseCron(input.schedule); // throws with a useful message on a bad schedule
  const id =
    input.id?.trim() ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  if (!id) throw new Error("name must contain at least one letter or digit");
  const given = typeof input.runsOn === "string" ? input.runsOn.trim() : input.runsOn;
  if (given) {
    const err = runsOnError(given);
    if (err) throw new Error(err);
  }

  const routines = await listRoutines(slug);
  const i = routines.findIndex((r) => r.id === id);
  const existing = i >= 0 ? routines[i] : undefined;
  const runsOn = given === undefined ? (existing ? existing.runsOn : await localIdentity()) : given || undefined;
  const priv = input.private ?? existing?.private;
  const routine: Routine = {
    id,
    name,
    schedule: input.schedule.trim(),
    prompt: input.prompt,
    enabled: input.enabled !== false,
    ...(runsOn ? { runsOn } : {}),
    ...(priv !== undefined ? { private: priv } : {}),
  };
  if (i >= 0) routines[i] = routine;
  else routines.push(routine);
  await writeRoutines(slug, routines);
  return routine;
}

export async function deleteRoutine(slug: string, id: string): Promise<void> {
  const routines = await listRoutines(slug);
  await writeRoutines(slug, routines.filter((r) => r.id !== id));
}

/* ---------- runtime state (<output>/routines-state.json) ---------- */

interface RoutineState {
  lastMinute?: string;
  lastRunAt?: string;
  lastChatId?: string;
  lastError?: string;
}

const stateFile = (): string => path.join(getOutputDir(), "routines-state.json");

async function readState(): Promise<Record<string, RoutineState>> {
  try {
    return JSON.parse(await fs.readFile(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

async function writeState(state: Record<string, RoutineState>): Promise<void> {
  await fs.mkdir(getOutputDir(), { recursive: true });
  await fs.writeFile(stateFile(), JSON.stringify(state, null, 2));
}

/**
 * Whether a routine's prompt names a workflow: its slug or its name as a whole word
 * ("Run the daily-ceo-report workflow", "Run helpdesk workflow"). Routines are an
 * agent's prompts, so this is how a workflow learns it runs on a schedule.
 */
export function mentionsWorkflow(prompt: string, w: { slug: string; name?: string }): boolean {
  const text = prompt.toLowerCase();
  return [w.slug, w.name].some((n) => {
    if (!n?.trim()) return false;
    const esc = n.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9_-])${esc}($|[^a-z0-9_-])`).test(text);
  });
}

/** Every agent's routines with their run state, each with the workflows its prompt names (GET /api/routines). */
export async function allRoutines(workflows: { slug: string; name?: string }[]): Promise<(RoutineStatus & { agent: { slug: string; name: string; emoji: string }; workflows: string[] })[]> {
  const agents = (await listAgents()).filter((a) => !a.archived);
  const per = await Promise.all(
    agents.map(async (a) =>
      (await routineStatuses(a.slug).catch(() => [])).map((r) => ({
        ...r,
        agent: { slug: a.slug, name: a.name, emoji: a.emoji },
        workflows: workflows.filter((w) => mentionsWorkflow(r.prompt, w)).map((w) => w.slug),
      }))
    )
  );
  return per.flat();
}

/** Whether a routine fires on the machine whose identity is `me`: enabled and runs_on exactly that. */
export const firesHere = (r: Routine, me: string): boolean => r.enabled && r.runsOn === me;

export async function routineStatuses(slug: string): Promise<RoutineStatus[]> {
  const [routines, state, id] = await Promise.all([listRoutines(slug), readState(), readIdentity()]);
  const me = identityString(id);
  return routines.map((r) => {
    const s = state[`${slug}/${r.id}`] ?? {};
    const runner: RoutineRunner = !r.runsOn ? "unassigned" : r.runsOn === me ? "here" : "elsewhere";
    return {
      ...r,
      runner,
      ...(r.runsOn && id.previous.includes(r.runsOn) ? { retired: true } : {}),
      ...(firesHere(r, me) ? { nextRunAt: nextRun(r.schedule) } : {}),
      ...(s.lastRunAt ? { lastRunAt: s.lastRunAt } : {}),
      ...(s.lastChatId ? { lastChatId: s.lastChatId } : {}),
      ...(s.lastChatId && chatAwaitingApproval(s.lastChatId) ? { awaitingApproval: true } : {}),
      ...(s.lastError ? { lastError: s.lastError } : {}),
    };
  });
}

/* ---------- firing ---------- */

/** Open a fresh session for the agent and post the routine's prompt. */
async function fireRoutine(slug: string, routine: Routine): Promise<string> {
  const def = await getAgent(slug);
  if (!def) throw new Error(`agent "${slug}" not found`);
  const meta = await createChat({
    agent: def.harness,
    scope: { kind: "agent", slug: slug, routine: routine.id },
    title: `⏰ ${routine.name}`,
  });
  const { error } = await postMessage(meta.id, routine.prompt);
  if (error) throw new Error(error);
  return meta.id;
}

/** A routine could not even start (agent gone, harness missing): the bell says so. */
function notifyRoutineFailed(slug: string, routine: Routine, message: string): Promise<unknown> {
  return pushNotification({
    kind: "routine_failed",
    title: `⏰ ${routine.name} could not start`,
    body: message,
    href: `/agents/${slug}`,
    diagnose: { kind: "routine", agent: slug, routine: routine.id },
  }).catch(() => {});
}

export async function runRoutineNow(slug: string, id: string): Promise<{ chatId: string }> {
  const routine = (await listRoutines(slug)).find((r) => r.id === id);
  if (!routine) throw new Error("routine not found");
  const state = await readState();
  const key = `${slug}/${id}`;
  try {
    const chatId = await fireRoutine(slug, routine);
    state[key] = { ...state[key], lastRunAt: new Date().toISOString(), lastChatId: chatId };
    delete state[key].lastError;
    await writeState(state);
    return { chatId };
  } catch (err) {
    state[key] = { ...state[key], lastError: (err as Error).message };
    await writeState(state);
    void notifyRoutineFailed(slug, routine, (err as Error).message);
    throw err;
  }
}

/* ---------- scheduler ---------- */

/** The scheduler's timer, one per workspace. */
const scheduler = perWorkspace(() => ({ timer: null as ReturnType<typeof setInterval> | null }));

/**
 * The routines due at `now` that fire on this machine: enabled, runs_on
 * exactly this identity, cron matching. Everything else — unassigned,
 * another machine's, a retired identity's — is never due here.
 */
export async function dueRoutines(now: Date, me?: string): Promise<{ slug: string; routine: Routine }[]> {
  const identity = me ?? (await localIdentity());
  const out: { slug: string; routine: Routine }[] = [];
  for (const m of await listAgents()) {
    for (const r of await listRoutines(m.slug).catch(() => [] as Routine[])) {
      if (!firesHere(r, identity)) continue;
      try {
        if (cronMatches(parseCron(r.schedule), now)) out.push({ slug: m.slug, routine: r });
      } catch {
        // invalid schedule — surfaced by validation on save, skip here
      }
    }
  }
  return out;
}

async function tick(): Promise<void> {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const minuteKey = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;

  let due;
  try {
    due = await dueRoutines(now);
  } catch {
    return;
  }
  if (!due.length) return;
  const state = await readState();
  let dirty = false;

  for (const { slug, routine: r } of due) {
    const key = `${slug}/${r.id}`;
    if (state[key]?.lastMinute === minuteKey) continue;
    state[key] = { ...state[key], lastMinute: minuteKey };
    dirty = true;
    try {
      const chatId = await fireRoutine(slug, r);
      state[key] = { ...state[key], lastRunAt: now.toISOString(), lastChatId: chatId };
      delete state[key].lastError;
    } catch (err) {
      state[key] = { ...state[key], lastError: (err as Error).message };
      void notifyRoutineFailed(slug, r, (err as Error).message);
    }
  }
  if (dirty) await writeState(state);
}

/* ---------- runners: who fires what (runs_on) ---------- */

export interface RunnerRef {
  agent: string;
  id: string;
  name: string;
  /** What runs_on said before (absent: unassigned). */
  from?: string;
}

export interface RunnerFindings {
  /** Enabled routines without runs_on: they fire nowhere. */
  unassigned: RunnerRef[];
  /** Routines whose runs_on is one of this machine's retired identities. */
  retired: RunnerRef[];
  /** Newest change to a routines.yml involved, ISO (the attention item's "since"). */
  since?: string;
}

/** Every routine in the workspace that has no runner, or names a retired identity of this machine. */
export async function runnerFindings(): Promise<RunnerFindings> {
  const id = await readIdentity();
  const out: RunnerFindings = { unassigned: [], retired: [] };
  let since = 0;
  // Archived agents included: the scheduler fires their routines too.
  for (const a of await listAgents()) {
    const routines = await listRoutines(a.slug).catch(() => [] as Routine[]);
    let hit = false;
    for (const r of routines) {
      if (!r.runsOn && r.enabled) {
        out.unassigned.push({ agent: a.slug, id: r.id, name: r.name });
        hit = true;
      } else if (r.runsOn && id.previous.includes(r.runsOn)) {
        out.retired.push({ agent: a.slug, id: r.id, name: r.name, from: r.runsOn });
        hit = true;
      }
    }
    if (hit) {
      const st = await fs.stat(await routinesFile(a.slug)).catch(() => null);
      if (st && st.mtimeMs > since) since = st.mtimeMs;
    }
  }
  if (since) out.since = new Date(since).toISOString();
  return out;
}

export interface AdoptResult {
  /** This machine's identity, now the runner of every routine listed. */
  runsOn: string;
  adopted: RunnerRef[];
  /** routines.yml files written, relative to the workspace root. */
  files: string[];
  /** The git commit of those files; null when nothing changed. Not ok: written, but not committed (why in `error`). */
  commit: { ok: boolean; error?: string; committed?: number } | null;
}

/**
 * "Run these here": make this machine the runner of the routines `pick`
 * selects, write routines.yml and commit just the files it touched — the
 * commit is what tells the other clones who runs them. A workspace without
 * git sync, or a commit that fails, keeps the written files and says why.
 */
export async function adoptRoutines(pick: (agent: string, r: Routine, previous: string[]) => boolean, message?: string): Promise<AdoptResult> {
  const id = await readIdentity();
  const me = identityString(id);
  const adopted: RunnerRef[] = [];
  const written: string[] = [];
  for (const a of await listAgents()) {
    const routines = await listRoutines(a.slug).catch(() => [] as Routine[]);
    let changed = false;
    for (const r of routines) {
      if (r.runsOn === me || !pick(a.slug, r, id.previous)) continue;
      adopted.push({ agent: a.slug, id: r.id, name: r.name, ...(r.runsOn ? { from: r.runsOn } : {}) });
      r.runsOn = me;
      changed = true;
    }
    if (changed) {
      await writeRoutines(a.slug, routines);
      written.push(await routinesFile(a.slug));
    }
  }
  const root = workspaceRoot();
  const files = written.map((f) => path.relative(root, f).split(path.sep).join("/"));
  if (!written.length) return { runsOn: me, adopted, files, commit: null };
  return { runsOn: me, adopted, files, commit: await commitFiles(written, message ?? `Routines run on ${me}: ${adopted.map((x) => `${x.agent}/${x.id}`).join(", ")}`) };
}

async function commitFiles(abs: string[], message: string): Promise<{ ok: boolean; error?: string; committed?: number }> {
  const repoRoot = await repoRootFor(path.dirname(abs[0]));
  if (!repoRoot) return { ok: false, error: "the workspace is not a git repository" };
  // rev-parse answers with symlinks resolved (/var → /private/var on macOS); the files must be spelled the same way.
  const real = (p: string): string => {
    try {
      return realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  const rel = abs.map((f) => path.relative(repoRoot, real(f)).split(path.sep).join("/"));
  return gitCommit(rel, message);
}

/** Adopt one routine (whatever its runs_on said). */
export async function adoptRoutine(slug: string, id: string): Promise<AdoptResult & { routine: RoutineStatus }> {
  const safe = safeAgentSlug(slug);
  if (!(await listRoutines(safe)).some((r) => r.id === id)) throw new Error("routine not found");
  const result = await adoptRoutines((agent, r) => agent === safe && r.id === id);
  const routine = (await routineStatuses(safe)).find((r) => r.id === id)!;
  return { ...result, routine };
}

/** Adopt every enabled routine without runs_on — and, with `retired`, every one naming a retired identity of this machine. */
export function adoptUnassigned(opts: { retired?: boolean } = {}): Promise<AdoptResult> {
  return adoptRoutines((_agent, r, previous) => (!r.runsOn && r.enabled) || (!!opts.retired && !!r.runsOn && previous.includes(r.runsOn)));
}

/** Start the current workspace's scheduler; safe to call more than once. Ticks run in that workspace. */
export function startRoutineScheduler(): void {
  const s = scheduler();
  if (s.timer) return;
  s.timer = setInterval(() => void tick().catch(() => {}), 20_000);
  s.timer.unref?.();
}

/** Stop the current workspace's scheduler (the workspace closes): no routine of it fires any more. */
export function stopRoutineScheduler(): void {
  const s = scheduler();
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
}

/** Whether the current workspace's scheduler runs (tests, the hub's view). */
export const routineSchedulerRunning = (): boolean => scheduler().timer !== null;

/** The current workspace's scheduler timer, or null — for tests that check it really stops (a cleared slot would read null either way). */
export const routineSchedulerTimer = (): ReturnType<typeof setInterval> | null => scheduler().timer;
