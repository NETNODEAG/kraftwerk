/**
 * The harness port: WHICH runtime executes an agent phase.
 *
 * A harness is a complete headless agent runtime (claude -p, codex exec,
 * pi). All of them share the same contract — spawn one short-lived process,
 * stream JSONL events, resume a session by id — so the framework talks to
 * a single interface and one adapter per CLI normalizes the flags and the
 * event schema (see harnesses/).
 *
 * Sessions are per harness: two phases on the same harness share context
 * via resume; across harnesses, context travels through the files in the
 * run directory (the workspace-context contract).
 */

export type HarnessId = "claude" | "codex" | "pi";

export interface AgentInvocation {
  prompt: string;
  systemPrompt: string;
  cwd: string;
  model: string;
  effort?: string;
  tools: string[];
  resume?: string;
  onToolUse?: (tool: string, target: string) => void;
  onText?: (text: string) => void;
}

export interface TokenUsage {
  /** Fresh (uncached) input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface AgentResult {
  sessionId: string;
  text: string;
  numTurns?: number;
  durationMs?: number;
  costUsd?: number;
  usage?: TokenUsage;
}

export interface Harness {
  id: HarnessId;
  invoke(inv: AgentInvocation): Promise<AgentResult>;
}
