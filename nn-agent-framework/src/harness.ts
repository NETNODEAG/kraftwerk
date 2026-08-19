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

/**
 * One MCP server an agent may use: either a local stdio server (spawned by
 * the harness, e.g. `node multiply-server.ts`) or a remote streamable-HTTP
 * server (`url`). Names must be [A-Za-z0-9_-]. Supported by the claude and
 * codex harnesses; pi has no MCP support and rejects the invocation.
 */
export type McpServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { url: string };

export interface AgentInvocation {
  prompt: string;
  systemPrompt: string;
  cwd: string;
  model: string;
  effort?: string;
  tools: string[];
  /**
   * CLI command prefixes granted for this phase (e.g. "git", "npm run").
   * claude: each becomes a scoped `Bash(<name>:*)` allowlist entry.
   * codex: the sandbox runs commands anyway — nothing to do.
   * pi: no per-command scoping — enables the plain bash tool.
   */
  clis?: string[];
  /** MCP servers available in this phase, keyed by server name. */
  mcpServers?: Record<string, McpServerConfig>;
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
