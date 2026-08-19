import { spawn } from "node:child_process";
import type { AgentInvocation, AgentResult, Harness } from "../harness.js";

/**
 * Claude Code harness: one phase = one freshly spawned headless `claude -p`
 * process. Session continuity across phases comes from `--resume
 * <session-id>`, so every process is short-lived but the editorial context
 * survives the whole run.
 *
 * stream-json output gives the orchestrator a live event feed (init message
 * with the session id, tool calls, final result) without any SDK dependency.
 * Auth is the local Claude Code login — no API key needed.
 *
 * MCP: servers from the invocation are passed as an inline `--mcp-config`
 * JSON (stdio: command/args/env, remote: type http + url) together with
 * `--strict-mcp-config`, so no user-configured MCP servers leak into the
 * run. Each granted server extends the allowlist with `mcp__<name>`, which
 * claude expands to every tool of that server.
 *
 * CLIs: each granted CLI becomes a scoped `Bash(<name>:*)` allowlist entry —
 * that command prefix runs headless without approval, everything else keeps
 * claude's default judgment (read-only commands auto-approve, mutating ones
 * are denied in -p; verified against claude-code 2.x).
 */

interface StreamMessage {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  is_error?: boolean;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  message?: { content?: Array<Record<string, any>> };
}

function invokeClaude(inv: AgentInvocation): Promise<AgentResult> {
  const mcpNames = Object.keys(inv.mcpServers ?? {});
  const allowedTools = [
    ...inv.tools,
    ...(inv.clis ?? []).map((name) => `Bash(${name}:*)`),
    ...mcpNames.map((name) => `mcp__${name}`),
  ];
  const args = [
    "-p",
    "--chrome",
    "--output-format", "stream-json",
    "--verbose",
    "--model", inv.model,
    "--system-prompt", inv.systemPrompt,
    "--allowed-tools", allowedTools.join(","),
    "--permission-mode", "acceptEdits",
    // Keep the run hermetic: no user/project settings, hooks, or CLAUDE.md.
    "--setting-sources", "",
  ];
  if (mcpNames.length > 0) {
    const mcpServers = Object.fromEntries(
      Object.entries(inv.mcpServers!).map(([name, cfg]) => [
        name,
        "url" in cfg ? { type: "http", url: cfg.url } : cfg,
      ])
    );
    args.push("--mcp-config", JSON.stringify({ mcpServers }), "--strict-mcp-config");
  }
  if (inv.effort) args.push("--effort", inv.effort);
  if (inv.resume) args.push("--resume", inv.resume);

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: inv.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write(inv.prompt);
    child.stdin.end();

    let sessionId: string | undefined;
    let final: AgentResult | undefined;
    let stderr = "";
    let buffer = "";

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let msg: StreamMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // non-JSON noise on stdout
      }

      if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
        sessionId = msg.session_id;
      }

      if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block?.type === "tool_use") {
            const input = block.input ?? {};
            // Bash: show the actual command (single line, clipped).
            const raw = input.file_path ?? input.url ?? input.path ?? input.command ?? "";
            const target = String(raw).replace(/\s+/g, " ").trim();
            inv.onToolUse?.(
              block.name,
              target.length > 160 ? `${target.slice(0, 160)}…` : target
            );
          }
          if (block?.type === "text" && block.text?.trim()) {
            inv.onText?.(block.text.trim());
          }
        }
      }

      if (msg.type === "result") {
        if (msg.is_error || msg.subtype !== "success") {
          reject(new Error(`claude -p failed: ${msg.subtype} ${msg.result ?? ""}`));
          return;
        }
        final = {
          sessionId: msg.session_id ?? sessionId ?? "",
          text: msg.result ?? "",
          numTurns: msg.num_turns,
          durationMs: msg.duration_ms,
          costUsd: msg.total_cost_usd,
          usage: msg.usage
            ? {
                inputTokens: msg.usage.input_tokens ?? 0,
                outputTokens: msg.usage.output_tokens ?? 0,
                cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
                cacheCreationTokens: msg.usage.cache_creation_input_tokens ?? 0,
              }
            : undefined,
        };
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => reject(new Error(`could not spawn claude: ${err.message}`)));
    child.on("close", (code) => {
      handleLine(buffer);
      if (final?.sessionId) {
        resolve(final);
      } else {
        reject(
          new Error(
            `claude -p exited with code ${code} without a result message` +
              (stderr.trim() ? `\nstderr: ${stderr.trim().slice(-2000)}` : "")
          )
        );
      }
    });
  });
}

export const claudeHarness: Harness = {
  id: "claude",
  invoke: invokeClaude,
};
