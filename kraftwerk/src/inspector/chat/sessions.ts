import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { getOutputDir, getProjectRoot } from "../context.js";
import { knowledgeIndex } from "../knowledge.js";
import { getRun, listRuns, safeRunDir } from "../runs.js";
import { listSkills, readSkill, type SkillInfo } from "../skills.js";
import { listWorkflows } from "../workflows.js";
import { getAgent, listAgents } from "../agents.js";
import { listRepos } from "../repos.js";
import { startAcpBackend } from "./acp.js";
import { startPiBackend } from "./pi.js";
import type { BackendTuning, ChatBackend } from "./backend.js";
import type { ChatAgentId, ChatEvent, ChatMeta, ChatScope, StoredChatEvent } from "./types.js";
import {
  appendEvent,
  listChatMetas,
  newChatId,
  readEvents,
  readMeta,
  safeChatDir,
  writeMeta,
} from "./store.js";

/**
 * Chat session manager: holds the live state per chat (agent subprocess,
 * SSE subscribers, pending permission requests), persists every event, and
 * injects the scope context (kraftwerk overview / run artifacts) into the
 * first prompt so the agent knows what it is looking at.
 */

interface ChatState {
  meta: ChatMeta;
  events: StoredChatEvent[];
  subscribers: Set<(ev: StoredChatEvent) => void>;
  backend: ChatBackend | null;
  busy: boolean;
  pendingPermissions: Map<string, (optionId: string | null) => void>;
  /** Serializes appendEvent calls so events.jsonl stays ordered. */
  writeChain: Promise<void>;
  /** True right after a backend spawn: the next prompt must carry scope context. */
  needsContext: boolean;
}

const states = new Map<string, ChatState>();

/** Kill a chat's agent subprocess; the next message spawns a fresh one. */
function dropBackend(state: ChatState): void {
  state.backend?.dispose();
  state.backend = null;
}

// Idle reaper: a finished chat must not keep its agent subprocess alive
// forever (one ACP adapter + one harness binary per chat adds up fast —
// hourly routines used to leak a process pair per tick). History is on
// disk and ensureBackend re-sends scope context, so reaping just costs
// the next message one respawn. busy=true covers the whole turn including
// pending permission prompts, so nothing is killed mid-work.
const IDLE_BACKEND_MS = 15 * 60_000;
const reaper = setInterval(() => {
  const cutoff = Date.now() - IDLE_BACKEND_MS;
  for (const state of states.values()) {
    if (state.backend && !state.busy && Date.parse(state.meta.updatedAt) < cutoff) {
      dropBackend(state);
    }
  }
}, 60_000);
reaper.unref?.();

/** Server shutdown: no agent subprocess may outlive the inspector. */
export function disposeAllBackends(): void {
  for (const state of states.values()) dropBackend(state);
}

async function loadState(id: string): Promise<ChatState | null> {
  const existing = states.get(id);
  if (existing) return existing;
  const meta = await readMeta(id);
  if (!meta) return null;
  const state: ChatState = {
    meta,
    events: await readEvents(id),
    subscribers: new Set(),
    backend: null,
    busy: false,
    pendingPermissions: new Map(),
    writeChain: Promise.resolve(),
    needsContext: true,
  };
  // Two racing loads: keep whichever registered first.
  return states.get(id) ?? (states.set(id, state), state);
}

function emit(state: ChatState, ev: ChatEvent): StoredChatEvent {
  const stored: StoredChatEvent = {
    ...ev,
    seq: (state.events[state.events.length - 1]?.seq ?? 0) + 1,
    ts: new Date().toISOString(),
  };
  state.events.push(stored);
  state.meta.updatedAt = stored.ts;
  state.writeChain = state.writeChain
    .then(() => appendEvent(state.meta.id, stored))
    .catch(() => {});
  for (const fn of state.subscribers) fn(stored);
  return stored;
}

/* ---------- skills ---------- */

