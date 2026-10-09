import { randomUUID } from "node:crypto";
import { workspaceRoot } from "../context.js";
import { getAgent } from "../agents.js";
import { getProject } from "../projects.js";
import { startAcpBackend } from "./acp.js";
import { startPiBackend } from "./pi.js";
import { UNATTENDED_PERMISSION_TIMEOUT_MS, declineOption, unattendedTimeoutLabel } from "./permissions.js";
import { chatHref, dismissKey, pushNotification } from "../notifications.js";
import type { BackendTuning, ChatBackend } from "./backend.js";
import type { ChatEvent, ChatMeta, ElicitationAnswer, ElicitationField } from "./types.js";
import { writeMeta } from "./store.js";
import { availableSkills } from "./context.js";
import { effectiveCwd } from "./sessions.js";
import { type ChatState, type Seat, emit, isUnattended, ownerLabel, seatAuthor } from "./state.js";

/**
 * Starting an agent process for a seat: its harness, tuning (model,
 * effort), working folder and context, and wiring its events into the chat.
 */

/* ---------- backend lifecycle ---------- */

/** Agent sessions carry the agent's model/effort; resolved live so edits apply to new backends. */
async function backendTuning(meta: ChatMeta, seat: Seat): Promise<BackendTuning> {
  const { scope } = meta;
  const agent = seat.harness;
  const tuning: BackendTuning = {};
  const agentSlug = scope.kind === "agent" ? scope.slug : scope.kind === "channel" ? seat.key : undefined;
  if (agentSlug) {
    const def = await getAgent(agentSlug).catch(() => null);
    if (def?.model) tuning.model = def.model;
    if (def?.effort) tuning.effort = def.effort;
    // Claude discovers skills natively; an agentined allowlist narrows that.
    if (agent === "claude" && def?.skills) tuning.skills = def.skills;
  }
  // Project chats carry the project's model/effort the same way.
  if (scope.kind === "project") {
    const def = await getProject(scope.slug).catch(() => null);
    if (def?.model) tuning.model = def.model;
    if (def?.effort) tuning.effort = def.effort;
  }
  // Run chats live in the run folder — grant claude the project root so
  // project-level skills and files stay reachable.
  // A vibeable session works inside the app folder for the same reason.
  if ((scope.kind === "run" || meta.vibeable) && agent === "claude") tuning.addDirs = [workspaceRoot()];
  // Routine runs: never a harness mode that skips asking (see unattendedMode in permissions.ts).
  if (isUnattended(scope)) tuning.unattended = true;
  // A seat that had a session before (restart, idle reaper) continues it.
  const previous = meta.sessions?.[seat.key];
  if (previous && agent !== "pi") tuning.resume = previous;
  // pi loads skills only when told: hand it every visible skill folder.
  if (agent === "pi") {
    const skills = await availableSkills(scope);
    if (skills.length > 0) tuning.skillDirs = skills.map((s) => s.dir);
  }
  return tuning;
}

