import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type McpServer,
} from "@agentclientprotocol/sdk";
import type { McpServerConfig } from "./harness.js";

/**
 * Agent Client Protocol plumbing shared by the inspector's chats and the
 * workflow ACP harness: the adapter packages (bundled with kraftwerk, so no
 * CLI on the PATH is needed), model/effort tuning, and spawning one adapter
 * as a subprocess speaking ACP over its stdio.
 *
 * Auth rides on the local CLI logins (Claude Code / Codex) via the
 * inherited environment — same story as the CLI harnesses.
 */

export type AcpAgent = "claude" | "codex";

const ADAPTERS: Record<AcpAgent, string> = {
  claude: "@agentclientprotocol/claude-agent-acp/dist/index.js",
  codex: "@agentclientprotocol/codex-acp/dist/index.js",
};

/** Effort tier -> Claude thinking budget (the adapter reads MAX_THINKING_TOKENS). */
const CLAUDE_THINKING_BUDGET: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32000,
  max: 63999,
};

/**
 * Model/effort overrides ride on adapter-specific channels: the claude
 * adapter takes the model via session `_meta.claudeCode.options` and the
 * thinking budget via env; codex-acp merges a CODEX_CONFIG env JSON into
 * the session config it hands to `codex app-server`.
 */
export function adapterEnv(agent: AcpAgent, tuning: { model?: string; effort?: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (agent === "claude" && tuning.effort && CLAUDE_THINKING_BUDGET[tuning.effort]) {
    env.MAX_THINKING_TOKENS = String(CLAUDE_THINKING_BUDGET[tuning.effort]);
  }
  if (agent === "codex" && (tuning.model || tuning.effort)) {
    env.CODEX_CONFIG = JSON.stringify({
      ...(tuning.model ? { model: tuning.model } : {}),
      ...(tuning.effort ? { model_reasoning_effort: tuning.effort } : {}),
    });
  }
  return env;
}

/** Kraftwerk's MCP config (stdio or url) -> the protocol's session mcpServers entries. */
export function acpMcpServers(servers: Record<string, McpServerConfig> = {}): McpServer[] {
  return Object.entries(servers).map(([name, cfg]) =>
    "url" in cfg
      ? { type: "http" as const, name, url: cfg.url, headers: [] }
      : {
          name,
          command: cfg.command,
          args: cfg.args ?? [],
          env: Object.entries(cfg.env ?? {}).map(([n, value]) => ({ name: n, value })),
        }
  );
}

export interface AcpProcess {
  child: ChildProcessWithoutNullStreams;
  conn: ClientSideConnection;
}

/**
 * Spawn the adapter for `agent` in `cwd`, wire the ACP connection to
 * `client`, and run the initialize handshake. Process failures reach the
 * caller through the callbacks (a failed spawn is otherwise an unhandled
 * 'error' event that takes the host process down).
 */
export async function connectAcp(
  agent: AcpAgent,
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    client: Client;
    clientName: string;
    onError(err: Error): void;
    onClose(code: number | null, stderr: string): void;
  }
): Promise<AcpProcess> {
  const entry = fileURLToPath(import.meta.resolve(ADAPTERS[agent]));
  const child = spawn(process.execPath, [entry], {
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: opts.env,
  });
  let stderr = "";
  child.stderr.on("data", (c: Buffer) => {
    stderr += c.toString("utf8");
    if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
  });
  child.on("error", opts.onError);
  child.on("close", (code) => opts.onClose(code, stderr.trim()));

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  );
  const conn = new ClientSideConnection(() => opts.client, stream);
  await conn.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: opts.clientName, version: "1.0.0" },
  });
  return { child, conn };
}
