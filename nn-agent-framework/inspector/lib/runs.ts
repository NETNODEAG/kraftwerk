import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Filesystem + trace.jsonl reading for the inspector. The output directory
 * holds one folder per run (run-YYYY-MM-DD-HHMM-SS); every run folder has a
 * trace.jsonl written by the framework plus the run's working files.
 */

export const OUTPUT_DIR = process.env.KRAFTWERK_OUTPUT
  ? path.resolve(process.env.KRAFTWERK_OUTPUT)
  : path.resolve(process.cwd(), "../../agent-playground/output");

/** A run with no trace update for this long and no summary counts as aborted. */
const STALE_MS = 15 * 60 * 1000;

export type RunStatus = "running" | "ok" | "failed" | "aborted";

export interface GateView {
  gate: string;
  passed: boolean;
  failure: string | null;
}

export interface PhaseView {
  phase: string;
  kind: "agent" | "script";
  agent?: string;
  model?: string;
  harness?: string;
  status: "running" | "ok" | "failed" | "blocked" | "pending";
  attempts: number;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  gates: GateView[];
  summary?: string;
  lastActivity?: string;
  stdout?: string;
  stderr?: string;
}

export interface FileView {
  name: string;
  size: number;
  mtime: string;
}

export interface RunListItem {
  id: string;
  workflow?: string;
  request?: string;
  status: RunStatus;
  startedAt?: string;
  updatedAt: string;
  phasesDone: number;
  phasesTotal?: number;
  currentPhase?: string;
  durationMs?: number;
  costUsd?: number;
}

export interface RunDetail extends RunListItem {
  description?: string;
  steps?: string[];
  phases: PhaseView[];
  files: FileView[];
}

type TraceEvent = Record<string, any> & { ts: string; event: string };

async function readTrace(runDir: string): Promise<TraceEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(runDir, "trace.jsonl"), "utf8");
  } catch {
    return [];
  }
  const events: TraceEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* partially written last line of a live run */
    }
  }
  return events;
}

function analyse(events: TraceEvent[]) {
  const runStart = events.find((e) => e.event === "run_start");
  const summary = events.find((e) => e.event === "run_summary");

  const phases: PhaseView[] = [];
  const byName = new Map<string, PhaseView>();
  for (const e of events) {
    if (e.event === "phase_start") {
      const p: PhaseView = {
        phase: e.phase,
        kind: e.kind === "script" ? "script" : "agent",
        agent: e.agent,
        model: e.model,
        harness: e.harness,
        status: "running",
        attempts: 0,
        startedAt: e.ts,
        gates: [],
      };
      phases.push(p);
      byName.set(e.phase, p);
      continue;
    }
    const p = byName.get(e.phase);
    if (!p) continue;
    switch (e.event) {
      case "tool_use":
        p.lastActivity = `${e.tool} ${e.target ? shortenPath(e.target) : ""}`.trim();
        break;
      case "agent_result":
        p.attempts = (e.attempt ?? 0) + 1;
        break;
      case "script_result":
        p.attempts += 1;
        p.stdout = e.stdout || undefined;
        p.stderr = e.stderr || undefined;
        break;
      case "envelope":
        p.summary = e.envelope?.summary;
        break;
      case "gate_result":
        p.gates.push({ gate: e.gate, passed: e.passed, failure: e.failure ?? null });
        break;
      case "phase_end":
        p.status = e.status === "ok" ? "ok" : e.status === "blocked" ? "blocked" : "failed";
        p.endedAt = e.ts;
        if (e.stats) {
          p.durationMs = e.stats.durationMs;
          p.costUsd = e.stats.costUsd;
          p.tokensIn =
            (e.stats.inputTokens ?? 0) +
            (e.stats.cacheReadTokens ?? 0) +
            (e.stats.cacheCreationTokens ?? 0);
          p.tokensOut = e.stats.outputTokens ?? 0;
          p.attempts = e.stats.attempts ?? p.attempts;
        }
        break;
    }
  }

  // Only keep the last attempt's gate results per gate name.
  for (const p of phases) {
    const last = new Map<string, GateView>();
    for (const g of p.gates) last.set(g.gate, g);
    p.gates = [...last.values()];
  }

  // Steps declared at run_start that have not started yet are pending.
  // run_start.steps is either string[] (older traces) or {name, kind, agent, model}[].
  const rawSteps: any[] | undefined = runStart?.steps;
  const steps: string[] | undefined = rawSteps?.map((s) => (typeof s === "string" ? s : s.name));
  if (rawSteps) {
    for (const s of rawSteps) {
      const name = typeof s === "string" ? s : s.name;
      if (!byName.has(name)) {
        phases.push({
          phase: name,
          kind: typeof s === "string" ? "script" : s.kind,
          agent: typeof s === "string" ? undefined : s.agent,
          model: typeof s === "string" ? undefined : s.model,
          status: "pending",
          attempts: 0,
          gates: [],
        });
      }
    }
  }

  const failed = phases.some((p) => p.status === "failed" || p.status === "blocked");
  const lastTs = events.length ? events[events.length - 1].ts : undefined;
  let status: RunStatus;
  if (summary) status = failed ? "failed" : "ok";
  else if (failed) status = "failed";
  else if (lastTs && Date.now() - Date.parse(lastTs) > STALE_MS) status = "aborted";
  else status = "running";

  return { runStart, summary, phases, steps, status, lastTs };
}

