import { randomUUID } from "node:crypto";
import { getOutputDir, getProjectRoot } from "../context.js";
import { getRun, listRuns, safeRunDir } from "../runs.js";
import { listWorkflows } from "../workflows.js";
import { startAcpBackend } from "./acp.js";
import { startPiBackend } from "./pi.js";
import type { ChatBackend } from "./backend.js";
import type { ChatAgentId, ChatEvent, ChatMeta, ChatScope, StoredChatEvent } from "./types.js";
import { appendEvent, listChatMetas, newChatId, readEvents, readMeta, writeMeta } from "./store.js";

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
}

const states = new Map<string, ChatState>();

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

/* ---------- scope context ---------- */

async function scopeContext(scope: ChatScope): Promise<string> {
  if (scope.kind === "kraftwerk") {
    const [{ workflows }, runs] = await Promise.all([listWorkflows(), listRuns()]);
    const wfLines = workflows
      .map((w) => `- ${w.name ?? w.slug}: ${w.description ?? ""} (${w.steps} steps, ${w.agents} agents)`)
      .join("\n");
    const runLines = runs
      .slice(0, 10)
      .map((r) => `- ${r.id} — ${r.workflow ?? "?"} [${r.status}] ${r.request ?? ""}`.trim())
      .join("\n");
    return (
      `You are the assistant inside the kraftwerk inspector, a UI for a workflow-as-code agent framework. ` +
      `The consumer project root is ${getProjectRoot()}; run outputs live in ${getOutputDir()} (one run-* folder per run, each with a trace.jsonl and working files).\n\n` +
      `Workflows in this project:\n${wfLines || "(none)"}\n\nRecent runs:\n${runLines || "(none)"}\n\n` +
      `Answer questions about workflows and runs by reading these files. Do not modify run outputs unless asked.`
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

/* ---------- backend lifecycle ---------- */

async function ensureBackend(state: ChatState): Promise<ChatBackend> {
  if (state.backend) return state.backend;
  const hooks = {
    emit: (ev: ChatEvent) => void emit(state, ev),
    askPermission: (
      title: string,
      options: Array<{ optionId: string; name: string; kind?: string }>
    ): Promise<string | null> =>
      new Promise((resolve) => {
        const requestId = randomUUID();
        state.pendingPermissions.set(requestId, (optionId) => {
          state.pendingPermissions.delete(requestId);
          emit(state, { type: "permission_resolved", requestId, optionId });
          resolve(optionId);
        });
        emit(state, { type: "permission_request", requestId, title, options });
      }),
  };
  const { agent, cwd } = state.meta;
  state.backend =
    agent === "pi" ? startPiBackend(cwd, hooks) : await startAcpBackend(agent, cwd, hooks);
  return state.backend;
}

/* ---------- public API (used by server.ts) ---------- */

export async function createChat(opts: {
  agent: ChatAgentId;
  scope: ChatScope;
}): Promise<ChatMeta> {
  const cwd = opts.scope.kind === "run" ? safeRunDir(opts.scope.runId) : getProjectRoot();
  const now = new Date().toISOString();
  const meta: ChatMeta = {
    id: newChatId(),
    agent: opts.agent,
    title: "",
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
  if (isFirst) {
    state.meta.title = text.replace(/\s+/g, " ").trim().slice(0, 80);
    void writeMeta(state.meta).catch(() => {});
  }
  emit(state, { type: "user_message", text });

  // The turn runs in the background; the HTTP request returns immediately
  // and the browser follows along on the SSE stream.
  void (async () => {
    try {
      const backend = await ensureBackend(state);
      const context = isFirst ? await scopeContext(state.meta.scope) : "";
      const promptText = context ? `<context>\n${context}\n</context>\n\n${text}` : text;
      const stopReason = await backend.prompt(promptText);
      emit(state, { type: "turn_end", stopReason });
    } catch (err) {
      emit(state, { type: "error", message: (err as Error).message });
      // A failed turn may mean a dead subprocess; drop it so the next
      // message spawns a fresh agent (thread history stays on disk).
      state.backend?.dispose();
      state.backend = null;
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
