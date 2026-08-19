import { spawnSync } from "node:child_process";
import path from "node:path";
import chalk from "chalk";
import { resolveProject } from "../config.js";
import { discoverWorkflows } from "../discover.js";
import { missingEnv } from "../yaml.js";

/**
 * `kraftwerk doctor` — preflight for the machine and the project: are the
 * harness CLIs installed that the discovered workflows actually need, is
 * docker there for --sandbox, are the workflows valid, are declared env
 * vars set. One failed hard check → exit 1.
 */

type Level = "ok" | "warn" | "fail" | "info";

const ICONS: Record<Level, string> = {
  ok: chalk.green("✔"),
  warn: chalk.yellow("⚠"),
  fail: chalk.red("✖"),
  info: chalk.dim("•"),
};

function report(level: Level, label: string, detail?: string): void {
  console.log(`${ICONS[level]} ${label}${detail ? chalk.dim(` — ${detail}`) : ""}`);
}

function cliVersion(command: string): string | undefined {
  const r = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) return undefined;
  return (r.stdout || r.stderr).trim().split("\n")[0];
}

export async function runDoctor(cwd: string): Promise<void> {
  let failures = 0;

  // Runtime.
  const [major] = process.versions.node.split(".").map(Number);
  if (major >= 20) report("ok", `node ${process.versions.node}`);
  else {
    report("fail", `node ${process.versions.node}`, "kraftwerk needs node >= 20");
    failures++;
  }

  // Project.
  const project = await resolveProject(cwd);
  report("info", `Project root: ${project.root}`, project.configPath ? path.basename(project.configPath) : "no kraftwerk.yml (fallback: workflows folder or .git)");
  const found = project.workflowsRoot ? await discoverWorkflows(cwd) : [];
  if (!project.workflowsRoot) {
    report("warn", "no workflows root", "expected src/workflows/ or workflows/ — `kraftwerk init` scaffolds one");
  } else {
    const valid = found.filter((e) => e.workflow);
    const broken = found.filter((e) => !e.workflow);
    report(broken.length ? "fail" : "ok", `${valid.length} workflow(s) valid, ${broken.length} broken`, path.relative(cwd, project.workflowsRoot) || ".");
    for (const b of broken) {
      report("fail", path.basename(b.path), b.error?.split("\n")[0]);
      failures++;
    }
  }

  // Harnesses: hard requirement only if a discovered workflow runs on them.
  const needed = new Set<string>();
  for (const e of found) {
    for (const a of e.workflow?.meta.agents ?? []) needed.add(a.harness ?? "claude");
  }
  for (const harness of ["claude", "codex", "pi"]) {
    const version = cliVersion(harness);
    const isNeeded = needed.has(harness);
    if (version) {
      report("ok", `${harness} CLI`, version);
    } else if (isNeeded) {
      report("fail", `${harness} CLI missing`, "needed by a discovered workflow");
      failures++;
    } else {
      report("info", `${harness} CLI not installed`, "no discovered workflow needs it");
    }
  }

  // Docker (only needed for --sandbox).
  const docker = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 15_000 });
  report(docker.status === 0 ? "ok" : "info", docker.status === 0 ? "docker reachable" : "docker not reachable", docker.status === 0 ? undefined : "only needed for --sandbox");

  // Declared env vars.
  for (const e of found) {
    const requires = e.workflow?.meta.requires ?? [];
    if (requires.length === 0) continue;
    const missing = missingEnv(requires);
    if (missing.length === 0) report("ok", `${e.workflow!.name}: requires satisfied`, requires.join(", "));
    else report("warn", `${e.workflow!.name}: env missing`, missing.join(", "));
  }

  if (failures > 0) {
    console.log(chalk.red(`\n${failures} problem(s) found.`));
    process.exit(1);
  }
  console.log(chalk.green("\nAll set."));
}
