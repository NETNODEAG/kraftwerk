/**
 * Permission requests for sessions nobody is watching live.
 *
 * The harness (claude / codex) decides which tool calls need a human; a
 * request reaching kraftwerk means the harness already judged the action
 * worth asking about. For a routine, kraftwerk never answers on the human's
 * behalf — it holds the question in the thread, flags the session as
 * waiting, and gives the human this long to look. When nobody does, the
 * request is declined so the routine can end with a clear summary instead
 * of hanging forever.
 *
 * A *contained* session is the one exception, and only because the question
 * has already been answered somewhere better. When a customer talks to a
 * sandboxed agent over a share link there is no one on that side who may
 * decide anything — asking them would be asking them to approve an action
 * on the workspace's authority — and the admin has already drawn the limits
 * in `sandbox:`: which files exist in the container, which hosts it can
 * reach, which commands it can run, all enforced by the kernel rather than
 * by a prompt. Inside that box the agent may use what it was given, and the
 * turn is not worth stalling over. Outside one there is no box, so this
 * never applies to an agent that runs on the host.
 */
export const UNATTENDED_PERMISSION_TIMEOUT_MS = 30 * 60_000;

export interface PermissionOption {
  optionId: string;
  name: string;
  kind?: string;
}

/**
 * The option that declines a request without ending the turn: the adapter's
 * `reject_once` (ACP kinds are allow_once / allow_always / reject_once /
 * reject_always). null cancels the tool call outright when no reject option
 * is offered — never an "allow".
 */
export function declineOption(options: PermissionOption[]): string | null {
  const reject =
    options.find((o) => o.kind === "reject_once") ??
    options.find((o) => o.kind?.startsWith("reject"));
  return reject?.optionId ?? null;
}

/** Human-readable timeout for prompts and thread notes. */
export function unattendedTimeoutLabel(ms: number = UNATTENDED_PERMISSION_TIMEOUT_MS): string {
  const min = Math.round(ms / 60_000);
  return min === 1 ? "1 minute" : `${min} minutes`;
}

/**
 * Session mode for an unattended (routine) session, given the mode the
 * harness opened with (its configured default). Returns the mode to switch
 * to, or null to keep the current one. The harness stays the judge of what
 * needs a human; this only rules out the two presets that never ask —
 * claude bypassPermissions and codex agent-full-access — and lifts claude's
 * plain "default" (ask for every edit) to acceptEdits so a routine can write
 * inside the project without stalling. claude's "auto" mode (its own
 * classifier decides) and acceptEdits are kept as they are.
 */
export function unattendedMode(agent: "claude" | "codex", current: string | undefined): string | null {
  if (agent === "codex") return current === "agent-full-access" || !current ? "agent" : null;
  return current === "auto" || current === "acceptEdits" ? null : "acceptEdits";
}

/**
 * Session mode for a contained session: the harness preset that does not
 * ask. This is exactly what `unattendedMode` rules out, and the difference
 * between the two is the sandbox — see the note at the top of this file.
 * Only ever reached for a share-link session whose agent runs in one.
 */
export function containedMode(agent: "claude" | "codex"): string {
  return agent === "codex" ? "agent-full-access" : "bypassPermissions";
}

/**
 * The option that allows a request, for a contained session where a prompt
 * has nowhere to go. Prefers "just this once" over "always", so nothing is
 * written into the harness's stored answers on a customer's behalf. null
 * when no allow option is offered — then the caller declines as usual,
 * because inventing consent is worse than a failed tool call.
 */
export function allowOption(options: PermissionOption[]): string | null {
  const allow =
    options.find((o) => o.kind === "allow_once") ??
    options.find((o) => o.kind?.startsWith("allow"));
  return allow?.optionId ?? null;
}
