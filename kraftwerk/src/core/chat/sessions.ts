import { promises as fs } from "node:fs";
import { workspaceRoot } from "../context.js";
import { safeRunDir } from "../runs.js";
import { getAgent } from "../agents.js";
import { resolveVibeable } from "../vibeables.js";
import { deleteAgentSession, listAgentSessions } from "./acp.js";
import { chatHref, pushNotification } from "../notifications.js";
import type { Attachment, ChatAgentId, ChatMeta, ChatScope, ElicitationAnswer, StoredChatEvent } from "./types.js";
import type { PromptFile } from "./backend.js";
import { type Channel } from "../channels.js";
import { moveToTrash } from "../trash.js";
import { attachmentPath, copyChatFiles, listChatMetas, newChatId, readMetaAt, safeChatDir, writeMeta } from "./store.js";
import { postChannelMessage } from "./channel-turns.js";
import { expandSkillInvocation, scopeContext } from "./context.js";
import { ensureBackend } from "./seats.js";
import { MAIN, type Seat, chatLabel, chatStates, dropBackend, dropSeat, emit, forgetFailedResume, isBusy, isUnattended, lastEventText, loadState, mainSeat, newSeat, ownerLabel, routineRef } from "./state.js";
export { agentFilesContext, agentJournalContext, agentVibeablesContext, vibeableContext } from "./context.js";
export { disposeAllBackends, disposeWorkspaceBackends } from "./state.js";

/**
 * Chats: what the API does with them — create, post, steer, answer, fork,
 * rename, delete, subscribe. The pieces live beside it: the live state and
 * its events (state.ts), the context an agent is given (context.ts), its
 * process (seats.ts) and channel turns (channel-turns.ts).
 */

/* ---------- public API (used by server.ts) ---------- */

/** Where a chat's agent runs when no vibeable is open: the run folder for run chats, else the project root. */
const defaultCwd = (scope: ChatScope): string => (scope.kind === "run" ? safeRunDir(scope.runId) : workspaceRoot());

/**
 * The folder the agent is actually spawned in. A vibeable that was removed
 * leaves meta.cwd pointing nowhere; spawning there fails, so fall back to
 * the scope's default while keeping meta.vibeable — the context then tells
 * the agent the folder is gone instead of pretending it is there.
 */
export async function effectiveCwd(meta: ChatMeta): Promise<string> {
  const st = await fs.stat(meta.cwd).catch(() => null);
  if (st?.isDirectory()) return meta.cwd;
  return defaultCwd(meta.scope);
}

