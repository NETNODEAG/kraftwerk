import {
  RequestError,
  type Client,
  type ClientSideConnection,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentInvocation, AgentResult, Harness, HarnessId } from "../harness.js";
import { acpMcpServers, adapterEnv, connectAcp, openSession, type AcpAgent } from "../acp.js";
import { declineOption, unattendedMode } from "../inspector/chat/permissions.js";

/**
 * Agent Client Protocol harness: a phase is one prompt on an ACP session
 * with the same adapters the inspector's chats use (claude-agent-acp,
 * codex-acp — bundled, no CLI on the PATH needed). The adapter process
 * stays alive for the whole run: the session id the engine passes back as
 * `resume` finds the live session, so phases on one harness share context
 * exactly like `--resume` does for the CLI harnesses. A session id without
 * a live adapter (the run continues in a new process) is resumed over
 * session/resume — the agent's own transcript carries the context.
 *
 * Normalization versus the CLI harnesses:
 *  - ACP has no per-prompt system prompt, so persona + workspace context
 *    are carried inside each phase prompt (the codex quirk, for both).
 *  - claude: `tools`, CLI grants and MCP servers become the session's
 *    allowlist through `_meta.claudeCode.options`, settings sources are
 *    off (hermetic). The permission mode is selected after the session
 *    opens (acceptEdits on claude, the workspace-write "agent" mode on
 *    codex) — the same rule the inspector applies to unattended chats.
 *  - A permission request the harness still raises is declined: nobody
 *    watches a workflow run, and kraftwerk never answers for a human.
 *  - Both adapters report each turn's own token usage; cost arrives as a
 *    session total, so each turn reports the increase.
 *
 * Adapter processes belong to the run: `disposeAcpSessions(runDir)` at the
 * end of a run (the YAML runner does it; a programmatic Run must too).
 */

interface Turn {
  text: string;
  onToolUse?: AgentInvocation["onToolUse"];
  /** Tool calls announced without a target ("Preparing file…"), by call id. */
  pending: Map<string, { kind: string; title: string }>;
}

interface Live {
  agent: AcpAgent;
  cwd: string;
  child: ChildProcessWithoutNullStreams;
  conn: ClientSideConnection;
  sessionId: string;
  dead: boolean;
  /** Why the adapter is gone, once it is. */
  exit?: string;
  /** Resolves with `exit` when the adapter process ends. */
  closed: Promise<string>;
  turn: Turn | null;
  /** Session cost total as last reported, for per-turn increases. */
  cost: number;
}

const live = new Map<string, Live>();
// The run process is the adapters' only owner: never leave one behind.
process.once("exit", () => disposeAcpSessions());

/** Claude Agent SDK options for a phase session: the CLI harness's flags, as session meta. */
export function claudeSessionOptions(inv: Pick<AgentInvocation, "model" | "tools" | "clis" | "mcpServers">): Record<string, unknown> {
  return {
    model: inv.model,
    // Keep the run hermetic: no user/project settings, hooks, or CLAUDE.md.
    settingSources: [],
    allowedTools: [
      ...inv.tools,
      ...(inv.clis ?? []).map((name) => `Bash(${name}:*)`),
      ...Object.keys(inv.mcpServers ?? {}).map((name) => `mcp__${name}`),
    ],
  };
}

/**
 * What a tool call touched, from its input (path, url, command) or its
 * first location. Undefined when the adapter has not said yet — a title
 * alone may be a placeholder.
 */
