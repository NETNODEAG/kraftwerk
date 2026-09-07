import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type McpServer,
  type SessionConfigOption,
  type SessionModeState,
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

/* ---------- protocol extensions ---------- */

/**
 * Session updates beyond the published ACP schema, from the "AIR"
 * extension claude-agent-acp negotiates (agent-client-protocol#1992 for
 * subagents; async tasks alongside). A client that advertises the
 * capabilities gets Claude's subagents as independent child sessions
 * (`subagent_spawned`, then ordinary updates carrying the child's session
 * id) and its background work (backgrounded shells, monitors, workflows)
 * as async tasks — instead of the flattened generic Agent/Task tool call.
 *
 * The SDK validates every session/update against its schema and does not
 * know these kinds yet, so they never reach the Client through the SDK:
 * connectAcp diverts them off the wire before the SDK sees them.
 */
export type SubagentState = "completed" | "failed" | "cancelled" | "disconnected";
export type AsyncTaskState = "running" | "paused" | "completed" | "failed" | "stopped";

export type AcpExtensionUpdate =
  | { sessionUpdate: "subagent_spawned"; subagentSessionId: string; name: string; task: string }
  | { sessionUpdate: "subagent_state_update"; subagentSessionId: string; state: SubagentState }
  | {
      sessionUpdate: "async_task_spawned";
      asyncTaskId: string;
      name: string;
      taskType: string;
      description: string;
      showInTranscript?: boolean;
      canStop?: boolean;
      outputFilePath?: string;
      toolCallId?: string;
    }
  | {
      sessionUpdate: "async_task_progress";
      asyncTaskId: string;
      description?: string;
      summary?: string;
      lastToolName?: string;
      outputFilePath?: string;
      toolCallId?: string;
    }
  | {
      sessionUpdate: "async_task_state_update";
      asyncTaskId: string;
      state: AsyncTaskState;
      summary?: string;
      outputFilePath?: string;
      toolCallId?: string;
    };

export interface AcpExtensionNotification {
  sessionId: string;
  update: AcpExtensionUpdate;
}

const EXTENSION_KINDS = new Set<string>([
  "subagent_spawned",
  "subagent_state_update",
  "async_task_spawned",
  "async_task_progress",
  "async_task_state_update",
]);
// Cheap pre-check so only candidate lines are parsed.
const EXTENSION_LINE = /"sessionUpdate"\s*:\s*"(subagent_|async_task_)/;

/**
 * What kraftwerk advertises: the AIR extension's capability list in the
 * client's `_meta` — native subagent and async task streams, session
 * failures (rate limits, expired logins, provider outages) as structured
 * `session_info_update` metadata with a recommended action instead of
 * prose, and the per-turn file change report (see fileChangeReportMeta).
 * Both adapters implement the extension; an adapter without it ignores
 * the list and keeps its plain stream.
 */
export function extensionClientMeta(): Record<string, unknown> {
  return {
    jetbrains: {
      air: { version: 1, capabilities: ["nativeSubagentSessions", "asyncTasks", "sessionFailure", "agentFileChangeReport"] },
    },
  };
}

/**
 * Prompt `_meta` asking for a file change report at the end of the turn:
 * the adapter gives the agent a `report_changed_files` tool and the
 * result arrives as `session_info_update` metadata. One id per prompt.
 */
export function fileChangeReportMeta(requestId: string): Record<string, unknown> {
  return { jetbrains: { air: { version: 1, agentFileChangeReportRequest: { version: 1, requestId } } } };
}

/** Extension request methods the claude adapter offers (advertised in its initialize `_meta`). */
export const EXT_METHODS = {
  /** Inject a message into the running turn. */
  steer: "_session/steering",
  /** Stop one background task without cancelling the turn. */
  stopAsyncTask: "_session/async_task/stop",
} as const;

/** Extension notifications an adapter pushes to the client. */
export const EXT_NOTIFICATIONS = {
  /** Who the agent is signed in as (claude-agent-acp authStatus extension). */
  authStatus: "_auth/status_update",
} as const;

/** The AIR payload for `capability` inside a `_meta`, if the peer sent one. */
export function airMeta<T = Record<string, unknown>>(meta: unknown, capability: string): T | undefined {
  const air = (meta as { jetbrains?: { air?: Record<string, unknown> } } | null | undefined)?.jetbrains?.air;
  const payload = air?.[capability];
  return payload && typeof payload === "object" ? (payload as T) : undefined;
}

/** The extension notification on one wire line, if that is what the line is. */
export function parseExtensionLine(line: string): AcpExtensionNotification | null {
  if (!EXTENSION_LINE.test(line)) return null;
  try {
    const msg = JSON.parse(line) as { method?: string; params?: { sessionId?: string; update?: { sessionUpdate?: string } } };
    if (msg.method !== "session/update") return null;
    const update = msg.params?.update;
    if (!update || !EXTENSION_KINDS.has(update.sessionUpdate ?? "") || typeof msg.params?.sessionId !== "string") return null;
    return { sessionId: msg.params.sessionId, update: update as AcpExtensionUpdate };
  } catch {
    return null;
  }
}

