import { perWorkspace } from "../workspace.js";
import { changed } from "../changes.js";
import { getAgent } from "../agents.js";
import { getProject } from "../projects.js";
import { dismissKey, type DiagnoseRef } from "../notifications.js";
import type { ChatBackend } from "./backend.js";
import type { Author, ChatAgentId, ChatEvent, ChatMeta, ChatScope, ElicitationAnswer, StoredChatEvent } from "./types.js";
import { appendEvent, readEvents, readMeta, writeMeta } from "./store.js";

/**
 * A chat's live state: its seats (one agent process each), the events in
 * memory, pending questions; loading it from disk (closing work a restart
 * interrupted), emitting events, and dropping idle agent processes.
 */

/**
 * One agent process in a chat. An ordinary chat has exactly one seat
 * (MAIN, the chat's harness); a channel has one seat per member agent,
 * keyed by the agent slug, each with its own process, context and view of
 * the transcript.
 */
export interface Seat {
  key: string;
  harness: ChatAgentId;
  backend: ChatBackend | null;
  busy: boolean;
  /** When the running turn started (ISO); meaningful while busy. */
  busySince?: string;
  /** True right after a backend spawn: the next prompt must carry scope context. */
  needsContext: boolean;
  /** Channels: last transcript seq this agent has been shown. */
  seenSeq: number;
  /** Channels: woken while busy — run once more when the turn ends. */
  wake: { hops: number } | null;
}

export interface ChatState {
  meta: ChatMeta;
  events: StoredChatEvent[];
  subscribers: Set<(ev: StoredChatEvent) => void>;
  seats: Map<string, Seat>;
  pendingPermissions: Map<string, (optionId: string | null) => void>;
  /** Questions the agent asked (form elicitations) waiting for a human, by request id. */
  pendingElicitations: Map<string, (answer: ElicitationAnswer) => void>;
  /** Which seat raised a pending permission/question, by request id (channels: to cancel one agent). */
  pendingSeat: Map<string, string>;
  /** What each pending request asks and since when, by request id: the attention list (waitingRequests). */
  pendingInfo: Map<string, { kind: "approval" | "question"; title: string; since: string }>;
  /** Serializes appendEvent calls so events.jsonl stays ordered. */
  writeChain: Promise<void>;
}

export const MAIN = "main";
/** Chats with a loaded state, by id — one table per workspace. */
export const chatStates = perWorkspace(() => new Map<string, ChatState>());

export const newSeat = (key: string, harness: ChatAgentId): Seat => ({
  key,
  harness,
  backend: null,
  busy: false,
  needsContext: true,
  seenSeq: 0,
  wake: null,
});

/** The one seat of an ordinary (non-channel) chat. */
export function mainSeat(state: ChatState): Seat {
  let seat = state.seats.get(MAIN);
  if (!seat) {
    seat = newSeat(MAIN, state.meta.agent);
    state.seats.set(MAIN, seat);
  }
  return seat;
}

export const isBusy = (state: ChatState): boolean => [...state.seats.values()].some((s) => s.busy);

/** The event author for a seat: channel members sign their events, the lone agent of a chat does not. */
export const seatAuthor = (seat: Seat): Author | undefined => (seat.key === MAIN ? undefined : { kind: "agent", slug: seat.key });

/** Routine-fired sessions: nobody is expected to be watching live. */
export const isUnattended = (scope: ChatScope): boolean => scope.kind === "agent" && !!scope.routine;

/** Diagnose handle for a failed routine session (only called for unattended agent scopes). */
export function routineRef(meta: ChatMeta): DiagnoseRef | undefined {
  const scope = meta.scope;
  if (scope.kind !== "agent" || !scope.routine) return undefined;
  return { kind: "routine", agent: scope.slug, routine: scope.routine, chatId: meta.id };
}

/** How the bell names a chat: its title ("⏰ Morning digest"), else the agent, else "chat". */
export function chatLabel(meta: ChatMeta): string {
  if (meta.scope.kind === "channel") return `#${meta.scope.slug}`;
  if (meta.title) return meta.title;
  return meta.scope.kind === "agent" ? meta.scope.slug : "chat";
}