export async function createChat(opts: {
  agent: ChatAgentId;
  scope: ChatScope;
  /** Preset title (e.g. routine runs); otherwise the first message names the chat. */
  title?: string;
  /** Continue one of the agent's own sessions (from listAgentSessionsFor) instead of starting fresh. */
  resume?: string;
}): Promise<ChatMeta> {
  const cwd = defaultCwd(opts.scope);
  const now = new Date().toISOString();
  const meta: ChatMeta = {
    id: newChatId(),
    agent: opts.agent,
    title: opts.title ?? "",
    cwd,
    scope: opts.scope,
    ...(opts.resume && opts.agent !== "pi" ? { sessions: { [MAIN]: opts.resume } } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await writeMeta(meta);
  chatStates().set(meta.id, {
    meta,
    events: [],
    subscribers: new Set(),
    seats: new Map(),
    pendingPermissions: new Map(),
    pendingElicitations: new Map(),
    pendingSeat: new Map(),
    pendingInfo: new Map(),
    writeChain: Promise.resolve(),
  });
  return meta;
}

/** A permission request is waiting for a human in this chat (live state only — a restart drops it with the backend). */
export function chatAwaitingApproval(id: string): boolean {
  return (chatStates().get(id)?.pendingInfo.size ?? 0) > 0;
}

/** A request in a chat that waits for a human: an approval or a question, with the seat (agent) that raised it. */
export interface WaitingRequest {
  requestId: string;
  kind: "approval" | "question";
  title: string;
  since: string;
  meta: ChatMeta;
  /** The seat that asked: MAIN in an ordinary chat, the agent slug in a channel. */
  seat: string;
}

/** Every request waiting for a human, across the chats in memory. */
export function waitingRequests(): WaitingRequest[] {
  const out: WaitingRequest[] = [];
  for (const state of chatStates().values()) {
    for (const [requestId, info] of state.pendingInfo) {
      out.push({ requestId, ...info, meta: state.meta, seat: state.pendingSeat.get(requestId) ?? MAIN });
    }
  }
  return out;
}

/** One chat an agent is in right now: mid-turn, or waiting on a human. */
export interface AgentActivity {
  chatId: string;
  title: string;
  since?: string;
}

/**
 * Live work per agent slug, from the chats in memory: where its seat is
 * mid-turn (working) and where it raised a permission request or a
 * question nobody answered yet (waiting). Agent sessions and channel seats
 * alike; plain and project chats have no agent and are left out.
 */
export function agentActivity(): Map<string, { working: AgentActivity[]; waiting: AgentActivity[] }> {
  const out = new Map<string, { working: AgentActivity[]; waiting: AgentActivity[] }>();
  const of = (slug: string) => out.get(slug) ?? out.set(slug, { working: [], waiting: [] }).get(slug)!;
  for (const state of chatStates().values()) {
    const { meta } = state;
    for (const seat of state.seats.values()) {
      const slug = meta.scope.kind === "agent" ? meta.scope.slug : meta.scope.kind === "channel" ? seat.key : undefined;
      if (!slug) continue;
      const item = { chatId: meta.id, title: meta.title };
      if (seat.busy) of(slug).working.push({ ...item, ...(seat.busySince ? { since: seat.busySince } : {}) });
      if ([...state.pendingSeat.values()].includes(seat.key)) of(slug).waiting.push(item);
    }
  }
  return out;
}

export async function listChats(): Promise<Array<ChatMeta & { busy: boolean; awaitingApproval: boolean }>> {
  const metas = await listChatMetas();
  return metas.map((m) => ({
    ...(chatStates().get(m.id)?.meta ?? m),
    busy: chatStates().has(m.id) ? isBusy(chatStates().get(m.id)!) : false,
    awaitingApproval: chatAwaitingApproval(m.id),
  }));
}

export async function getChat(
  id: string
): Promise<{ meta: ChatMeta; events: StoredChatEvent[]; busy: boolean } | null> {
  const state = await loadState(id);
  if (!state) return null;
  return { meta: state.meta, events: state.events, busy: isBusy(state) };
}

/** Attachments as the backend gets them: with their path on disk. */
const promptFiles = (id: string, attachments: Attachment[] = []): PromptFile[] =>
  attachments.map((a) => ({ ...a, path: attachmentPath(id, a.name) }));

export async function postMessage(
  id: string,
  text: string,
  opts: { from?: string; attachments?: Attachment[] } = {}
): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  const attachments = opts.attachments?.length ? opts.attachments : undefined;
  if (state.meta.scope.kind === "channel") return postChannelMessage(state, state.meta.scope.slug, text, opts.from, attachments);
  const seat = mainSeat(state);
  if (seat.busy) return { error: "agent is still working — wait for the turn to finish" };

  seat.busy = true;
  seat.busySince = new Date().toISOString();
  const isFirst = !state.events.some((e) => e.type === "user_message");
  if (isFirst && !state.meta.title) {
    state.meta.title = text.replace(/\s+/g, " ").trim().slice(0, 80);
    void writeMeta(state.meta).catch(() => {});
  }
  const turnStart = emit(state, { type: "user_message", text, ...(attachments ? { attachments } : {}) }).seq;

  // The turn runs in the background; the HTTP request returns immediately
  // and the browser follows along on the SSE stream.
  void (async () => {
    try {
      const backend = await ensureBackend(state, seat);
      const context = seat.needsContext ? await scopeContext(state.meta, seat) : "";
      seat.needsContext = false;
      // "/<skill> args" expands to the skill's instructions for the agent;
      // the thread keeps the short form the user typed.
      const body = await expandSkillInvocation(state.meta.scope, text);
      const promptText = context ? `<context>\n${context}\n</context>\n\n${body}` : body;
      const { stopReason, failure } = await backend.prompt(promptText, promptFiles(id, attachments));
      emit(state, { type: "turn_end", stopReason });
      // After turn_end, so the card stays live (a turn_end settles the
      // failures reported before it): this one is why the turn ended.
      if (failure) emit(state, { type: "failure", ...failure });
      // Routine sessions are one-shot and unattended: release the agent
      // process as soon as the turn ends instead of waiting for the reaper,
      // and tell the bell how it went.
      if (isUnattended(state.meta.scope)) {
        dropBackend(state);
        const failed = state.events.some(
          (e) => e.seq > turnStart && (e.type === "error" || (e.type === "failure" && e.severity === "error"))
        );
        void pushNotification({
          kind: failed ? "routine_failed" : "routine_done",
          title: `${await ownerLabel(state.meta, MAIN)} · ${chatLabel(state.meta)} ${failed ? "ended with an error" : "finished"}`,
          body: failed ? lastEventText(state, turnStart, "error") : lastEventText(state, turnStart, "text"),
          href: chatHref(state.meta),
          ...(failed ? { diagnose: routineRef(state.meta) } : {}),
        });
      }
    } catch (err) {
      emit(state, { type: "error", message: (err as Error).message });
      if (isUnattended(state.meta.scope)) {
        void pushNotification({
          kind: "routine_failed",
          title: `${await ownerLabel(state.meta, MAIN)} · ${chatLabel(state.meta)} failed`,
          body: (err as Error).message,
          href: chatHref(state.meta),
          diagnose: routineRef(state.meta),
        });
      }
      // A failed turn may mean a dead subprocess; drop it so the next
      // message spawns a fresh agent (thread history stays on disk).
      forgetFailedResume(state, seat);
      dropBackend(state);
    } finally {
      seat.busy = false;
      void writeMeta(state.meta).catch(() => {});
    }
  })();
  return {};
}

/* ---------- channels ---------- */

/** The chat that holds a channel's transcript; created on first use. */
export async function ensureChannelChat(channel: Channel): Promise<ChatMeta> {
  const metas = await listChatMetas();
  const existing = metas.find((m) => m.scope.kind === "channel" && m.scope.slug === channel.slug);
  if (existing) return chatStates().get(existing.id)?.meta ?? existing;
  const meta = await createChat({ agent: "claude", scope: { kind: "channel", slug: channel.slug }, title: channel.name });
  if (channel.project) {
    meta.project = channel.project;
    await writeMeta(meta);
  }
  return meta;
}

/**
 * "Add a coworker": the chat becomes the channel's transcript.
 *
 * From an agent session, the agent keeps its process and memory — it has
 * seen every message so far — and learns the channel rules with its next
 * prompt. From a project chat, the project assistant has no agent identity
 * to keep, so its process goes; the members join with the whole transcript
 * (a fresh seat starts at seq 0) and the project's context, and the chat
 * stays listed under the project through meta.project.
 */
export async function convertChatToChannel(chatId: string, channel: Channel): Promise<{ error?: string; meta?: ChatMeta }> {
  const state = await loadState(chatId);
  if (!state) return { error: "chat not found" };
  const scope = state.meta.scope;
  if (scope.kind !== "agent" && scope.kind !== "project") return { error: "only an agent session or a project chat can become a channel" };
  if (scope.kind === "agent" && !channel.members.includes(scope.slug)) return { error: `the channel must include @${scope.slug}` };
  if (isBusy(state)) return { error: "agent is still working — wait for the turn to finish" };
  if (scope.kind === "project") {
    if (channel.project !== scope.slug) return { error: `the channel must belong to project "${scope.slug}"` };
    dropBackend(state);
    state.seats.delete(MAIN);
    if (state.meta.sessions?.[MAIN]) {
      const { [MAIN]: _gone, ...rest } = state.meta.sessions;
      state.meta.sessions = rest;
    }
    state.meta.project = scope.slug;
  } else {
    const main = state.seats.get(MAIN);
    state.seats.delete(MAIN);
    const seat = main ?? newSeat(scope.slug, state.meta.agent);
    seat.key = scope.slug;
    seat.needsContext = true;
    seat.seenSeq = state.events[state.events.length - 1]?.seq ?? 0;
    state.seats.set(scope.slug, seat);
    if (state.meta.sessions?.[MAIN]) {
      const { [MAIN]: session, ...rest } = state.meta.sessions;
      state.meta.sessions = { ...rest, [scope.slug]: session };
    }
  }
  state.meta.scope = { kind: "channel", slug: channel.slug };
  state.meta.title = channel.name;
  state.meta.updatedAt = new Date().toISOString();
  await writeMeta(state.meta);
  return { meta: state.meta };
}

/** Members left the channel: their processes go, the transcript stays. */
export async function dropChannelSeats(chatId: string, keep: string[]): Promise<void> {
  const state = chatStates().get(chatId);
  if (!state) return;
  for (const [key, seat] of state.seats) {
    if (!keep.includes(key)) {
      dropSeat(seat);
      state.seats.delete(key);
    }
  }
}

/**
 * Open a vibeable in the chat (or close it with null). The agent's cwd
 * becomes the app folder, so the running subprocess is dropped and the next
 * message spawns one there with fresh context. Refused while a turn runs:
 * the agent would keep editing in the old folder.
 */
export async function setChatVibeable(
  id: string,
  slug: string | null
): Promise<{ error?: string; status?: number; meta?: ChatMeta }> {
  const state = await loadState(id);
  if (!state) return { error: "not found", status: 404 };
  const busyError = { error: "agent is still working — wait for the turn to finish", status: 409 };
  if (isBusy(state)) return busyError;
  let dir: string | null = null;
  if (slug) {
    try {
      dir = (await resolveVibeable(slug)).dir;
    } catch (err) {
      const msg = (err as Error).message;
      return { error: msg, status: /^no vibeable/.test(msg) ? 404 : /are off/.test(msg) ? 409 : 400 };
    }
  }
  // A message may have started a turn during the await above; its backend
  // was spawned in the old cwd, so refuse rather than relabel it. From here
  // on nothing yields until cwd, vibeable and backend agree.
  if (isBusy(state)) return busyError;
  if (slug && dir) {
    state.meta.vibeable = slug;
    state.meta.cwd = dir;
  } else {
    delete state.meta.vibeable;
    state.meta.cwd = defaultCwd(state.meta.scope);
  }
  state.meta.updatedAt = new Date().toISOString();
  dropBackend(state);
  // The agent's session belongs to the old folder: start over there.
  delete state.meta.sessions;
  for (const seat of state.seats.values()) seat.needsContext = true;
  await writeMeta(state.meta);
  return { meta: state.meta };
}

/**
 * Fork a chat: a new chat with the same transcript whose agent continues
 * from a copy of this session (session/fork) — try something without
 * losing the original thread. Needs a session to fork: an agent that keeps
 * one (claude, codex — pi has no ACP session) that has answered at least
 * once. The source's process is (re)spawned if needed; the fork's own
 * process starts with its first message and resumes the forked id.
 */
export async function forkChat(id: string): Promise<{ error?: string; status?: number; meta?: ChatMeta }> {
  const state = await loadState(id);
  if (!state) return { error: "not found", status: 404 };
  const { meta } = state;
  if (meta.scope.kind === "channel") return { error: "a channel cannot be forked", status: 409 };
  if (meta.agent === "pi") return { error: "pi chats have no session to fork", status: 409 };
  if (meta.agent === "codex") return { error: "fork is not supported by codex", status: 409 };
  if (!meta.sessions?.[MAIN]) return { error: "nothing to fork yet — the agent has not answered in this chat", status: 409 };
  if (isBusy(state)) return { error: "agent is still working — wait for the turn to finish", status: 409 };
  const seat = mainSeat(state);
  let forked: string;
  try {
    const backend = await ensureBackend(state, seat);
    if (!backend.fork) return { error: `${meta.agent} cannot fork sessions`, status: 409 };
    forked = await backend.fork();
  } catch (err) {
    return { error: (err as Error).message, status: 409 };
  }
  const now = new Date().toISOString();
  const copy: ChatMeta = {
    ...meta,
    id: newChatId(),
    title: meta.title ? `${meta.title} (fork)` : "",
    sessions: { [MAIN]: forked },
    createdAt: now,
    updatedAt: now,
  };
  await writeMeta(copy);
  await copyChatFiles(meta.id, copy.id);
  return { meta: copy };
}

/**
 * Start over with the agent: drop the process and the stored session id so
 * the next message opens a fresh session (the transcript stays, and goes
 * back in as context). The way out of a session the harness reports as
 * unusable — a "new_session" failure action.
 */
export async function resetSession(id: string): Promise<{ error?: string; status?: number; meta?: ChatMeta }> {
  const state = await loadState(id);
  if (!state) return { error: "not found", status: 404 };
  if (isBusy(state)) return { error: "agent is still working — wait for the turn to finish", status: 409 };
  dropBackend(state);
  delete state.meta.sessions;
  for (const seat of state.seats.values()) seat.needsContext = true;
  state.meta.updatedAt = new Date().toISOString();
  await writeMeta(state.meta);
  emit(state, { type: "error", message: "session reset — the next message starts a fresh one, with the conversation so far as context" });
  return { meta: state.meta };
}

export async function answerElicitation(id: string, requestId: string, answer: ElicitationAnswer): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  const resolve = state.pendingElicitations.get(requestId);
  if (!resolve) return { error: "no such pending question" };
  resolve(answer);
  return {};
}

