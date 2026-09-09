import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { ignoreEntryFor, isDir, publicHostFor, reposRootFor, resolveProject, tunnelFor } from "../config.js";
import { discoverWorkflows } from "../discover.js";
import { missingEnv } from "../yaml.js";
import { applyDotenv, DOTENV_FILE } from "../dotenv.js";

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

/** True if a < b for plain x.y.z versions (prerelease tags ignored). */
function semverLt(a: string, b: string): boolean {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

/** Latest published version from the npm registry, or undefined if unreachable. */
async function latestNpmVersion(name: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { version?: string };
    return data.version;
  } catch {
    return undefined;
  }
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

  // kraftwerk version vs npm.
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8")
  ) as { name: string; version: string };
  const latest = await latestNpmVersion(pkg.name);
  if (!latest) {
    report("info", `kraftwerk ${pkg.version}`, "could not reach npm registry to check for updates");
  } else if (semverLt(pkg.version, latest)) {
    report("warn", `kraftwerk ${pkg.version}`, `${latest} available — npm i -g ${pkg.name}@latest`);
  } else {
    report("ok", `kraftwerk ${pkg.version}`, latest === pkg.version ? "latest on npm" : `ahead of npm (latest: ${latest})`);
  }

  // Project. resolveProject throws on a malformed kraftwerk.yml (bad YAML,
  // non-mapping, unknown keys, non-string values) — surface that as a check.
  let project;
  try {
    project = await resolveProject(cwd);
  } catch (err) {
    report("fail", "kraftwerk.yml invalid", (err as Error).message.split("\n")[0]);
    console.log(chalk.red("\n1 problem(s) found."));
    process.exit(1);
  }
  report("info", `Project root: ${project.root}`, project.configPath ? path.basename(project.configPath) : "no kraftwerk.yml (fallback: workflows folder or .git)");

  // Project config: well-formed (guaranteed by the parse above) and the
  // configured paths actually exist.
  if (!project.configPath) {
    report("warn", "no kraftwerk.yml", "recommended as project root marker — `kraftwerk init` scaffolds one");
  } else {
    const cfg = project.config as Record<string, unknown>;
    const keys = Object.keys(cfg);
    // Blocks (git, repos, vibeables, projects, tunnel) print as their keys, not [object Object].
    const show = (v: unknown): string =>
      typeof v === "object" && v !== null
        ? Array.isArray(v)
          ? `[${v.length}]`
          : `{${Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join(", ") || " "}}`
        : String(v);
    report(
      "ok",
      `${path.basename(project.configPath)} well-formed`,
      keys.length ? keys.map((k) => `${k}: ${show(cfg[k])}`).join(", ") : "empty — defaults apply"
    );
    if (!cfg.name) report("info", "name not set in kraftwerk.yml", "inspector header falls back to the folder name");
    for (const key of ["workflows", "knowledge", "agents", "output"] as const) {
      const value = cfg[key] as string | undefined;
      if (!value) continue;
      const abs = path.resolve(project.root, value);
      if (await isDir(abs)) continue;
      if (key === "output") {
        report("info", `output: ${value}`, "directory not created yet — appears on first run");
      } else {
        report("fail", `${key}: ${value}`, "configured directory does not exist");
        failures++;
      }
    }
  }
  // .env next to kraftwerk.yml: already applied by the CLI hook; this call
  // only reports what it holds (names, never values).
  const dotenv = await applyDotenv(project.root);
  if (dotenv.file) {
    const names = [...dotenv.applied, ...dotenv.kept.map((k) => `${k} (shell wins)`)];
    report("ok", `${DOTENV_FILE}: ${names.length} variable(s) loaded`, names.join(", ") || "empty");
  } else {
    report("info", `no ${DOTENV_FILE}`, "variables for agents, workflows and the tunnel can live there — loaded on every start and restart");
  }

  // Repositories: the clones root must stay out of the workspace git. git
  // itself decides — that covers worktrees (.git is a file), a workspace
  // nested in a larger repo, a .gitignore at the toplevel, global excludes.
  const reposRoot = reposRootFor(project);
  if (reposRoot) {
    const entry = ignoreEntryFor(project.root, reposRoot) ?? path.relative(project.root, reposRoot);
    const label = `repos: ${path.relative(cwd, reposRoot) || "."}`;
    const check = spawnSync("git", ["check-ignore", "-q", "--", reposRoot], { cwd: project.root, encoding: "utf8" });
    if (check.error) report("info", label, "git not found — cannot check .gitignore");
    else if (check.status === 0) report("ok", label, "git-ignored");
    else if (check.status === 1) report("warn", label, `${entry}/ is not git-ignored — clones would show up as untracked gitlinks; add it to .gitignore`);
    else report("ok", label, "not inside a git repository");
  }

  // Public hostname + Cloudflare Tunnel. The UI has no login of its own, so
  // a tunnel without Access verification is worth a warning every time.
  const publicHost = publicHostFor(project);
  const tunnel = tunnelFor(project);
  if (publicHost && !tunnel) report("info", `public: ${publicHost}`, "served when a tunnel or reverse proxy delivers that Host");
  if (tunnel) {
    const cloudflared = cliVersion("cloudflared");
    if (cloudflared) report("ok", `cloudflared`, cloudflared);
    else {
      report("fail", "cloudflared missing", "needed by tunnel: — brew install cloudflared (or see developers.cloudflare.com)");
      failures++;
    }
    if (tunnel.name) report("ok", `tunnel: ${tunnel.name} → ${publicHost}`, `cloudflared tunnel run --url http://127.0.0.1:${project.config.port ?? 1981} ${tunnel.name}`);
    else if (process.env.TUNNEL_TOKEN) report("ok", `tunnel: dashboard-managed → ${publicHost}`, "TUNNEL_TOKEN is set");
    else {
      report("fail", "tunnel: nothing to run", "set tunnel.name (locally-managed) or the TUNNEL_TOKEN env var (dashboard-managed)");
      failures++;
    }
    if (tunnel.access) report("ok", "tunnel.access", `tokens verified against ${tunnel.access.team}.cloudflareaccess.com`);
    else report("warn", "tunnel without access", "the UI has no login of its own — put a Cloudflare Access policy on the hostname and set tunnel.access so a removed policy fails closed");
  }

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
  // Over the agent protocol the bundled adapters bring their own runtime.
  const needed = new Set<string>();
  let acp = false;
  for (const e of found) {
    for (const a of e.workflow?.meta.agents ?? []) {
      if (a.protocol === "acp") acp = true;
      else needed.add(a.harness ?? "claude");
    }
  }
  if (acp) report("ok", "agent protocol adapters", "claude-agent-acp + codex-acp bundled with kraftwerk");
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
