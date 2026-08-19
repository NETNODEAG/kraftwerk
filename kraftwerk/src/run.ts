import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import type { AgentDefinition } from "./agent.js";
import type { HarnessId } from "./harness.js";
import { harnessFor } from "./harnesses/registry.js";
import { correctionPrompt, parseEnvelope, type Envelope } from "./envelope.js";
import type { Gate } from "./gates.js";
import { fmtDuration, phaseStatsLine, summaryTable, type PhaseStats } from "./stats.js";

/**
 * The phase runner: agent proposes, code disposes. An agent phase spawns one
 * headless `claude -p` process, then the ORCHESTRATOR judges the result
 * (envelope parse + gates). Failures produce a correction prompt into the
 * same session, bounded by maxGateRetries. Agents never control retries
 * or phase transitions.
 *
 * The runner is workflow-agnostic: agents, prompts, and gates are injected
 * per phase by the concrete workflow. Per phase, the agent's persona is
 * composed with the run's workspace context into the system prompt; one
 * session PER HARNESS is shared across phases via resume, so a phase sees
 * the prior conversation on its harness but always speaks with its own
 * agent's voice. Across harnesses, context travels through the run files.
 *
 * Every event is appended to <runDir>/trace.jsonl for observability.
 */

export interface RunOptions {
  runDir: string;
  /**
   * Workflow-level context appended to every agent's persona: the run
   * directory, the file layout, how the orchestrator works.
   */
  workspaceContext: string;
  verbose?: boolean;
  /** Corrections in the same session before the run aborts. Default 2. */
  maxGateRetries?: number;
}

export class Run {
  private readonly sessions = new Map<HarnessId, string>();
  /** Per-phase stats in execution order; repeated phases appear once per execution. */
  readonly stats: PhaseStats[] = [];
  readonly runDir: string;
  private readonly workspaceContext: string;
  private readonly verbose: boolean;
  private readonly maxGateRetries: number;

  constructor(options: RunOptions) {
    this.runDir = options.runDir;
    this.workspaceContext = options.workspaceContext;
    this.verbose = options.verbose ?? false;
    this.maxGateRetries = options.maxGateRetries ?? 2;
  }

  async trace(event: string, data: Record<string, unknown> = {}): Promise<void> {
    await appendFile(
      path.join(this.runDir, "trace.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n"
    );
  }

  async agentPhase(params: {
    name: string;
    agent: AgentDefinition;
    prompt: string;
    gates: Gate[];
  }): Promise<Envelope> {
    const { agent } = params;
    const harness = harnessFor(agent.harness);
    const modelName = harness.id === "claude" ? agent.model : `${harness.id}:${agent.model}`;
    const modelLabel = agent.effort ? `${modelName}, effort ${agent.effort}` : modelName;
    console.log(`\n▸ Phase "${params.name}" — ${agent.name} [${agent.id}] (${modelLabel})`);
    await this.trace("phase_start", {
      phase: params.name,
      kind: "agent",
      agent: agent.id,
      harness: harness.id,
      model: agent.model,
      effort: agent.effort ?? null,
      clis: agent.clis ? Object.keys(agent.clis) : [],
      mcp: agent.mcp ? Object.keys(agent.mcp) : [],
      resume: this.sessions.get(harness.id) ?? null,
    });

    const phaseStats: PhaseStats = {
      phase: params.name,
      kind: "agent",
      agent: agent.id,
      harness: harness.id,
      model: agent.model,
      effort: agent.effort,
      attempts: 0,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    };
    const started = Date.now();

    // CLI grants are persona-level knowledge: inject the usage hints once
    // here instead of repeating them in every step prompt.
    const cliEntries = Object.entries(agent.clis ?? {});
    const cliBlock = cliEntries.length
      ? "\n\nThese CLIs are available to you via Bash (pre-approved, usable without asking):\n" +
        cliEntries
          .map(([name, hint]) => `- ${name}${hint.trim() ? ` — ${hint.trim()}` : ""}`)
          .join("\n")
      : "";

    let prompt = params.prompt;
    for (let attempt = 0; attempt <= this.maxGateRetries; attempt++) {
      const result = await harness.invoke({
        prompt,
        systemPrompt: `${agent.persona.trim()}${cliBlock}\n\n${this.workspaceContext.trim()}`,
        cwd: this.runDir,
        model: agent.model,
        effort: agent.effort,
        tools: agent.tools,
        clis: cliEntries.map(([name]) => name),
        mcpServers: agent.mcp,
        resume: this.sessions.get(harness.id),
        onToolUse: (tool, target) => {
          console.log(`  ⚙ ${tool} ${target}`.trimEnd());
          void this.trace("tool_use", { phase: params.name, attempt, tool, target });
        },
        onText: this.verbose ? (text) => console.log(`  💬 ${text}`) : undefined,
      });
      if (result.sessionId) this.sessions.set(harness.id, result.sessionId);
      phaseStats.attempts = attempt + 1;
      phaseStats.durationMs = Date.now() - started;
      phaseStats.costUsd += result.costUsd ?? 0;
      if (result.usage) {
        phaseStats.inputTokens += result.usage.inputTokens;
        phaseStats.outputTokens += result.usage.outputTokens;
        phaseStats.cacheReadTokens += result.usage.cacheReadTokens;
        phaseStats.cacheCreationTokens += result.usage.cacheCreationTokens;
      }
      await this.trace("agent_result", {
        phase: params.name,
        attempt,
        harness: harness.id,
        sessionId: result.sessionId,
        numTurns: result.numTurns,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        usage: result.usage,
      });

      const failures: string[] = [];
      let envelope: Envelope | undefined;
      try {
        envelope = parseEnvelope(result.text, params.name);
        await this.trace("envelope", { phase: params.name, attempt, envelope });
      } catch (err) {
        failures.push((err as Error).message);
      }

      if (envelope?.status === "blocked") {
        await this.trace("phase_end", { phase: params.name, status: "blocked" });
        throw new Error(
          `Phase "${params.name}" blocked by agent: ${envelope.reason ?? "no reason given"}`
        );
      }

      for (const gate of params.gates) {
        const failure = await gate.check(this.runDir);
        await this.trace("gate_result", {
          phase: params.name,
          attempt,
          gate: gate.name,
          passed: failure === null,
          failure,
        });
        if (failure) failures.push(`${gate.name}: ${failure}`);
      }

      if (failures.length === 0) {
        this.stats.push(phaseStats);
        console.log(
          `  ✔ envelope + ${params.gates.length} gates passed (${phaseStatsLine(phaseStats, result.numTurns)})`
        );
        await this.trace("phase_end", { phase: params.name, status: "ok", stats: phaseStats });
        return envelope!;
      }

      const retrying = attempt < this.maxGateRetries;
      console.log(
        `  ✖ ${failures.length} check(s) failed${retrying ? ", correcting in the same session" : ""}`
      );
      for (const failure of failures) console.log(`    - ${failure}`);
      prompt = correctionPrompt(params.name, failures);
    }

    this.stats.push(phaseStats);
    await this.trace("phase_end", { phase: params.name, status: "failed", stats: phaseStats });
    throw new Error(
      `Phase "${params.name}" failed after ${this.maxGateRetries + 1} attempts`
    );
  }

  /**
   * Deterministic script phase: run a bash script in the run directory —
   * no agent, no LLM. The script sees REQUEST, RUN_DIR, PHASE, and (in
   * folder mode) WORKFLOW_DIR as env vars. It hands over the same envelope as an agent phase: either it
   * prints the fenced ```json envelope itself (last block on stdout wins),
   * or the runner synthesizes one from the exit code (status ok, summary =
   * last stdout line). Gates run afterwards, but there is no correction
   * loop — a script is deterministic, so a failing gate fails the run.
   */
  async scriptPhase(params: {
    name: string;
    script: string;
    gates: Gate[];
    env?: Record<string, string>;
  }): Promise<Envelope> {
    console.log(`\n▸ Phase "${params.name}" — script (bash)`);
    await this.trace("phase_start", { phase: params.name, kind: "script" });
    const started = Date.now();

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn("bash", ["-c", params.script], {
          cwd: this.runDir,
          env: { ...process.env, RUN_DIR: this.runDir, PHASE: params.name, ...params.env },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          const text = String(chunk);
          stdout += text;
          if (this.verbose) {
            for (const line of text.split("\n")) {
              if (line.trim()) console.log(`  💬 ${line}`);
            }
          }
        });
        child.stderr.on("data", (chunk) => (stderr += String(chunk)));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      }
    );