/**
 * Whose a chat is, owner first, for a notification: "📁 Relaunch · 🦊 Lisa",
 * "🦊 Lisa", "#launch · 🐻 Max", "Ralv · <chat title>". The project or
 * agent comes before the chat because that is where you go.
 */
export async function ownerLabel(meta: ChatMeta, seatKey: string): Promise<string> {
  const agentName = async (slug: string) => {
    const a = await getAgent(slug).catch(() => null);
    return a ? `${a.emoji ? `${a.emoji} ` : ""}${a.name}` : slug;
  };
  const projectName = async (slug: string) => `📁 ${(await getProject(slug).catch(() => null))?.title ?? slug}`;
  const { scope } = meta;
  if (scope.kind === "agent") return agentName(scope.slug);
  if (scope.kind === "project") return projectName(scope.slug);
  if (scope.kind === "channel") {
    const parts = [meta.project ? await projectName(meta.project) : `#${scope.slug}`, await agentName(seatKey)];
    return parts.join(" · ");
  }
  return `Ralv${meta.title ? ` · ${meta.title}` : ""}`;
}

/** Text of the agent's final message (or last error) after `afterSeq`, for a notification body. */
export function lastEventText(state: ChatState, afterSeq: number, type: "text" | "error"): string | undefined {
  const parts: string[] = [];
  for (const e of state.events) {
    if (e.seq <= afterSeq) continue;
    if (e.type === "user_message") parts.length = 0;
    if (type === "text" && e.type === "text") parts.push(e.text);
    if (type === "error" && e.type === "error") parts.push(e.message);
    // A turn the agent ended on a provider failure (usage limit, rate
    // limit) reports no error event — the failure card is the outcome.
    if (type === "error" && e.type === "failure" && e.severity === "error") parts.push(e.title);
  }
  const text = parts.join("").trim();
  if (!text) return undefined;
  // Agents end with the summary: keep the last paragraph(s), the bell clips the rest.
  const paras = text.split(/\n{2,}/).filter((p) => p.trim());
  return paras.slice(-2).join("\n\n");
}

export function dropSeat(seat: Seat): void {
  seat.backend?.dispose();
  seat.backend = null;
}

/** A turn failed: a resumed session that never took a prompt is gone for good — stop resuming it. */
export function forgetFailedResume(state: ChatState, seat: Seat): void {
  if (!seat.backend?.resumeFailed || !state.meta.sessions?.[seat.key]) return;
  const { [seat.key]: _gone, ...rest } = state.meta.sessions;
  state.meta.sessions = rest;
  emit(state, { type: "error", message: "the previous session could not be continued — the next message starts a fresh one" }, seatAuthor(seat));
}

/** Kill a chat's agent subprocess(es); the next message spawns fresh ones. */
export function dropBackend(state: ChatState): void {
  for (const seat of state.seats.values()) dropSeat(seat);
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
  for (const [ws, states] of chatStates.entries()) {
    ws.run(() => {
      for (const state of states.values()) {
        const live = [...state.seats.values()].some((s) => s.backend);
        if (live && !isBusy(state) && Date.parse(state.meta.updatedAt) < cutoff) {
          dropBackend(state);
        }
      }
    });
  }
}, 60_000);
reaper.unref?.();

/** Server shutdown: no agent subprocess may outlive the inspector. */
export function disposeAllBackends(): void {
  for (const [ws, states] of chatStates.entries()) ws.run(() => states.forEach((state) => dropBackend(state)));
}

/** The current workspace's agent processes end (the workspace closes); transcripts stay on disk. */
export function disposeWorkspaceBackends(): void {
  for (const state of chatStates().values()) dropBackend(state);
}

