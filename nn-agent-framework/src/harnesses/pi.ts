import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AgentInvocation, AgentResult, Harness, TokenUsage } from "../harness.js";

/**
 * pi harness (badlogic/pi-mono): a thin coding agent over raw vendor APIs —
 * Anthropic (also via the Claude subscription OAuth), OpenAI, DeepSeek,
 * Groq, OpenRouter, and many more. This is the "direct API call" runtime:
 * same file tools and sessions as claude -p, any provider behind it.
 *
 * Model ids use pi's `provider/id` form, e.g. "anthropic/claude-haiku-4-5"
 * or "deepseek/deepseek-chat" (vendor API key in env for non-OAuth
 * providers; check with `pi auth check --provider <name>`).
 *
 * Session handling: `--session-id` is create-or-continue, so the adapter
 * generates the id on the first call and simply reuses it to resume —
 * nothing to parse back. `--no-context-files` keeps the run hermetic
 * (no AGENTS.md/CLAUDE.md discovery). The effort scale maps 1:1 onto
 * `--thinking` (low..max).
 *
 * JSONL events (verified against pi 0.84.1):
 *   session              {id, cwd}
 *   tool_execution_start {toolName, args: {path|command|...}}
 *   message_end          {message: {role, content[{type,text}],
 *                          usage: {input, output, cacheRead, cacheWrite,
 *                                  cost: {total}}}}
 *   agent_end / agent_settled
 */

/** Framework tool names → pi built-in tool names. Unmapped tools (e.g. WebFetch) are dropped. */
const TOOL_MAP: Record<string, string> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  Bash: "bash",
  Grep: "grep",
  Glob: "find",
  LS: "ls",
};

interface PiMessage {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total?: number };
  };
}

interface PiEvent {
  type?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  message?: PiMessage;
  error?: unknown;
}

const clip = (raw: string): string => {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
};

function invokePi(inv: AgentInvocation): Promise<AgentResult> {
  if (Object.keys(inv.mcpServers ?? {}).length > 0) {
    throw new Error(
      "pi harness has no MCP support (pi uses its own extension system) — run this agent on claude or codex"
    );
  }
  const sessionId = inv.resume ?? randomUUID();
  const tools = inv.tools.map((t) => TOOL_MAP[t]).filter(Boolean);
  // pi has no per-command allowlist: a CLI grant enables the plain bash
  // tool; the scoping lives only in the persona hints.
  if ((inv.clis?.length ?? 0) > 0 && !tools.includes("bash")) tools.push("bash");
  const args = [
    "-p",
    "--mode", "json",
    "--model", inv.model,
    "--system-prompt", inv.systemPrompt,
    "--tools", tools.join(","),
    "--no-context-files",
    "--session-id", sessionId,
  ];
  if (inv.effort) args.push("--thinking", inv.effort);

  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn("pi", args, {
      cwd: inv.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write(inv.prompt);
    child.stdin.end();

    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    let costUsd = 0;
    let sawAssistant = false;
    const texts: string[] = [];
    let failure: string | undefined;
    let stderr = "";
    let buffer = "";

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let event: PiEvent;
      try {
        event = JSON.parse(line);
      } catch {
        return; // non-JSON noise on stdout
      }

      if (event.type === "tool_execution_start" && event.toolName) {
        const a = event.args ?? {};
        const raw = a.path ?? a.file_path ?? a.command ?? a.pattern ?? "";
        inv.onToolUse?.(event.toolName, clip(String(raw)));
      }

      if (event.type === "message_end" && event.message?.role === "assistant") {
        sawAssistant = true;
        for (const block of event.message.content ?? []) {
          if (block?.type === "text" && block.text?.trim()) {
            texts.push(block.text.trim());
            inv.onText?.(block.text.trim());
          }
        }
        const u = event.message.usage;
        if (u) {
          usage.inputTokens += u.input ?? 0;
          usage.outputTokens += u.output ?? 0;
          usage.cacheReadTokens += u.cacheRead ?? 0;
          usage.cacheCreationTokens += u.cacheWrite ?? 0;
          costUsd += u.cost?.total ?? 0;
        }
      }

      if (event.type === "error") {
        failure = typeof event.error === "string" ? event.error : line;
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

    child.on("error", (err) => reject(new Error(`could not spawn pi: ${err.message}`)));
    child.on("close", (code) => {
      handleLine(buffer);
      if (failure || code !== 0 || !sawAssistant) {
        reject(
          new Error(
            `pi failed (exit ${code})` +
              (failure ? `: ${failure}` : "") +
              (stderr.trim() ? `\nstderr: ${stderr.trim().slice(-2000)}` : "")
          )
        );
        return;
      }
      resolve({
        sessionId,
        // The envelope sits in the last message; parseEnvelope takes the
        // last fenced block, so joining all messages is safe.
        text: texts.join("\n\n"),
        durationMs: Date.now() - started,
        costUsd,
        usage,
      });
    });
  });
}

export const piHarness: Harness = {
  id: "pi",
  invoke: invokePi,
};