/**
 * Skills visible to a chat: every discovered skill (workspace skills root
 * + .claude/skills roots, plus the agent's own agents/<slug>/skills for agent
 * sessions), narrowed by the agent's allowlist when the chat is an agent
 * session (absent allowlist = all, empty = none). The agent's own skills
 * always apply — the allowlist narrows shared skills only.
 */
async function availableSkills(scope: ChatScope): Promise<SkillInfo[]> {
  const all = await listSkills(scope.kind === "agent" ? scope.slug : undefined).catch(
    () => [] as SkillInfo[]
  );
  if (scope.kind !== "agent") return all;
  const def = await getAgent(scope.slug).catch(() => null);
  if (!def || def.skills === undefined) return all;
  const allowed = new Set(def.skills.map((n) => n.toLowerCase()));
  return all.filter((s) => s.source === "agent" || allowed.has(s.name.toLowerCase()));
}

/** "## Your skills" context block (empty when no skills are visible). */
function skillsBlock(skills: SkillInfo[]): string {
  if (skills.length === 0) return "";
  const lines = skills
    .map((s) => `- /${s.name}${s.description ? `: ${s.description}` : ""} — ${s.path}`)
    .join("\n");
  return (
    `## Your skills\nSkills are reusable instruction packages (a SKILL.md per skill). When the ` +
    `user's request matches one, read its SKILL.md file and follow the instructions in it. The user ` +
    `can also invoke one explicitly by starting a message with /<skill-name>.\n${lines}`
  );
}

/**
 * Explicit skill invocation: a message starting with /<skill-name> is
 * expanded into the skill's SKILL.md instructions (the stored user_message
 * keeps the original "/name args" text). Unknown names pass through as-is.
 */
async function expandSkillInvocation(scope: ChatScope, text: string): Promise<string> {
  const m = /^\/([A-Za-z0-9][\w-]*)[ \t]*([\s\S]*)$/.exec(text);
  if (!m) return text;
  const skills = await availableSkills(scope);
  const skill = skills.find((s) => s.name.toLowerCase() === m[1].toLowerCase());
  if (!skill) return text;
  const body = await readSkill(skill);
  if (!body.trim()) return text;
  const args = m[2].trim();
  return (
    `The user invoked the skill "${skill.name}" (${skill.path}). Follow the skill's instructions:\n\n` +
    `<skill name="${skill.name}">\n${body.trim()}\n</skill>\n\n` +
    `Arguments the user passed to the skill: ${args || "(none)"}`
  );
}

/* ---------- scope context ---------- */

/** "## Your knowledge" block for a agent's connected OKF bundles. */
async function agentKnowledgeContext(def: {
  slug: string;
  harness: ChatAgentId;
  knowledge: string[];
}): Promise<string> {
  if (def.knowledge.length === 0) return "";
  const { bundles } = await knowledgeIndex().catch(() => ({ bundles: [] }));
  const lines = def.knowledge
    .map((name) => {
      const b = bundles.find((x) => x.name === name);
      return b
        ? `- ${b.name} (${b.concepts} concepts${b.updatedAt ? `, updated ${b.updatedAt.slice(0, 10)}` : ""})`
        : `- ${name} (not found in knowledge/ — tell the user if you need it)`;
    })
    .join("\n");
  return (
    `## Your knowledge\nThese OKF knowledge bundles (markdown + YAML frontmatter under knowledge/) are ` +
    `part of your job. Consult them before answering questions in their domain, and keep them current ` +
    `when you learn something durable:\n${lines}\n\n` +
    `Read with \`npx kraftwerk knowledge list <bundle>\`, \`get <bundle>/<path>\`, \`search <text>\`. ` +
    `Write ONLY through \`npx kraftwerk knowledge put <bundle>/<path> --file <tmp.md> --actor ${def.slug}/${def.harness}\` ` +
    `(write the markdown to a temp file first; the CLI stamps provenance and maintains index.md/log.md). ` +
    `Never hand-edit index.md or log.md, and never add \`verified\` yourself — verification is the human's ` +
    `click in the UI.\n\n`
  );
}