export async function loadState(id: string): Promise<ChatState | null> {
  const existing = chatStates().get(id);
  if (existing) return existing;
  const meta = await readMeta(id);
  if (!meta) return null;
  const state: ChatState = {
    meta,
    events: await readEvents(id),
    subscribers: new Set(),
    seats: new Map(),
    pendingPermissions: new Map(),
    pendingElicitations: new Map(),
    pendingSeat: new Map(),
    pendingInfo: new Map(),
    writeChain: Promise.resolve(),
  };
  // Two racing loads: keep whichever registered first.
  const registered = chatStates().get(id) ?? (chatStates().set(id, state), state);
  if (registered === state) closeInterruptedWork(state);
  return registered;
}

/**
 * A chat loaded from disk has no live process: whatever the transcript
 * still shows as in flight died with the previous inspector (restart,
 * relaunch after an update, crash). Left alone, the UI keeps rendering a
 * permission card nobody can answer any more and a "working" lamp that
 * never goes out. Close those out once, in the transcript itself, so
 * every reader sees the same settled thread: dropped permission requests
 * resolve to "dismissed", open turns end with an error that says why.
 */
function closeInterruptedWork(state: ChatState): void {
  const pending = new Map<string, Author | undefined>();
  const asked = new Map<string, Author | undefined>();
  const open = new Map<string, Author | undefined>();
  const key = (a?: Author) => (a?.kind === "agent" ? `agent:${a.slug}` : "main");
  for (const e of state.events) {
    switch (e.type) {
      case "permission_request":
        pending.set(e.requestId, e.from);
        break;
      case "permission_resolved":
        pending.delete(e.requestId);
        break;
      case "elicitation_request":
        asked.set(e.requestId, e.from);
        break;
      case "elicitation_resolved":
        asked.delete(e.requestId);
        break;
      // Channels: a turn is bracketed by turn_start/turn_end per agent.
      // Ordinary chats never emit turn_start: the user's message opens the
      // turn, turn_end/error closes it.
      case "user_message":
        if (state.meta.scope.kind !== "channel") open.set("main", undefined);
        break;
      case "turn_start":
        open.set(key(e.from), e.from);
        break;
      case "turn_end":
      case "error":
        open.delete(key(e.from));
        break;
    }
  }
  for (const [requestId, from] of pending) {
    emit(state, { type: "permission_resolved", requestId, optionId: null }, from);
    void dismissKey(`approval:${state.meta.id}:${requestId}`);
  }
  for (const [requestId, from] of asked) {
    emit(state, { type: "elicitation_resolved", requestId, action: "cancel" }, from);
    void dismissKey(`question:${state.meta.id}:${requestId}`);
  }
  for (const from of open.values()) {
    const who = from?.kind === "agent" ? `@${from.slug}` : "the agent";
    const how = state.meta.scope.kind === "channel" ? `mention ${who} again` : "send another message";
    emit(state, { type: "error", message: `${who} was interrupted by an inspector restart — ${how} to continue` }, from);
  }
  if (pending.size || asked.size || open.size) void writeMeta(state.meta).catch(() => {});
}

export function emit(state: ChatState, ev: ChatEvent, from?: Author): StoredChatEvent {
  const stored: StoredChatEvent = {
    ...ev,
    seq: (state.events[state.events.length - 1]?.seq ?? 0) + 1,
    ts: new Date().toISOString(),
    ...(from ? { from } : {}),
  };
  state.events.push(stored);
  state.meta.updatedAt = stored.ts;
  state.writeChain = state.writeChain
    .then(() => appendEvent(state.meta.id, stored))
    .catch(() => {});
  for (const fn of state.subscribers) fn(stored);
  // What a list shows about a chat (busy, waiting for you) changed: live watches re-evaluate.
  if (STATUS_EVENTS.has(ev.type)) changed();
  return stored;
}

/** Events that change a chat's state as lists show it — not the streamed text in between. */
const STATUS_EVENTS = new Set<string>(["user_message", "turn_start", "turn_end", "error", "failure", "permission_request", "permission_resolved", "elicitation_request", "elicitation_resolved", "files_changed"]);
