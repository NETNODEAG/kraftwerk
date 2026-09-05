import { RequestError, type Client, type ContentBlock, type RequestPermissionRequest, type RequestPermissionResponse, type SessionNotification } from "@agentclientprotocol/sdk";
import { adapterEnv, connectAcp } from "../../acp.js";
import type { BackendHooks, BackendTuning, ChatBackend } from "./backend.js";
import { unattendedMode } from "./permissions.js";

/**
 * ACP-backed chat: spawn an adapter (claude-agent-acp / codex-acp) as a
 * subprocess, speak Agent Client Protocol over its stdio, and translate
 * session/update notifications into chat events. One subprocess lives for
 * the whole chat; the ACP session id carries the conversation. The
 * adapter plumbing is shared with the workflow ACP harness (src/acp.ts).
 */

function contentText(content: ContentBlock): string {
  return content.type === "text" ? content.text : "";
}

export async function startAcpBackend(
  agent: "claude" | "codex",
  cwd: string,
  hooks: BackendHooks,
  tuning: BackendTuning = {}
): Promise<ChatBackend> {
  let dead = false;
  const client: Client = {
    sessionUpdate(params: SessionNotification): void {
      const u = params.update;
      switch (u.sessionUpdate) {
        case "agent_message_chunk": {
          const text = contentText(u.content);
          if (text) hooks.emit({ type: "text", text });
          break;
        }
        case "agent_thought_chunk": {
          const text = contentText(u.content);
          if (text) hooks.emit({ type: "thought", text });
          break;
        }
        case "tool_call":
          hooks.emit({
            type: "tool_call",
            callId: u.toolCallId,
            title: u.title,
            kind: u.kind ?? undefined,
            status: u.status ?? undefined,
          });
          break;
        case "tool_call_update":
          hooks.emit({
            type: "tool_update",
            callId: u.toolCallId,
            title: u.title ?? undefined,
            status: u.status ?? undefined,
          });
          break;
        // plans, mode/config updates etc. carry no thread content — skip.
      }
    },
    async requestPermission(
      params: RequestPermissionRequest
    ): Promise<RequestPermissionResponse> {
      const optionId = await hooks.askPermission(
        params.toolCall.title ?? params.toolCall.toolCallId,
        params.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind }))
      );
      return optionId
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } };
    },
  };

  const { child, conn } = await connectAcp(agent, {
    cwd,
    env: adapterEnv(agent, tuning),
    client,
    clientName: "kraftwerk-inspector",
    onError: (err) => {
      dead = true;
      hooks.emit({ type: "error", message: `could not start the ${agent} agent: ${err.message}` });
    },
    onClose: (code, stderr) => {
      dead = true;
      if (code !== 0 && code !== null) {
        hooks.emit({
          type: "error",
          message: `${agent} agent exited (code ${code})${stderr ? `: ${stderr.slice(-500)}` : ""}`,
        });
      }
    },
  });
  // Claude-only session options ride on _meta.claudeCode.options (the
  // adapter spreads them into the Agent SDK options): model override,
  // skill allowlist (undefined = all discovered skills), extra work dirs.
  const claudeOptions: Record<string, unknown> = {
    ...(tuning.model ? { model: tuning.model } : {}),
    ...(tuning.skills ? { skills: tuning.skills } : {}),
    ...(tuning.addDirs?.length ? { additionalDirectories: tuning.addDirs } : {}),
    // Chrome browser tools when available (needs subscription auth; a
    // no-op on API-key auth, where Claude Code keeps the integration off).
    extraArgs: { chrome: null },
  };
  const session = await conn.newSession({
    cwd,
    mcpServers: [],
    ...(agent === "claude" && Object.keys(claudeOptions).length
      ? { _meta: { claudeCode: { options: claudeOptions } } }
      : {}),
  });
  const sessionId = session.sessionId;
  if (tuning.unattended) {
    // Nobody is watching: keep the harness's configured mode unless it is
    // one that never asks (see unattendedMode). The harness keeps deciding
    // which calls reach a human; kraftwerk only rules out "never ask".
    const modeId = unattendedMode(agent, session.modes?.currentModeId);
    if (modeId) {
      // A mode the adapter does not offer must not kill the session: the
      // harness default applies, and the thread shows why.
      await conn.setSessionMode({ sessionId, modeId }).catch((err: Error) => {
        hooks.emit({
          type: "error",
          message: `could not select the ${modeId} mode for this unattended session (${err.message}) — the ${agent} default applies`,
        });
      });
    }
  }

  return {
    async prompt(text: string): Promise<string> {
      if (dead) throw new Error(`${agent} agent process is gone — start a new chat`);
      try {
        const res = await conn.prompt({
          sessionId,
          prompt: [{ type: "text", text }],
        });
        return res.stopReason;
      } catch (err) {
        if (err instanceof RequestError) throw new Error(`${agent} agent: ${err.message}`);
        throw err;
      }
    },
    cancel(): void {
      if (!dead) void conn.cancel({ sessionId }).catch(() => {});
    },
    dispose(): void {
      if (!dead) child.kill("SIGTERM");
    },
  };
}