function shortenPath(p: string): string {
  const parts = p.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : p;
}

export async function listRuns(): Promise<RunListItem[]> {
  let entries: string[];
  try {
    entries = (await fs.readdir(OUTPUT_DIR)).filter((e) => e.startsWith("run-"));
  } catch {
    return [];
  }
  const items = await Promise.all(
    entries.map(async (id): Promise<RunListItem | null> => {
      const runDir = path.join(OUTPUT_DIR, id);
      const st = await fs.stat(runDir).catch(() => null);
      if (!st?.isDirectory()) return null;
      const events = await readTrace(runDir);
      const { runStart, summary, phases, steps, status, lastTs } = analyse(events);
      const done = phases.filter((p) => p.status === "ok").length;
      const current = phases.find((p) => p.status === "running")?.phase;
      return {
        id,
        workflow: runStart?.workflow,
        request: runStart?.request,
        status,
        startedAt: events[0]?.ts,
        updatedAt: lastTs ?? st.mtime.toISOString(),
        phasesDone: done,
        phasesTotal: steps?.length ?? (summary ? phases.length : undefined),
        currentPhase: current,
        durationMs: summary?.total?.durationMs,
        costUsd: summary?.total?.costUsd,
      };
    })
  );
  return (items.filter(Boolean) as RunListItem[]).sort((a, b) => b.id.localeCompare(a.id));
}

export function safeRunDir(id: string): string {
  if (!/^run-[0-9-]+$/.test(id)) throw new Error("invalid run id");
  return path.join(OUTPUT_DIR, id);
}

export async function getRun(id: string): Promise<RunDetail | null> {
  const runDir = safeRunDir(id);
  const st = await fs.stat(runDir).catch(() => null);
  if (!st?.isDirectory()) return null;

  const events = await readTrace(runDir);
  const { runStart, summary, phases, steps, status, lastTs } = analyse(events);

  const names = await fs.readdir(runDir);
  const files: FileView[] = [];
  for (const name of names) {
    const fst = await fs.stat(path.join(runDir, name)).catch(() => null);
    if (fst?.isFile()) files.push({ name, size: fst.size, mtime: fst.mtime.toISOString() });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));

  return {
    id,
    workflow: runStart?.workflow,
    description: runStart?.description,
    request: runStart?.request,
    status,
    startedAt: events[0]?.ts,
    updatedAt: lastTs ?? st.mtime.toISOString(),
    phasesDone: phases.filter((p) => p.status === "ok").length,
    phasesTotal: steps?.length ?? (summary ? phases.length : undefined),
    currentPhase: phases.find((p) => p.status === "running")?.phase,
    durationMs: summary?.total?.durationMs,
    costUsd: summary?.total?.costUsd,
    steps,
    phases,
    files,
  };
}

export async function readRunFile(
  id: string,
  name: string
): Promise<{ absPath: string; size: number } | null> {
  const runDir = safeRunDir(id);
  const absPath = path.resolve(runDir, name);
  if (absPath !== path.join(runDir, path.basename(name))) throw new Error("invalid file name");
  const st = await fs.stat(absPath).catch(() => null);
  if (!st?.isFile()) return null;
  return { absPath, size: st.size };
}