/**
 * Steer: hand a message into the agent's running turn instead of waiting
 * for it to end. Shown in the thread like any message. When no turn is
 * running (or the agent cannot take steering) it goes the ordinary way.
 */
export async function steerChat(id: string, text: string, attachments?: Attachment[]): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  if (state.meta.scope.kind === "channel") return { error: "channels take messages, not steering — @mention the agent" };
  const seat = mainSeat(state);
  const files = attachments?.length ? attachments : undefined;
  if (!seat.busy || !seat.backend?.steer) return postMessage(id, text, { attachments: files });
  try {
    const outcome = await seat.backend.steer(text, promptFiles(id, files));
    if (outcome === "promptRequired") return postMessage(id, text, { attachments: files });
  } catch (err) {
    return { error: (err as Error).message };
  }
  emit(state, { type: "user_message", text, steered: true, ...(files ? { attachments: files } : {}) });
  void writeMeta(state.meta).catch(() => {});
  return {};
}

export async function stopChatTask(id: string, taskId: string): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  const backend = [...state.seats.values()].find((s) => s.backend?.stopTask)?.backend;
  if (!backend?.stopTask) return { error: "no running agent to stop the task on" };
  try {
    await backend.stopTask(taskId);
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Change a session setting (model, thinking depth, ...) on the chat's live agent. */
export async function setChatConfig(id: string, configId: string, value: string | boolean): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  const backend = mainSeat(state).backend;
  if (!backend?.setConfig) return { error: "the agent is not running — send a message first, the settings appear once it is up" };
  try {
    await backend.setConfig(configId, value);
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** The agent's own sessions in the project root (Claude Code / Codex transcripts), to continue one as a chat. */
export async function listAgentSessionsFor(agent: ChatAgentId): Promise<Array<{ sessionId: string; title?: string; updatedAt?: string; cwd: string }>> {
  if (agent === "pi") return [];
  return listAgentSessions(agent, workspaceRoot());
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

/**
 * Delete a chat: kill its backend, drop the live state, move its folder to
 * the trash. The agents' own transcripts stay until it is deleted from the
 * trash (purgeChatTranscripts), so a restored chat can resume.
 */
/** Rename a chat: its tab and list name. Up to 80 characters, like the name the first message gives it. */
export async function renameChat(id: string, title: unknown): Promise<{ meta?: ChatMeta; error?: string }> {
  if (typeof title !== "string" || !title.replace(/\s+/g, " ").trim()) return { error: "a chat needs a name" };
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  state.meta.title = title.replace(/\s+/g, " ").trim().slice(0, 80);
  await writeMeta(state.meta);
  return { meta: state.meta };
}

export async function deleteChat(id: string): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  for (const resolve of state.pendingPermissions.values()) resolve(null);
  for (const resolve of state.pendingElicitations.values()) resolve({ action: "cancel" });
  dropBackend(state);
  chatStates().delete(id);
  await moveToTrash("chats", id, safeChatDir(id));
  return {};
}

/** The agents' own transcripts of a chat folder (one in the trash), deleted for good. Best effort. */
export async function purgeChatTranscripts(dir: string): Promise<void> {
  const meta = await readMetaAt(dir);
  const cwd = await effectiveCwd(meta);
  for (const [seatKey, sessionId] of Object.entries(meta.sessions ?? {})) {
    const harness = seatKey === MAIN ? meta.agent : (await getAgent(seatKey).catch(() => null))?.harness;
    if (harness && harness !== "pi") await deleteAgentSession(harness, cwd, sessionId).catch(() => {});
  }
}

/**
 * Interrupt the agent's turn — in a channel, one agent's (`agent` = its
 * slug) or every agent's. Whatever the agent was waiting on from a human
 * is dismissed, and an agent queued to run again when its turn ends is
 * not woken after all.
 */
export async function cancelChat(id: string, agent?: string): Promise<{ error?: string }> {
  const state = await loadState(id);
  if (!state) return { error: "not found" };
  const seats = agent ? [state.seats.get(agent)].filter((s): s is Seat => !!s) : [...state.seats.values()];
  if (agent && seats.length === 0) return { error: `@${agent} is not running in this chat` };
  const mine = (requestId: string) => !agent || state.pendingSeat.get(requestId) === agent;
  for (const [requestId, resolve] of state.pendingPermissions) if (mine(requestId)) resolve(null);
  for (const [requestId, resolve] of state.pendingElicitations) if (mine(requestId)) resolve({ action: "cancel" });
  for (const seat of seats) {
    seat.wake = null;
    seat.backend?.cancel();
  }
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