/**
 * "## Repositories" block: the clones under the repos root, when the
 * feature is on. Empty when it is off, so agents in a workspace without
 * it never hear about it.
 */
async function reposContext(): Promise<string> {
  const view = await listRepos().catch(() => null);
  if (!view?.enabled || !view.root) return "";
  const lines = view.repos
    .map((r) => {
      const state = r.error ? `unreadable: ${r.error}` : [r.dirty ? `${r.dirty} uncommitted` : "clean", r.ahead ? `${r.ahead} ahead` : "", r.behind ? `${r.behind} behind` : ""].filter(Boolean).join(", ");
      return `- ${r.slug} — ${r.path}${r.url ? ` (${r.url})` : ""}${r.branch ? `, branch ${r.branch}` : ""}${r.head ? ` @ ${r.head}` : ""}, ${state}`;
    })
    .join("\n");
  return (
    `## Repositories\nGit repositories this workspace works on live under ${view.root} (one clone per folder). ` +
    `When the user names one of them, work inside its folder: read its README and structure first, keep commits on a ` +
    `branch unless told otherwise, and never push or force-push without asking.\n${lines || "(none cloned yet)"}\n\n` +
    `Clone a new one with \`npx kraftwerk repos add <url> [--name <folder>] [--branch <b>] [--depth <n>]\` so it lands in ` +
    `that root (\`--depth 1\` for a large repository; a plain \`git clone\` into that folder works too); ` +
    `\`npx kraftwerk repos\` lists them, \`update <name>\` fetches and fast-forwards a clean clone, \`remove <name>\` ` +
    `deletes one. A repository the user mentions that is not listed is not cloned yet — offer to add it.`
  );
}

