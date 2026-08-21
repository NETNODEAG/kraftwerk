import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Client,
  type ContentBlock,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { BackendHooks, ChatBackend } from "./backend.js";

/**
 * ACP-backed chat: spawn an adapter (claude-agent-acp / codex-acp) as a
 * subprocess, speak Agent Client Protocol over its stdio, and translate
 * session/update notifications into chat events. One subprocess lives for
 * the whole chat; the ACP session id carries the conversation.
 *
 * Auth rides on the local CLI logins (Claude Code / Codex) via the
 * inherited environment — same story as the kraftwerk harnesses.
 */

const ADAPTERS: Record<"claude" | "codex", string> = {
  claude: "@agentclientprotocol/claude-agent-acp/dist/index.js",
  codex: "@agentclientprotocol/codex-acp/dist/index.js",
};

function contentText(content: ContentBlock): string {
  return content.type === "text" ? content.text : "";
}

export async function startAcpBackend(
  agent: "claude" | "codex",
  cwd: string,
  hooks: BackendHooks
): Promise<ChatBackend> {
  const entry = fileURLToPath(import.meta.resolve(ADAPTERS[agent]));
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [entry], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let stderr = "";
  child.stderr.on("data", (c: Buffer) => {
    stderr += c.toString("utf8");
    if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
  });

  let dead = false;
  child.on("close", (code) => {
    dead = true;
    if (code !== 0 && code !== null) {
      hooks.emit({
        type: "error",
        message: `${agent} agent exited (code ${code})${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}`,
      });
    }
  });

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

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  );
  const conn = new ClientSideConnection(() => client, stream);

  await conn.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: "kraftwerk-inspector", version: "1.0.0" },
  });
  const session = await conn.newSession({ cwd, mcpServers: [] });
  const sessionId = session.sessionId;

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