export function toolTarget(u: { rawInput?: Record<string, unknown>; locations?: Array<{ path?: string }> }): string | undefined {
  const input = u.rawInput ?? {};
  const raw = input.file_path ?? input.url ?? input.path ?? input.command ?? u.locations?.[0]?.path;
  if (raw == null) return undefined;
  const target = String(raw).replace(/\s+/g, " ").trim();
  return target.length > 160 ? `${target.slice(0, 160)}…` : target;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function open(agent: AcpAgent, inv: AgentInvocation, resume?: string): Promise<Live> {
  let ended!: (why: string) => void;
  const closed = new Promise<string>((r) => (ended = r));
  const state = {
    agent,
    cwd: inv.cwd,
    sessionId: "",
    dead: false,
    closed,
    turn: null,
    cost: 0,
  } as Live;
  const end = (why: string) => {
    state.dead = true;
    state.exit ??= why;
    ended(state.exit);
  };
  const client: Client = {
    sessionUpdate(params: SessionNotification): void {
      const u = params.update as {
        sessionUpdate: string;
        toolCallId?: string;
        kind?: string;
        title?: string;
        rawInput?: Record<string, unknown>;
        locations?: Array<{ path?: string }>;
        content?: { type: string; text?: string };
        cost?: { amount?: number };
      };
      const turn = state.turn;
      if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text" && turn) {
        turn.text += u.content.text ?? "";
      } else if (u.sessionUpdate === "tool_call" && turn) {
        const kind = u.kind ?? "tool";
        const target = toolTarget(u);
        if (target) turn.onToolUse?.(kind, target);
        else turn.pending.set(u.toolCallId ?? "", { kind, title: String(u.title ?? "") });
      } else if (u.sessionUpdate === "tool_call_update" && turn?.pending.has(u.toolCallId ?? "")) {
        const target = toolTarget(u);
        if (target) {
          turn.onToolUse?.(turn.pending.get(u.toolCallId ?? "")!.kind, target);
          turn.pending.delete(u.toolCallId ?? "");
        }
      } else if (u.sessionUpdate === "usage_update" && typeof u.cost?.amount === "number") {
        state.cost = u.cost.amount;
      }
    },
    async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
      // The harness judged this worth asking; a workflow run has nobody to ask.
      const optionId = declineOption(params.options);
      console.log(`  ⛔ ${params.toolCall.title ?? params.toolCall.toolCallId} — permission declined (unattended run)`);
      return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
    },
  };

  const { child, conn } = await connectAcp(agent, {
    cwd: inv.cwd,
    env: adapterEnv(agent, { model: inv.model, effort: inv.effort }),
    client,
    clientName: "kraftwerk",
    onError: (err) => end(`could not start the ${agent} adapter: ${err.message}`),
    onClose: (code, stderr) => end(`${agent} adapter exited (code ${code})${stderr ? `: ${stderr.slice(-500)}` : ""}`),
  });
  state.child = child;
  state.conn = conn;

  try {
    const session = await openSession(
      conn,
      {
        cwd: inv.cwd,
        mcpServers: acpMcpServers(inv.mcpServers),
        ...(agent === "claude" ? { _meta: { claudeCode: { options: claudeSessionOptions(inv) } } } : {}),
      },
      resume
    );
    if (session.resumeError) {
      console.log(`  ⚠ could not resume session ${resume} (${session.resumeError}) — a new ${agent} session starts without the earlier phases in context`);
    }
    state.sessionId = session.sessionId;
    const modeId = unattendedMode(agent, session.modes?.currentModeId);
    if (modeId) {
      await conn.setSessionMode({ sessionId: session.sessionId, modeId }).catch((err: Error) => {
        console.log(`  ⚠ could not select the ${modeId} mode (${err.message}) — the ${agent} default applies`);
      });
    }
  } catch (err) {
    // A refused session leaves the adapter running; it must not outlive the failure.
    if (!state.dead) child.kill("SIGTERM");
    throw await failure(state, agent, err);
  }
  live.set(state.sessionId, state);
  return state;
}

/**
 * The error to surface for a failed request. When the adapter died, the
 * SDK rejects on stdout EOF before the process 'close' event carries the
 * stderr tail — give that a moment and prefer it, it names the real cause.
 */
async function failure(state: Live, agent: AcpAgent, err: unknown): Promise<Error> {
  const closing = /connection closed|closed/i.test((err as Error).message ?? "");
  if (state.dead || closing) await Promise.race([state.closed, wait(1000)]);
  if (state.exit) return new Error(state.exit);
  if (err instanceof RequestError) return new Error(`${agent} (acp): ${err.message}`);
  return err as Error;
}

async function invoke(agent: AcpAgent, inv: AgentInvocation): Promise<AgentResult> {
  let s = inv.resume ? live.get(inv.resume) : undefined;
  if (s?.dead) {
    live.delete(s.sessionId);
    s = undefined;
  }
  // No live adapter for the id (a new process, or the adapter died): resume it in a fresh one.
  s ??= await open(agent, inv, inv.resume);

  const turn: Turn = { text: "", onToolUse: inv.onToolUse, pending: new Map() };
  s.turn = turn;
  const prevCost = s.cost;
  const started = Date.now();
  // No per-prompt system prompt over ACP: carry persona + context in the prompt.
  const prompt =
    `# Role and workspace context for this phase\n\n${inv.systemPrompt}\n\n` + `# Task\n\n${inv.prompt}`;
  let res;
  try {
    res = await s.conn.prompt({ sessionId: s.sessionId, prompt: [{ type: "text", text: prompt }] });
  } catch (err) {
    s.turn = null;
    throw await failure(s, agent, err);
  }
  s.turn = null;
  // Calls the adapter never named (no update carried a target) still count.
  for (const p of turn.pending.values()) inv.onToolUse?.(p.kind, p.title);
  if (res.stopReason !== "end_turn") throw new Error(`${agent} (acp) stopped with ${res.stopReason}`);
  if (inv.onText && turn.text.trim()) inv.onText(turn.text.trim());

  const result: AgentResult = {
    sessionId: s.sessionId,
    text: turn.text,
    durationMs: Date.now() - started,
  };
  if (res.usage) {
    result.usage = {
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      cacheReadTokens: res.usage.cachedReadTokens ?? 0,
      cacheCreationTokens: res.usage.cachedWriteTokens ?? 0,
    };
  }
  if (s.cost > prevCost) result.costUsd = s.cost - prevCost;
  return result;
}

/**
 * Stop the adapter processes of one run (its run directory), or of every
 * run in this process when no directory is given.
 */
export function disposeAcpSessions(cwd?: string): void {
  for (const [id, s] of live) {
    if (cwd && s.cwd !== cwd) continue;
    if (!s.dead) s.child.kill("SIGTERM");
    live.delete(id);
  }
}

export function acpHarness(id: HarnessId): Harness {
  if (id === "pi") throw new Error('runs-on "pi" has no agent-protocol adapter — use claude or codex, or protocol: cli');
  return { id, invoke: (inv) => invoke(id, inv) };
}
