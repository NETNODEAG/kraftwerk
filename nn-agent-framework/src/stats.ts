/**
 * Per-phase resource accounting: wall-clock time, token usage, cost.
 * Collected by Run, persisted to trace.jsonl, rendered as the run summary.
 */

export interface PhaseStats {
  phase: string;
  kind: "agent" | "code" | "script";
  /** Agent id, for agent phases. */
  agent?: string;
  /** Harness id, for agent phases. */
  harness?: string;
  /** Model id, for agent phases. */
  model?: string;
  effort?: string;
  /** 1 + number of correction rounds. */
  attempts: number;
  /** Wall-clock time of the whole phase, corrections included. */
  durationMs: number;
  /** Fresh input tokens (uncached), summed over attempts. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface RunTotals {
  durationMs: number;
  in: number;
  out: number;
  costUsd: number;
}

/** Everything the API processed as input: fresh + cache read + cache creation. */
export const totalIn = (s: {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}) => s.inputTokens + s.cacheReadTokens + s.cacheCreationTokens;

export const fmtTokens = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export const fmtDuration = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

/** One-line phase result, appended to the ✔ log line. */
export function phaseStatsLine(stats: PhaseStats, numTurns?: number): string {
  return [
    numTurns !== undefined ? `${numTurns} turns` : "",
    fmtDuration(stats.durationMs),
    `${fmtTokens(totalIn(stats))} in / ${fmtTokens(stats.outputTokens)} out`,
    `$${stats.costUsd.toFixed(4)}`,
  ]
    .filter(Boolean)
    .join(" | ");
}

/** Render the end-of-run table; returns the printable lines plus totals. */
export function summaryTable(stats: PhaseStats[]): { lines: string[]; total: RunTotals } {
  const rows = stats.map((s) => {
    // Prefix the harness only when it is not the default claude runtime.
    const modelName =
      s.harness && s.harness !== "claude" ? `${s.harness}:${s.model}` : s.model;
    return {
      phase: s.phase,
      agent: s.kind === "agent" ? s.agent ?? "" : `(${s.kind})`,
      model: modelName ? (s.effort ? `${modelName} (${s.effort})` : modelName) : "",
      attempts: String(s.attempts),
      time: fmtDuration(s.durationMs),
      tokens: s.kind === "agent" ? `${fmtTokens(totalIn(s))} / ${fmtTokens(s.outputTokens)}` : "",
      cost: s.kind === "agent" ? `$${s.costUsd.toFixed(4)}` : "",
    };
  });
  const total = stats.reduce<RunTotals>(
    (acc, s) => ({
      durationMs: acc.durationMs + s.durationMs,
      in: acc.in + totalIn(s),
      out: acc.out + s.outputTokens,
      costUsd: acc.costUsd + s.costUsd,
    }),
    { durationMs: 0, in: 0, out: 0, costUsd: 0 }
  );
  rows.push({
    phase: "total",
    agent: "",
    model: "",
    attempts: "",
    time: fmtDuration(total.durationMs),
    tokens: `${fmtTokens(total.in)} / ${fmtTokens(total.out)}`,
    cost: `$${total.costUsd.toFixed(4)}`,
  });

  const header = { phase: "phase", agent: "agent", model: "model", attempts: "att", time: "time", tokens: "tokens in/out", cost: "cost" };
  const cols = ["phase", "agent", "model", "attempts", "time", "tokens", "cost"] as const;
  const width = (c: (typeof cols)[number]) =>
    Math.max(header[c].length, ...rows.map((r) => r[c].length));
  const line = (r: Record<(typeof cols)[number], string>) =>
    "  " + cols.map((c) => r[c].padEnd(width(c))).join("  ");

  return {
    lines: [
      line(header),
      "  " + cols.map((c) => "-".repeat(width(c))).join("  "),
      ...rows.map(line),
    ],
    total,
  };
}