/** Base context per scope; scopeContext() appends the shared skills block. */
async function baseScopeContext(scope: ChatScope, agent: ChatAgentId): Promise<string> {
  if (scope.kind === "agent") {
    const def = await getAgent(scope.slug).catch(() => null);
    if (!def) {
      return `You were opened as agent "${scope.slug}", but its definition under agents/ is missing. Tell the user and ask them to recreate it.`;
    }
    const { workflows } = await listWorkflows().catch(() => ({ workflows: [] }));
    const connected = workflows.filter((w) => def.workflows.includes(w.slug));
    const missing = def.workflows.filter((slug) => !connected.some((w) => w.slug === slug));
    const wfLines = connected
      .map((w) => `- ${w.slug}: ${w.description ?? w.name ?? ""} (${w.steps} steps)`)
      .join("\n");
    return (
      `You are ${def.emoji} ${def.name}, a persistent agent of this project ` +
      `(defined in agents/${def.slug}/). The user works with you like with a colleague: every session ` +
      `is a conversation with the same ${def.name}, so keep this role consistently. You are an AI agent, ` +
      `not a human — never pretend otherwise, but do own your role.\n\n` +
      `## Your role\n${def.system || "(no system prompt written yet — ask the user what your job should be)"}\n\n` +
      (def.workflows.length > 0
        ? `## Your workflows\nThese kraftwerk workflows are part of your job. When the user's request matches one, ` +
          `run it yourself instead of doing the work by hand:\n${wfLines || "(none found)"}\n` +
          (missing.length > 0
            ? `(configured but not found in this project: ${missing.join(", ")})\n`
            : "") +
          `\nRun a workflow with:\n` +
          `  KRAFTWERK_YES=1 npx kraftwerk run <workflow> "<request>"\n` +
          `The command blocks until the run finishes; artifacts land in output/runs/*/ — tell the user the ` +
          `run id and summarize the result. Confirm with the user before starting a long or expensive run ` +
          `unless they clearly asked for it.\n\n`
        : "") +
      (await agentKnowledgeContext(def)) +
      `The working directory is the project root. Stay within your role; if a request is clearly outside it, ` +
      `say so and suggest which agent or tool fits better.` +
      (scope.routine
        ? `\n\nThis session was started automatically by your scheduled routine "${scope.routine}" — ` +
          `nobody may be watching live. Complete the task autonomously (tool permissions are ` +
          `auto-approved) and end with a clear, self-contained summary of what you did and found.`
        : "")
    );
  }
  if (scope.kind === "knowledge") {
    const { root, bundles } = await knowledgeIndex().catch(() => ({ root: "", bundles: [] }));
    const bundleLines = bundles
      .map((b) => `- ${b.name} (${b.concepts} concepts${b.updatedAt ? `, updated ${b.updatedAt.slice(0, 10)}` : ""})`)
      .join("\n");
    return (
      `You are the knowledge curator inside the kraftwerk inspector ("Context & Knowledge"). ` +
      `This project keeps knowledge as OKF v0.2 bundles (Open Knowledge Format): directories of markdown ` +
      `files with YAML frontmatter under ${root || "knowledge/"}. Each direct subdirectory is one bundle; each .md file ` +
      `(except the reserved index.md and log.md) is one concept.\n\n` +
      `Existing bundles:\n${bundleLines || "(none yet)"}\n` +
      (scope.bundle ? `\nThe user wants to work on the "${scope.bundle}" bundle.\n` : "") +
      `\nOKF essentials:\n` +
      `- Frontmatter needs exactly one required key: \`type\` (free-form, e.g. Playbook, Metric, Reference, API Endpoint). ` +
      `Recommended: title, description, tags, resource (canonical URI of the described asset).\n` +
      `- Provenance/trust families (all optional): \`sources\` (list of { id, resource, title, author, usage_count, last_modified }), ` +
      `\`generated: { by, at }\`, \`verified: [{ by, at }]\`, \`status\` (draft|stable|deprecated), \`stale_after\` (ISO datetime).\n` +
      `- Actors: \`<producer>/<version>\` for agents, \`human:<id>\` for people, \`process:<id>\` for automation.\n` +
      `- Concepts cross-link with normal markdown links, bundle-absolute (\`/path/concept.md\`) preferred. ` +
      `Per-claim attribution uses markdown footnotes whose label is a \`sources[].id\`.\n` +
      `- Favor structural markdown (headings, tables, lists) over prose.\n\n` +
      `ALWAYS write through the kraftwerk CLI so provenance is stamped and the bundle log/index stay maintained:\n` +
      `- \`npx kraftwerk knowledge init <bundle>\` — new bundle\n` +
      `- \`npx kraftwerk knowledge put <bundle>/<path> --file <tmp.md> --actor kraftwerk-chat/${agent}\` — create/update a concept ` +
      `(write the markdown to a temp file first; the CLI stamps generated.by/at, appends log.md, regenerates index.md)\n` +
      `- \`npx kraftwerk knowledge list [bundle]\`, \`get <bundle>/<path>\`, \`search <text>\`, \`validate\`\n` +
      `Do not hand-edit index.md or log.md (derived/maintained), and do not add \`verified\` yourself — ` +
      `verification is the human's click in the UI. Ask the user what knowledge to capture, then author concise, well-typed concepts.`
    );
  }
  if (scope.kind === "kraftwerk") {
    const [{ workflows }, runs, knowledge, agents] = await Promise.all([
      listWorkflows(),
      listRuns(),
      knowledgeIndex().catch(() => ({ bundles: [] })),
      listAgents().catch(() => []),
    ]);
    const wfLines = workflows
      .map((w) => `- ${w.slug}: ${w.description ?? w.name ?? ""} (${w.steps} steps, ${w.agents} agents)`)
      .join("\n");
    const runLines = runs
      .slice(0, 10)
      .map((r) => `- ${r.id} — ${r.workflow ?? "?"} [${r.status}] ${r.request ?? ""}`.trim())
      .join("\n");
    const bundleLines = knowledge.bundles
      .map((b) => `- ${b.name} (${b.concepts} concepts${b.updatedAt ? `, updated ${b.updatedAt.slice(0, 10)}` : ""})`)
      .join("\n");
    const agentLines = agents
      .map((m) => `- ${m.emoji} ${m.name} (${m.slug})${m.description ? `: ${m.description}` : ""}`)
      .join("\n");
    return (
      `You are the assistant inside the kraftwerk inspector, a UI for a workflow-as-code agent framework. ` +
      `The consumer project root is ${getProjectRoot()}; run outputs live in ${getOutputDir()} (one folder per run under runs/, each with a trace.jsonl and working files). ` +
      `Everything below is current — no need to re-discover the project layout or the CLI before acting.\n\n` +
      `## Workflows\n${wfLines || "(none)"}\n\n` +
      `Run one directly with:\n` +
      `  KRAFTWERK_YES=1 npx kraftwerk run <workflow> "<request>"\n` +
      `The command blocks until the run finishes and prints the run id; artifacts land in the output ` +
      `folder above. When the user's request matches a workflow, run it instead of doing the work by hand.\n\n` +
      `## Recent runs\n${runLines || "(none)"}\n\n` +
      `## Knowledge\nOKF bundles in this project:\n${bundleLines || "(none)"}\n` +
      `Read with \`npx kraftwerk knowledge list [bundle]\`, \`get <bundle>/<path>\`, \`search <text>\`. ` +
      `Write ONLY through \`npx kraftwerk knowledge put <bundle>/<path> --file <tmp.md> --actor kraftwerk-chat/${agent}\` ` +
      `(stamps provenance, maintains index.md/log.md — never hand-edit those).\n\n` +
      `## Agents\n${agentLines || "(none)"}\n` +
      `These are persistent agents (defined under agents/); the user talks to them on the ` +
      `Agents screen. Point the user there when a request clearly belongs to one of them.\n\n` +
      `Answer questions about workflows and runs by reading the files above. Do not modify run outputs unless asked.`
    );
  }
  if (scope.kind === "run") {
    const run = await getRun(scope.runId);
    if (!run) return `The user wants to discuss kraftwerk run ${scope.runId}, but it was not found.`;
    const phases = run.phases
      .map((p) => `- ${p.phase} [${p.status}]${p.summary ? `: ${p.summary}` : ""}`)
      .join("\n");
    const files = run.files.map((f) => `- ${f.name} (${f.size} bytes)`).join("\n");
    return (
      `You are the assistant for one kraftwerk workflow run. Your working directory is the run's output folder.\n\n` +
      `Run ${run.id} — workflow "${run.workflow ?? "?"}", status ${run.status}.\n` +
      `Request: ${run.request ?? "(none)"}\n\nPhases:\n${phases || "(none)"}\n\nFiles in this folder:\n${files || "(none)"}\n\n` +
      `trace.jsonl holds the full event log. Read files as needed to answer; do not modify the run's artifacts unless asked.`
    );
  }
  return "";
}