export async function ensureBackend(state: ChatState, seat: Seat): Promise<ChatBackend> {
  if (seat.backend) return seat.backend;
  const me = seatAuthor(seat);
  const hooks = {
    emit: (ev: ChatEvent) => void emit(state, ev, me),
    askPermission: (
      title: string,
      options: Array<{ optionId: string; name: string; kind?: string }>
    ): Promise<string | null> => {
      // The harness already judged this call worth asking about, so the
      // question always goes to a human — routine sessions included. The
      // request stays pending in the thread (and the chat/routine show as
      // waiting) until someone answers. Unattended sessions get a deadline:
      // an unanswered request is declined, never approved, so the routine
      // can wrap up with a summary instead of hanging.
      return new Promise((resolve) => {
        const requestId = randomUUID();
        const notifyKey = `approval:${state.meta.id}:${requestId}`;
        let deadline: NodeJS.Timeout | undefined;
        state.pendingSeat.set(requestId, seat.key);
        state.pendingInfo.set(requestId, { kind: "approval", title, since: new Date().toISOString() });
        state.pendingPermissions.set(requestId, (optionId) => {
          if (deadline) clearTimeout(deadline);
          state.pendingPermissions.delete(requestId);
          state.pendingSeat.delete(requestId);
          state.pendingInfo.delete(requestId);
          emit(state, { type: "permission_resolved", requestId, optionId }, me);
          void dismissKey(notifyKey);
          resolve(optionId);
        });
        emit(state, { type: "permission_request", requestId, title, options }, me);
        // The bell: a question is waiting. Answered -> the item goes away again.
        // The owner lookup is async: answered meanwhile, there is nothing to notify about (and a late item is taken back).
        void ownerLabel(state.meta, seat.key).then(async (who) => {
          if (!state.pendingInfo.has(requestId)) return;
          await pushNotification({
            kind: "approval",
            key: notifyKey,
            title: `${who} needs approval`,
            body: title,
            href: `${chatHref(state.meta)}?focus=${encodeURIComponent(requestId)}`,
          });
          if (!state.pendingInfo.has(requestId)) await dismissKey(notifyKey);
        });
        if (isUnattended(state.meta.scope)) {
          deadline = setTimeout(() => {
            const pending = state.pendingPermissions.get(requestId);
            if (!pending) return;
            emit(state, {
              type: "error",
              message: `nobody answered this permission request within ${unattendedTimeoutLabel()} — declined (unattended routine session)`,
            });
            pending(declineOption(options));
          }, UNATTENDED_PERMISSION_TIMEOUT_MS);
          deadline.unref?.();
        }
      });
    },
    askElicitation: (message: string, fields: ElicitationField[]): Promise<ElicitationAnswer> => {
      // The agent wants to know something before it goes on. Same contract
      // as permissions: the question waits in the thread for a human; an
      // unattended session gets a deadline after which the question is
      // declined (the agent is told the user skipped it), never answered.
      return new Promise((resolve) => {
        const requestId = randomUUID();
        const notifyKey = `question:${state.meta.id}:${requestId}`;
        let deadline: NodeJS.Timeout | undefined;
        state.pendingSeat.set(requestId, seat.key);
        state.pendingInfo.set(requestId, { kind: "question", title: message, since: new Date().toISOString() });
        state.pendingElicitations.set(requestId, (answer) => {
          if (deadline) clearTimeout(deadline);
          state.pendingElicitations.delete(requestId);
          state.pendingSeat.delete(requestId);
          state.pendingInfo.delete(requestId);
          emit(state, { type: "elicitation_resolved", requestId, ...answer }, me);
          void dismissKey(notifyKey);
          resolve(answer);
        });
        emit(state, { type: "elicitation_request", requestId, message, fields }, me);
        // The owner lookup is async: answered meanwhile, there is nothing to notify about (and a late item is taken back).
        void ownerLabel(state.meta, seat.key).then(async (who) => {
          if (!state.pendingInfo.has(requestId)) return;
          await pushNotification({
            kind: "approval",
            key: notifyKey,
            title: `${who} has a question`,
            body: message,
            href: `${chatHref(state.meta)}?focus=${encodeURIComponent(requestId)}`,
          });
          if (!state.pendingInfo.has(requestId)) await dismissKey(notifyKey);
        });
        if (isUnattended(state.meta.scope)) {
          deadline = setTimeout(() => {
            const pending = state.pendingElicitations.get(requestId);
            if (!pending) return;
            emit(state, {
              type: "error",
              message: `nobody answered the agent's question within ${unattendedTimeoutLabel()} — skipped (unattended routine session)`,
            });
            pending({ action: "decline" });
          }, UNATTENDED_PERMISSION_TIMEOUT_MS);
          deadline.unref?.();
        }
      });
    },
  };
  const agent = seat.harness;
  const cwd = await effectiveCwd(state.meta);
  const tuning = await backendTuning(state.meta, seat);
  seat.backend =
    agent === "pi"
      ? startPiBackend(cwd, hooks, tuning)
      : await startAcpBackend(agent, cwd, hooks, tuning);
  if (seat.backend.sessionId) {
    state.meta.sessions = { ...state.meta.sessions, [seat.key]: seat.backend.sessionId };
    void writeMeta(state.meta).catch(() => {});
  }
  // A resumed session still has the conversation (and the scope context)
  // in its window. A fresh process is a fresh context window: re-send the
  // scope context with the next prompt.
  seat.needsContext = !seat.backend.resumed;
  return seat.backend;
}
