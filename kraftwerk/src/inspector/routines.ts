import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { getOutputDir } from "./context.js";
import { getMember, listMembers, safeMemberSlug, teamRoot } from "./team.js";
import { createChat, postMessage } from "./chat/sessions.js";

/**
 * Routines: per-team-member scheduled prompts — "message your agent every
 * weekday at 9". Definitions live next to the member (git-tracked):
 *
 *   agents/<slug>/routines.yml    # list of { id, name, schedule, prompt, enabled }
 *
 * Runtime state (last run / last session / errors) is run-state, not
 * config, so it lives in <output>/routines-state.json. The scheduler is a
 * plain interval inside the inspector server: each due routine opens a new
 * session (chat) for the member and posts the prompt — the run shows up in
 * the member's sessions sidebar like any conversation. Schedules use
 * standard 5-field cron in the server's local time.
 */

export interface Routine {
  id: string;
  name: string;
  /** 5-field cron (min hour dom month dow) or @hourly/@daily/@weekly/@monthly. */
  schedule: string;
  prompt: string;
  enabled: boolean;
}

export interface RoutineStatus extends Routine {
  nextRunAt?: string;
  lastRunAt?: string;
  lastChatId?: string;
  lastError?: string;
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
  return path.join(await teamRoot(), safeMemberSlug(slug), "routines.yml");
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
  };
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
  await fs.writeFile(await routinesFile(slug), stringify(routines));
}

export interface SaveRoutineInput {
  id?: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled?: boolean;
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

  const routine: Routine = {
    id,
    name,
    schedule: input.schedule.trim(),
    prompt: input.prompt,
    enabled: input.enabled !== false,
  };
  const routines = await listRoutines(slug);
  const i = routines.findIndex((r) => r.id === id);
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

export async function routineStatuses(slug: string): Promise<RoutineStatus[]> {
  const [routines, state] = await Promise.all([listRoutines(slug), readState()]);
  return routines.map((r) => {
    const s = state[`${slug}/${r.id}`] ?? {};
    return {
      ...r,
      ...(r.enabled ? { nextRunAt: nextRun(r.schedule) } : {}),
      ...(s.lastRunAt ? { lastRunAt: s.lastRunAt } : {}),
      ...(s.lastChatId ? { lastChatId: s.lastChatId } : {}),
      ...(s.lastError ? { lastError: s.lastError } : {}),
    };
  });
}

/* ---------- firing ---------- */

/** Open a fresh session for the member and post the routine's prompt. */
async function fireRoutine(slug: string, routine: Routine): Promise<string> {
  const member = await getMember(slug);
  if (!member) throw new Error(`team agent "${slug}" not found`);
  const meta = await createChat({
    agent: member.harness,
    scope: { kind: "team", member: slug, routine: routine.id },
    title: `⏰ ${routine.name}`,
  });
  const { error } = await postMessage(meta.id, routine.prompt);
  if (error) throw new Error(error);
  return meta.id;
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
    throw err;
  }
}

/* ---------- scheduler ---------- */

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const minuteKey = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;

  let members;
  try {
    members = await listMembers();
  } catch {
    return;
  }
  const state = await readState();
  let dirty = false;

  for (const m of members) {
    for (const r of await listRoutines(m.slug).catch(() => [] as Routine[])) {
      if (!r.enabled) continue;
      let due = false;
      try {
        due = cronMatches(parseCron(r.schedule), now);
      } catch {
        continue; // invalid schedule — surfaced by validation on save, skip here
      }
      const key = `${m.slug}/${r.id}`;
      if (!due || state[key]?.lastMinute === minuteKey) continue;
      state[key] = { ...state[key], lastMinute: minuteKey };
      dirty = true;
      try {
        const chatId = await fireRoutine(m.slug, r);
        state[key] = { ...state[key], lastRunAt: now.toISOString(), lastChatId: chatId };
        delete state[key].lastError;
      } catch (err) {
        state[key] = { ...state[key], lastError: (err as Error).message };
      }
    }
  }
  if (dirty) await writeState(state);
}

/** Start the in-process scheduler; safe to call more than once. */
export function startRoutineScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick().catch(() => {}), 20_000);
  timer.unref?.();
}
