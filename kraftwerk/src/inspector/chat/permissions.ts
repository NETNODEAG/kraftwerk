/**
 * Permission requests for sessions nobody is watching live (routine runs).
 *
 * The harness (claude / codex) decides which tool calls need a human; a
 * request reaching kraftwerk means the harness already judged the action
 * worth asking about. Kraftwerk never answers on the human's behalf — it
 * holds the question in the thread, flags the session as waiting, and gives
 * the human this long to look. When nobody does, the request is declined
 * so the routine can end with a clear summary instead of hanging forever.
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
