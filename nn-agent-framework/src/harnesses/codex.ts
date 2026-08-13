import { spawn } from "node:child_process";
import type { AgentInvocation, AgentResult, Harness, TokenUsage } from "../harness.js";

/**
 * Codex harness: one phase = one headless `codex exec --json` process,
 * resumed across phases via `codex exec resume <thread-id>`. Auth is the
 * local ChatGPT login.
 *
 * Two normalization quirks versus claude -p:
 *  - Codex has no system-prompt replacement, so the persona + workspace
 *    context are prepended to the task prompt on every call (this also
 *    keeps per-phase persona switching working on a resumed thread).
 *  - There is no per-tool allowlist; governance is the sandbox instead
 *    (`--sandbox workspace-write`: only the run directory is writable).
 *    The agent's `tools` list is not enforced per tool — but a WebFetch/
 *    WebSearch grant maps to enabling network access in the sandbox
 *    (otherwise outbound requests like curl are blocked).
 *
 * `--ignore-user-config` keeps the run hermetic (no ~/.codex/config.toml
 * defaults leak in; auth still works), which is why the model and effort
 * must always be passed explicitly.
 *
 * JSONL events (verified against codex-cli 0.147.0):
 *   thread.started {thread_id}                      → session id
 *   item.started   {item: command_execution|file_change}  → tool feed
 *   item.completed {item: agent_message {text}}     → assistant text
 *   turn.completed {usage: {input_tokens (total incl. cached),
 *     cached_input_tokens, cache_write_input_tokens, output_tokens}}
 */

interface CodexItem {
  type?: string;
  text?: string;
  command?: string;
  changes?: Array<{ path?: string; kind?: string }>;
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  message?: string;
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
    output_tokens?: number;
  };
  item?: CodexItem;
}

const clip = (raw: string): string => {
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
};

function invokeCodex(inv: AgentInvocation): Promise<AgentResult> {
  const args = [
    "exec",
    "--json",
    "-m", inv.model,
    "--sandbox", "workspace-write",
    "-C", inv.cwd,
    "--skip-git-repo-check",
    "--ignore-user-config",
  ];
  if (inv.effort) args.push("-c", `model_reasoning_effort=${inv.effort}`);
  // Governance mapping: a web-tool grant means the sandbox may reach the network.
  if (inv.tools.some((t) => t === "WebFetch" || t === "WebSearch")) {
    args.push("-c", "sandbox_workspace_write.network_access=true");
  }
  if (inv.resume) args.push("resume", inv.resume);
  args.push("-"); // read the prompt from stdin

  // No system-prompt flag on codex: carry persona + context in the prompt.
  const prompt =
    `# Role and workspace context for this phase\n\n${inv.systemPrompt}\n\n` +
    `# Task\n\n${inv.prompt}`;

  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd: inv.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.write(prompt);
    child.stdin.end();

    let sessionId: string | undefined;
    let usage: TokenUsage | undefined;
    const texts: string[] = [];
    let failure: string | undefined;
    let stderr = "";
    let buffer = "";

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let event: CodexEvent;
      try {
        event = JSON.parse(line);
      } catch {
        return; // non-JSON noise on stdout
      }

      if (event.type === "thread.started" && event.thread_id) {
        sessionId = event.thread_id;
      }

      if (event.type === "item.started" && event.item) {
        const item = event.item;
        if (item.type === "command_execution" && item.command) {
          inv.onToolUse?.("Bash", clip(item.command));
        }
        if (item.type === "file_change") {
          for (const change of item.changes ?? []) {
            const tool = change.kind === "add" ? "Write" : "Edit";
            inv.onToolUse?.(tool, clip(change.path ?? ""));
          }
        }
      }

      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        const text = event.item.text?.trim();
        if (text) {
          texts.push(text);
          inv.onText?.(text);
        }
      }

      if (event.type === "turn.completed" && event.usage) {
        const u = event.usage;
        const total = u.input_tokens ?? 0;
        const cached = u.cached_input_tokens ?? 0;
        usage = {
          // codex reports input_tokens as the total including cache reads.
          inputTokens: Math.max(0, total - cached),
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: cached,
          cacheCreationTokens: u.cache_write_input_tokens ?? 0,
        };
      }

      if (event.type === "turn.failed" || event.type === "error") {
        failure = event.message ?? line;
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

    child.on("error", (err) => reject(new Error(`could not spawn codex: ${err.message}`)));
    child.on("close", (code) => {
      handleLine(buffer);
      if (failure || code !== 0 || !sessionId) {
        reject(
          new Error(
            `codex exec failed (exit ${code})` +
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
        usage,
        // No cost in codex events (subscription auth) — left undefined.
      });
    });
  });
}

export const codexHarness: Harness = {
  id: "codex",
  invoke: invokeCodex,
};