/**
 * Every chat renders in the inspector UI, so agents should know two things:
 * replies are markdown, and run artifacts are addressable over the
 * inspector's own file endpoint (relative URLs keep working wherever the
 * inspector is reachable — localhost, LAN, tunnel).
 */
const RENDERING_BLOCK =
  `## Chat rendering\n` +
  `Your replies render as markdown in the inspector chat: headings, lists, tables, code blocks, ` +
  `links and images all work. Files inside a workflow run's output folder are served by the ` +
  `inspector itself at /api/runs/<run-id>/file?name=<relative-path>&raw=1 — embed an image inline ` +
  `with ![alt](/api/runs/<run-id>/file?name=picture.png&raw=1), or link any artifact the same way. ` +
  `Prefer these relative /api/... URLs over file paths when showing results: they render directly ` +
  `in this chat and keep working wherever the inspector is reachable.`;

async function scopeContext(scope: ChatScope, agent: ChatAgentId): Promise<string> {
  // The repositories block reads every clone from git, so it runs alongside
  // the rest instead of adding its spawns to the first prompt's latency.
  const [base, repos, skills] = await Promise.all([
    baseScopeContext(scope, agent),
    scope.kind === "agent" || scope.kind === "kraftwerk" ? reposContext() : Promise.resolve(""),
    availableSkills(scope),
  ]);
  return [base, repos, RENDERING_BLOCK, skillsBlock(skills)].filter(Boolean).join("\n\n");
}

