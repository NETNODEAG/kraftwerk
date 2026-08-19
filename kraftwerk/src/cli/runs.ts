import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import Table from "cli-table3";
import { resolveProject } from "../config.js";
import { fmtDuration, fmtTokens } from "../stats.js";

/**
 * `kraftwerk runs` / `kraftwerk runs show <id>` — inspect past runs from
 * their trace.jsonl event logs under the project's output directory
 * (default output/, kraftwerk.yml `output:` overrides). No run registry:
 * the trace IS the record.
 */

interface RunInfo {
  id: string;
  dir: string;
  workflow?: string;
  request?: string;
  startedAt?: string;
  status: "ok" | "failed" | "incomplete";
  durationMs?: number;
  costUsd?: number;
  events: any[];
}

async function readRun(dir: string): Promise<RunInfo | undefined> {
  const tracePath = path.join(dir, "trace.jsonl");
  const raw = await readFile(tracePath, "utf8").catch(() => null);
  if (raw === null) return undefined;
  const events = raw
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  const start = events.find((e) => e.event === "run_start");
  const summary = events.find((e) => e.event === "run_summary");
  const failed = events.some(
    (e) => e.event === "phase_end" && (e.status === "failed" || e.status === "blocked")
  );
  return {
    id: path.basename(dir),
    dir,
    workflow: start?.workflow,
    request: start?.request,
    startedAt: start?.ts,
    status: summary ? "ok" : failed ? "failed" : "incomplete",
    durationMs: summary?.total?.durationMs,
    costUsd: summary?.total?.costUsd,
    events,
  };
}

async function collectRuns(cwd: string): Promise<{ outputDir: string; runs: RunInfo[] }> {
  const { outputDir } = await resolveProject(cwd);
  const entries = await readdir(outputDir, { withFileTypes: true }).catch(() => []);
  const runs: RunInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const info = await readRun(path.join(outputDir, entry.name));
    if (info) runs.push(info);
  }
  runs.sort((a, b) => (b.startedAt ?? b.id).localeCompare(a.startedAt ?? a.id));
  return { outputDir, runs };
}

const STATUS_LABEL: Record<RunInfo["status"], string> = {
  ok: chalk.green("ok"),
  failed: chalk.red("failed"),
  incomplete: chalk.yellow("incomplete"),
};

export async function listRuns(cwd: string, opts: { json?: boolean } = {}): Promise<void> {
  const { outputDir, runs } = await collectRuns(cwd);
  if (opts.json) {
    console.log(
      JSON.stringify(
        runs.map(({ events: _events, ...rest }) => rest),
        null,
        2
      )
    );
    return;
  }
  if (runs.length === 0) {
    console.log(chalk.dim(`No runs under ${outputDir}.`));
    return;
  }
  const table = new Table({
    head: ["run", "workflow", "status", "duration", "cost", "request"].map((h) => chalk.bold(h)),
    wordWrap: true,
    colWidths: [26, 14, 12, 8, 9, 30],
  });
  for (const r of runs) {
    table.push([
      r.id,
      r.workflow ?? "—",
      STATUS_LABEL[r.status],
      r.durationMs !== undefined ? fmtDuration(r.durationMs) : "—",
      r.costUsd !== undefined ? `$${r.costUsd.toFixed(2)}` : "—",
      r.request ?? "—",
    ]);
  }
  console.log(table.toString());
}

export async function showRun(cwd: string, id: string, opts: { json?: boolean } = {}): Promise<void> {
  const { outputDir } = await resolveProject(cwd);
  const dir = path.join(outputDir, id);
  if (!(await stat(dir).catch(() => null))) {
    console.error(chalk.red(`Run "${id}" not found under ${outputDir}.`));
    process.exit(2);
  }
  const info = await readRun(dir);
  if (!info) {
    console.error(chalk.red(`${id}: no trace.jsonl — not a kraftwerk run?`));
    process.exit(2);
  }
  if (opts.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  console.log(
    `${chalk.cyan(info.workflow ?? "?")} ${STATUS_LABEL[info.status]}  ${chalk.dim(info.startedAt ?? "")}`
  );
  if (info.request) console.log(chalk.dim(`request: ${info.request}`));
  console.log(chalk.dim(`dir: ${info.dir}\n`));
  for (const e of info.events) {
    if (e.event === "phase_end") {
      const icon = e.status === "ok" ? chalk.green("✔") : chalk.red("✖");
      const s = e.stats;
      const detail = s
        ? ` ${chalk.dim(
            `${fmtDuration(s.durationMs)} | ${fmtTokens(s.inputTokens + s.cacheReadTokens + s.cacheCreationTokens)} in / ${fmtTokens(s.outputTokens)} out | $${s.costUsd.toFixed(4)} | ${s.attempts} attempt(s)`
          )}`
        : "";
      console.log(`${icon} ${e.phase}${detail}`);
    }
    if (e.event === "gate_result" && e.passed === false) {
      console.log(`  ${chalk.red("gate")} ${e.gate}: ${e.failure}`);
    }
  }
  if (info.durationMs !== undefined) {
    console.log(
      chalk.dim(`\ntotal: ${fmtDuration(info.durationMs)} | $${(info.costUsd ?? 0).toFixed(4)}`)
    );
  }
}