/**
 * Filter the adapter's newline-delimited JSON-RPC output: extension
 * session updates go to `onExtension`, everything else passes through
 * byte-for-byte for the SDK. Lines may arrive split across chunks.
 */
export function divertExtensionUpdates(
  source: ReadableStream<Uint8Array>,
  onExtension: (n: AcpExtensionNotification) => void
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = "";
  const handle = (line: string, ctrl: TransformStreamDefaultController<Uint8Array>, tail: string) => {
    const ext = parseExtensionLine(line);
    if (ext) onExtension(ext);
    else ctrl.enqueue(encoder.encode(line + tail));
  };
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        buffered += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, nl);
          buffered = buffered.slice(nl + 1);
          handle(line, ctrl, "\n");
        }
      },
      flush(ctrl) {
        buffered += decoder.decode();
        if (buffered) handle(buffered, ctrl, "");
        buffered = "";
      },
    })
  );
}

/* ---------- process + session ---------- */

export interface AcpProcess {
  child: ChildProcessWithoutNullStreams;
  conn: ClientSideConnection;
}

/**
 * Spawn the adapter for `agent` in `cwd`, wire the ACP connection to
 * `client`, and run the initialize handshake. Process failures reach the
 * caller through the callbacks (a failed spawn is otherwise an unhandled
 * 'error' event that takes the host process down).
 *
 * `onExtension` opts into the native subagent / async task streams (see
 * AcpExtensionUpdate); without it the adapter keeps its generic tool-call
 * representation of that work.
 */
export async function connectAcp(
  agent: AcpAgent,
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    client: Client;
    clientName: string;
    onExtension?: (n: AcpExtensionNotification) => void;
    /** The client answers form elicitations (`createElicitation` on the Client): agents may ask questions. */
    elicitation?: boolean;
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

  let output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
  if (opts.onExtension) output = divertExtensionUpdates(output, opts.onExtension);
  const stream = ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, output);
  const conn = new ClientSideConnection(() => opts.client, stream);
  await conn.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      ...(opts.elicitation ? { elicitation: { form: {} } } : {}),
      ...(opts.onExtension ? { _meta: extensionClientMeta() } : {}),
    },
    clientInfo: { name: opts.clientName, version: "1.0.0" },
  });
  return { child, conn };
}

/**
 * Run `fn` against a short-lived adapter that opens no session: for
 * listing or deleting the agent's own sessions. The adapter is gone when
 * `fn` settles.
 */
export async function withAdapter<T>(
  agent: AcpAgent,
  cwd: string,
  fn: (conn: ClientSideConnection) => Promise<T>
): Promise<T> {
  const { child, conn } = await connectAcp(agent, {
    cwd,
    env: adapterEnv(agent, {}),
    clientName: "kraftwerk",
    client: {
      sessionUpdate() {},
      async requestPermission() {
        return { outcome: { outcome: "cancelled" } };
      },
    },
    onError() {},
    onClose() {},
  });
  try {
    return await fn(conn);
  } finally {
    child.kill("SIGTERM");
  }
}

/** The subset of the connection a session open needs (a test can stand in for it). */
export type SessionOpener = Pick<ClientSideConnection, "newSession" | "resumeSession">;

export interface OpenedSession {
  sessionId: string;
  modes?: SessionModeState | null;
  /** Session settings the agent lets the client change (model, thinking depth, ...). */
  configOptions?: SessionConfigOption[] | null;
  /** The session continues an earlier one (same id, the agent's own history). */
  resumed: boolean;
  /** A resume was asked for but refused; a fresh session was opened instead. */
  resumeError?: string;
}

/**
 * Open a session: continue `resume` when given (session/resume — the
 * agent's own transcript carries the history, no replay), else a new one.
 * A refused resume (unknown id, adapter without the method, transcript
 * gone) falls back to a new session and says so, instead of failing the
 * chat: the conversation on disk is still there for the human, the agent
 * just starts without it in context.
 */
export async function openSession(
  conn: SessionOpener,
  req: { cwd: string; mcpServers: McpServer[]; _meta?: Record<string, unknown> },
  resume?: string
): Promise<OpenedSession> {
  let resumeError: string | undefined;
  if (resume) {
    try {
      const res = await conn.resumeSession({ sessionId: resume, ...req });
      return { sessionId: resume, modes: res.modes, configOptions: res.configOptions, resumed: true };
    } catch (err) {
      resumeError = (err as Error).message;
    }
  }
  const res = await conn.newSession(req);
  return { sessionId: res.sessionId, modes: res.modes, configOptions: res.configOptions, resumed: false, ...(resumeError ? { resumeError } : {}) };
}