/* ---------- backend lifecycle ---------- */

/** Agent sessions carry the agent's model/effort; resolved live so edits apply to new backends. */
async function backendTuning(scope: ChatScope, agent: ChatAgentId): Promise<BackendTuning> {
  const tuning: BackendTuning = {};
  if (scope.kind === "agent") {
    const def = await getAgent(scope.slug).catch(() => null);
    if (def?.model) tuning.model = def.model;
    if (def?.effort) tuning.effort = def.effort;
    // Claude discovers skills natively; an agentined allowlist narrows that.
    if (agent === "claude" && def?.skills) tuning.skills = def.skills;
  }
  // Run chats live in the run folder — grant claude the project root so
  // project-level skills and files stay reachable.
  if (scope.kind === "run" && agent === "claude") tuning.addDirs = [getProjectRoot()];
  // pi loads skills only when told: hand it every visible skill folder.
  if (agent === "pi") {
    const skills = await availableSkills(scope);
    if (skills.length > 0) tuning.skillDirs = skills.map((s) => s.dir);
  }
  return tuning;
}

async function ensureBackend(state: ChatState): Promise<ChatBackend> {
  if (state.backend) return state.backend;
  const hooks = {
    emit: (ev: ChatEvent) => void emit(state, ev),
    askPermission: (
      title: string,
      options: Array<{ optionId: string; name: string; kind?: string }>
    ): Promise<string | null> => {
      // Routine-triggered sessions run unattended: auto-approve, but keep
      // the request/resolution pair in the thread as an audit trail.
      const scope = state.meta.scope;
      if (scope.kind === "agent" && scope.routine) {
        const allow = options.find((o) => o.kind?.startsWith("allow")) ?? options[0];
        const requestId = randomUUID();
        emit(state, { type: "permission_request", requestId, title, options });
        emit(state, { type: "permission_resolved", requestId, optionId: allow?.optionId ?? null });
        return Promise.resolve(allow?.optionId ?? null);
      }
      return new Promise((resolve) => {
        const requestId = randomUUID();
        state.pendingPermissions.set(requestId, (optionId) => {
          state.pendingPermissions.delete(requestId);
          emit(state, { type: "permission_resolved", requestId, optionId });
          resolve(optionId);
        });
        emit(state, { type: "permission_request", requestId, title, options });
      });
    },
  };
  const { agent, cwd } = state.meta;
  const tuning = await backendTuning(state.meta.scope, agent);
  state.backend =
    agent === "pi"
      ? startPiBackend(cwd, hooks, tuning)
      : await startAcpBackend(agent, cwd, hooks, tuning);
  // Fresh process = fresh context window: re-send scope context with the
  // next prompt (matters for chats resumed after an inspector restart).
  state.needsContext = true;
  return state.backend;
}

/* ---------- public API (used by server.ts) ---------- */

export async function createChat(opts: {
  agent: ChatAgentId;
  scope: ChatScope;
  /** Preset title (e.g. routine runs); otherwise the first message names the chat. */
  title?: string;
}): Promise<ChatMeta> {
  const cwd = opts.scope.kind === "run" ? safeRunDir(opts.scope.runId) : getProjectRoot();
  const now = new Date().toISOString();
  const meta: ChatMeta = {
    id: newChatId(),
    agent: opts.agent,
    title: opts.title ?? "",
    cwd,
    scope: opts.scope,
    createdAt: now,
    updatedAt: now,
  };
  await writeMeta(meta);
  states.set(meta.id, {
    meta,
    events: [],
    subscribers: new Set(),
    backend: null,
    busy: false,
    pendingPermissions: new Map(),
    writeChain: Promise.resolve(),
    needsContext: true,
  });
  return meta;
}