    const phaseStats: PhaseStats = {
      phase: params.name,
      kind: "script",
      attempts: 1,
      durationMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    };
    await this.trace("script_result", {
      phase: params.name,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    });

    const fail = async (message: string): Promise<never> => {
      this.stats.push(phaseStats);
      await this.trace("phase_end", { phase: params.name, status: "failed", stats: phaseStats });
      throw new Error(`Phase "${params.name}" (script) failed: ${message}`);
    };

    if (result.code !== 0) {
      const tail = result.stderr.trim().split("\n").slice(-5).join("\n");
      return await fail(`exit code ${result.code}${tail ? `\n${tail}` : ""}`);
    }

    let envelope: Envelope;
    if (result.stdout.includes("```json")) {
      try {
        envelope = parseEnvelope(result.stdout, params.name);
      } catch (err) {
        return await fail((err as Error).message);
      }
    } else {
      const lines = result.stdout.trim().split("\n").filter((l) => l.trim());
      envelope = {
        phase: params.name,
        status: "ok",
        artifacts: [],
        summary: lines.at(-1),
      };
    }
    await this.trace("envelope", { phase: params.name, envelope });

    if (envelope.status === "blocked") {
      return await fail(`blocked: ${envelope.reason ?? "no reason given"}`);
    }

    const failures: string[] = [];
    for (const gate of params.gates) {
      const failure = await gate.check(this.runDir);
      await this.trace("gate_result", {
        phase: params.name,
        gate: gate.name,
        passed: failure === null,
        failure,
      });
      if (failure) failures.push(`${gate.name}: ${failure}`);
    }
    if (failures.length > 0) {
      for (const failure of failures) console.log(`    - ${failure}`);
      return await fail(
        `${failures.length} gate(s) failed — script steps are deterministic, no correction loop`
      );
    }

    this.stats.push(phaseStats);
    console.log(
      `  ✔ envelope + ${params.gates.length} gates passed (exit 0 | ${fmtDuration(phaseStats.durationMs)})`
    );
    await this.trace("phase_end", { phase: params.name, status: "ok", stats: phaseStats });
    return envelope;
  }

  async codePhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
    console.log(`\n▸ Phase "${name}" — code`);
    await this.trace("phase_start", { phase: name, kind: "code" });
    const started = Date.now();
    const value = await fn();
    const phaseStats: PhaseStats = {
      phase: name,
      kind: "code",
      attempts: 1,
      durationMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    };
    this.stats.push(phaseStats);
    await this.trace("phase_end", { phase: name, status: "ok", stats: phaseStats });
    return value;
  }

  /** Per-phase table (time, tokens, cost) plus totals; also traced as run_summary. */
  async printSummary(): Promise<void> {
    const { lines, total } = summaryTable(this.stats);
    console.log(`\n▸ Run summary`);
    for (const line of lines) console.log(line);
    await this.trace("run_summary", { phases: this.stats, total });
  }
}
