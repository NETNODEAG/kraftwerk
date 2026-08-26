import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { BackendHooks, BackendTuning, ChatBackend } from "./backend.js";

/**
 * pi chat backend: pi has no ACP support, but its `-p --mode json` run with
 * a stable `--session-id` is create-or-continue — so a chat is simply one
 * short-lived pi process per user message, all resuming the same session
 * (mirrors src/harnesses/pi.ts). Text arrives per assistant message, not
 * per token; tool activity streams as tool_execution_start events.
 *
 * pi executes its tools without asking, so this backend never raises
 * permission requests.
 */

interface PiEvent {
  type?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
    stopReason?: string;
    errorMessage?: string;
  };
  error?: unknown;
}

const clip = (raw: unknown): string => {
  const oneLine = String(raw ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
};

export function startPiBackend(
  cwd: string,
  hooks: BackendHooks,
  tuning: BackendTuning = {}
): ChatBackend {
  const sessionId = randomUUID();
  let child: ChildProcessWithoutNullStreams | null = null;
  let cancelled = false;
  const tuningArgs = [
    ...(tuning.model ? ["--model", tuning.model] : []),
    ...(tuning.effort ? ["--thinking", tuning.effort] : []),
    ...(tuning.skillDirs ?? []).flatMap((dir) => ["--skill", dir]),
  ];

  return {
    prompt(text: string): Promise<string> {
      cancelled = false;
      return new Promise((resolve, reject) => {
        const proc = spawn("pi", ["-p", "--mode", "json", "--session-id", sessionId, ...tuningArgs], {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
        });
        child = proc;
        proc.stdin.write(text);
        proc.stdin.end();

        let sawAssistant = false;
        let failure: string | undefined;
        let stderr = "";
        let buffer = "";
        let toolSeq = 0;

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
            const target = clip(a.path ?? a.file_path ?? a.command ?? a.pattern ?? "");
            hooks.emit({
              type: "tool_call",
              callId: `pi-${sessionId}-${toolSeq++}`,
              title: target ? `${event.toolName} ${target}` : event.toolName,
              status: "completed",
            });
          }
          if (event.type === "message_end" && event.message?.role === "assistant") {
            sawAssistant = true;
            for (const block of event.message.content ?? []) {
              if (block?.type === "text" && block.text?.trim()) {
                hooks.emit({ type: "text", text: block.text });
              }
              if (block?.type === "thinking" && block.text?.trim()) {
                hooks.emit({ type: "thought", text: block.text });
              }
            }
          }
          if (event.type === "error") {
            failure = typeof event.error === "string" ? event.error : line;
          }
          // API failures don't exit non-zero: they ride on turn_end as
          // stopReason "error" with an empty assistant message.
          if (event.type === "turn_end" && event.message?.stopReason === "error") {
            failure = clip(event.message.errorMessage ?? "unknown pi error");
          }
        };

        proc.stdout.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(handleLine);
        });
        proc.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });

        proc.on("error", (err) => reject(new Error(`could not spawn pi: ${err.message}`)));
        proc.on("close", (code) => {
          child = null;
          handleLine(buffer);
          if (cancelled) return resolve("cancelled");
          if (failure || code !== 0 || !sawAssistant) {
            reject(
              new Error(
                `pi failed (exit ${code})` +
                  (failure ? `: ${failure}` : "") +
                  (stderr.trim() ? `\nstderr: ${stderr.trim().slice(-1000)}` : "")
              )
            );
            return;
          }
          resolve("end_turn");
        });
      });
    },
    cancel(): void {
      cancelled = true;
      child?.kill("SIGTERM");
    },
    dispose(): void {
      child?.kill("SIGTERM");
    },
  };
}