export async function listChats(): Promise<Array<ChatMeta & { busy: boolean }>> {
  const metas = await listChatMetas();
  return metas.map((m) => ({
    ...(states.get(m.id)?.meta ?? m),
    busy: states.get(m.id)?.busy ?? false,
  }));
}

export async function getChat(
  id: string
): Promise<{ meta: ChatMeta; events: StoredChatEvent[]; busy: boolean } | null> {
  const state = await loadState(id);
  if (!state) return null;
  return { meta: state.meta, events: state.events, busy: state.busy };
}

export async function postMessage(id: string, text: string): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  if (state.busy) return { error: "agent is still working — wait for the turn to finish" };

  state.busy = true;
  const isFirst = !state.events.some((e) => e.type === "user_message");
  if (isFirst && !state.meta.title) {
    state.meta.title = text.replace(/\s+/g, " ").trim().slice(0, 80);
    void writeMeta(state.meta).catch(() => {});
  }
  emit(state, { type: "user_message", text });

  // The turn runs in the background; the HTTP request returns immediately
  // and the browser follows along on the SSE stream.
  void (async () => {
    try {
      const backend = await ensureBackend(state);
      const context = state.needsContext
        ? await scopeContext(state.meta.scope, state.meta.agent)
        : "";
      state.needsContext = false;
      // "/<skill> args" expands to the skill's instructions for the agent;
      // the thread keeps the short form the user typed.
      const body = await expandSkillInvocation(state.meta.scope, text);
      const promptText = context ? `<context>\n${context}\n</context>\n\n${body}` : body;
      const stopReason = await backend.prompt(promptText);
      emit(state, { type: "turn_end", stopReason });
      // Routine sessions are one-shot and unattended: release the agent
      // process as soon as the turn ends instead of waiting for the reaper.
      const scope = state.meta.scope;
      if (scope.kind === "agent" && scope.routine) dropBackend(state);
    } catch (err) {
      emit(state, { type: "error", message: (err as Error).message });
      // A failed turn may mean a dead subprocess; drop it so the next
      // message spawns a fresh agent (thread history stays on disk).
      dropBackend(state);
    } finally {
      state.busy = false;
      void writeMeta(state.meta).catch(() => {});
    }
  })();
  return {};
}

export async function resolvePermission(
  id: string,
  requestId: string,
  optionId: string | null
): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  const resolve = state.pendingPermissions.get(requestId);
  if (!resolve) return { error: "no such pending permission request" };
  resolve(optionId);
  return {};
}

/** Delete a chat: kill its backend, drop the live state, remove its folder. */
export async function deleteChat(id: string): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  for (const resolve of state.pendingPermissions.values()) resolve(null);
  dropBackend(state);
  states.delete(id);
  await fs.rm(safeChatDir(id), { recursive: true, force: true });
  return {};
}

export async function cancelChat(id: string): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  for (const resolve of state.pendingPermissions.values()) resolve(null);
  state.backend?.cancel();
  return {};
}

/**
 * SSE subscription: replays events after `afterSeq`, then streams new ones.
 * Returns an unsubscribe function.
 */
export async function subscribeChat(
  id: string,
  afterSeq: number,
  fn: (ev: StoredChatEvent) => void
): Promise<(() => void) | null> {
  const state = await loadState(id);
  if (!state) return null;
  for (const ev of state.events) if (ev.seq > afterSeq) fn(ev);
  state.subscribers.add(fn);
  return () => state.subscribers.delete(fn);
}
