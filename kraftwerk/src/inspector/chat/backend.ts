import type { ChatEvent } from "./types.js";

/**
 * A chat backend is one live agent conversation: prompt() runs a full turn
 * (resolves when the agent finishes), streaming intermediate activity
 * through the hooks. ACP agents (claude, codex) keep a subprocess alive for
 * the whole chat; pi respawns per message and resumes via --session-id.
 */

export interface BackendHooks {
  /** Stream a thread event (text chunk, tool call, ...) to the session. */
  emit(ev: ChatEvent): void;
  /**
   * Surface a permission request to the user; resolves with the chosen
   * optionId, or null when the user (or a cancel) dismissed it.
   */
  askPermission(
    title: string,
    options: Array<{ optionId: string; name: string; kind?: string }>
  ): Promise<string | null>;
}

/**
 * Optional per-chat model/effort overrides (from a team member definition).
 * Each backend maps them onto whatever its agent actually supports.
 */
export interface BackendTuning {
  model?: string;
  effort?: string;
}

export interface ChatBackend {
  /** Send one user message; resolves with the stop reason at turn end. */
  prompt(text: string): Promise<string>;
  /** Interrupt the current turn (the running prompt() still resolves). */
  cancel(): void;
  /** Kill the agent subprocess, if any. */
  dispose(): void;
}
