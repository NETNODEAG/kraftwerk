/**
 * The contract between the CLI registry and a concrete workflow (ADW).
 * A workflow owns its run directory, roster, prompts, and gates; the
 * framework only provides the phase runner and the CLI dispatch.
 */

import path from "node:path";
import type { PhaseStats, RunTotals } from "./stats.js";

export interface WorkflowRunOptions {
  request: string;
  autoApprove: boolean;
  verbose: boolean;
}

/** Machine-readable outcome of a run (also what `run --json` prints). */
export interface RunResult {
  runDir: string;
  phases: PhaseStats[];
  total: RunTotals;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  run(opts: WorkflowRunOptions): Promise<RunResult | void>;
}

/** Local-time run-folder stamp: "2026-08-13-1432-07" (sortable, no colons). */
export function runStamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

/** Run-folder name: "<stamp>-<workflow-slug>", e.g. "2026-08-25-1432-07-hello". */
export function newRunId(workflowName: string, date: Date = new Date()): string {
  const slug =
    workflowName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workflow";
  return `${runStamp(date)}-${slug}`;
}

/**
 * Where a run's folder lives: <output>/runs/<id>. Legacy ids ("run-<stamp>",
 * pre-runs-subfolder) stay at the output root so old runs remain readable.
 */
export function runDirFor(outputDir: string, runId: string): string {
  return runId.startsWith("run-")
    ? path.join(outputDir, runId)
    : path.join(outputDir, "runs", runId);
}
