import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { identityEnv, type BackendHooks, type BackendTuning, type ChatBackend } from "./backend.js";
import { workspaceEnv } from "../env.js";
import { tempEnv } from "../temp.js";
import type { ConfigOption } from "./types.js";

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

/** pi's --thinking levels. */
const PI_THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * The models pi can run (`pi --list-models`: its providers with a login or
 * key), as `provider/id`. Empty when pi is missing.
 */
export function listPiModels(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile("pi", ["--list-models"], { env: workspaceEnv(), timeout: 20_000 }, (err, stdout) => {
      if (err) return resolve([]);
      const rows = stdout.split("\n").slice(1).map((l) => l.trim().split(/\s+/));
      resolve(rows.filter((r) => r.length >= 2 && r[0] && r[1]).map(([provider, id]) => `${provider}/${id}`));
    });
  });
}

/**
 * pi's model and thinking level in the shape ACP agents announce theirs
 * (a select each, "default" = pi's own setting), so the chat's pickers and
 * a new chat's start options treat pi like the others.
 */
export function piOptions(models: string[], model?: string, effort?: string): ConfigOption[] {
  const known = model && !models.includes(model) ? [model, ...models] : models;
  return [
    { id: "model", name: "Model", category: "model", type: "select", value: model ?? "default", choices: [{ value: "default", name: "pi's default" }, ...known.map((m) => ({ value: m, name: m }))] },
    { id: "thinking", name: "Thinking", category: "thought_level", type: "select", value: effort ?? "default", choices: [{ value: "default", name: "pi's default" }, ...PI_THINKING.map((t) => ({ value: t, name: t }))] },
  ];
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
  // pi runs one process per message: a changed setting applies from the next one.
  let model = tuning.model;
  let effort = tuning.effort;
  const args = () => [
    ...(model ? ["--model", model] : []),
    ...(effort ? ["--thinking", effort] : []),
    ...(tuning.skillDirs ?? []).flatMap((dir) => ["--skill", dir]),
  ];
  const models = listPiModels();
  const announce = async () => {
    const options = piOptions(await models, model, effort);
    hooks.emit({ type: "config", options });
    return options;
  };
  void announce();

  return {
    prompt(
      text: string,
      files?: import("./backend.js").PromptFile[]
    ): Promise<import("./backend.js").TurnEnd> {
      // pi takes text only: name the files, they are on disk for it to open.
      if (files?.length) text += `\n\nAttached files:\n${files.map((f) => `- ${f.name} (${f.mimeType}, ${f.path})`).join("\n")}`;
      cancelled = false;
      return new Promise((resolve, reject) => {
        const proc = spawn("pi", ["-p", "--mode", "json", "--session-id", sessionId, ...args()], {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...workspaceEnv(), ...(tuning.temp ? tempEnv(tuning.temp) : {}), ...identityEnv("pi", tuning) },
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
          if (cancelled) return resolve({ stopReason: "cancelled" });
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
          resolve({ stopReason: "end_turn" });
        });
      });
    },
    async setConfig(configId: string, value: string | boolean): Promise<ConfigOption[]> {
      const v = typeof value === "string" && value !== "default" ? value : undefined;
      if (configId === "model") model = v;
      else if (configId === "thinking") {
        if (v && !PI_THINKING.includes(v)) throw new Error(`pi has no thinking level "${v}"`);
        effort = v;
      } else throw new Error(`pi has no setting "${configId}"`);
      return announce();
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
