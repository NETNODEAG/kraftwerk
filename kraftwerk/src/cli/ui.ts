import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import chalk from "chalk";
import { absolutePath, resolveWorkspace, workspaceSlug } from "../config.js";
import { slugClashes } from "../core/instances.js";
import { daemonCall, findDaemon } from "../core/daemon.js";
import { selfCommand } from "../core/self-command.js";
import { RESTART_EXIT_CODE, startInspector } from "../server/server.js";
import { networkUrls } from "../server/bind.js";

/**
 * `kraftwerk ui` — start the inspector web UI pointed at the current
 * project's output dir. The server is dependency-free node:http (part of
 * this package); the frontend is a prebuilt Vite bundle shipped in
 * web/dist. Nothing to install at runtime — the server starts
 * instantly and runs in the foreground until Ctrl-C.
 *
 * The command is a thin supervisor: the actual server runs as a child
 * process and is respawned whenever it exits with RESTART_EXIT_CODE
 * (POST /api/restart, offered by the UI when a newer version landed on
 * disk) — the fresh process loads the freshly installed code.
 */

/** Package root is two levels up from this file (src/cli/ or dist/cli/). */
const packageRoot = (): string =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Published packages ship web/dist. A dev checkout builds it on
 * first use (and after frontend edits: `npm run build` in web/).
 */
export function ensureBuilt(): string {
  // Another build of the web UI (tests serve a stub; a dev setup may point at its own).
  if (process.env.KRAFTWERK_WEB_DIR) return path.resolve(process.env.KRAFTWERK_WEB_DIR);
  const web = path.join(packageRoot(), "web");
  const dist = path.join(web, "dist");
  if (existsSync(path.join(dist, "index.html"))) return dist;

  if (!existsSync(path.join(web, "src"))) {
    console.error(chalk.red(`Inspector assets missing at ${dist} — broken install?`));
    process.exit(1);
  }
  console.log(chalk.dim("Building the inspector frontend (first use in this checkout) ..."));
  for (const args of [
    ...(existsSync(path.join(web, "node_modules")) ? [] : [["install", "--no-fund", "--no-audit"]]),
    ["run", "build"],
  ]) {
    const r = spawnSync("npm", args, { cwd: web, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(chalk.red(`npm ${args.join(" ")} failed in web/.`));
      process.exit(1);
    }
  }
  return dist;
}

export async function runUi(cwd: string, opts: { port?: string; output?: string; lan?: boolean; standalone?: boolean }): Promise<void> {
  // The machine runs a daemon: hand it this workspace, it serves it next to the others.
  if (!opts.standalone && !opts.port && !opts.output && !opts.lan && process.env.KRAFTWERK_UI_SUPERVISED !== "1") {
    const daemon = await findDaemon();
    if (daemon) {
      const project = await resolveWorkspace(cwd);
      const r = await daemonCall<{ url: string; aliasPort?: number }>(daemon.port, "open", project.root);
      if (!r.ok) {
        console.error(chalk.red(`✖ the kraftwerk daemon refused: ${r.data.error ?? r.status}`));
        process.exit(1);
      }
      console.log(`${chalk.green("✔")} Kraftwerk UI: ${chalk.cyan(r.data.url)} ${chalk.dim(`(served by the kraftwerk daemon, pid ${daemon.pid})`)}`);
      if (r.data.aliasPort) console.log(chalk.dim(`  also at http://localhost:${r.data.aliasPort}`));
      console.log(chalk.dim("  `kraftwerk workspaces stop .` closes it there; `kraftwerk ui --standalone` runs a server of its own instead."));
      return;
    }
  }
  // The server reads its bind address when it starts — in the supervised child, which inherits this.
  if (opts.lan) process.env.KRAFTWERK_UI_HOST ||= "0.0.0.0";
  if (process.env.KRAFTWERK_UI_SUPERVISED !== "1") return superviseUi(opts);

  const staticDir = ensureBuilt();
  const project = await resolveWorkspace(cwd);
  const outputDir = opts.output ? absolutePath(opts.output, cwd) : project.outputDir;
  // Port precedence: --port flag > kraftwerk.yml `port` > 1981.
  const port = opts.port ? Number(opts.port) : (project.config.port ?? 1981);

  await startInspector({ outputDir, staticDir, port, root: project.root });
  // Two workspaces with one slug would share an address once one kraftwerk serves them all.
  const slug = workspaceSlug(project);
  const clash = await slugClashes(slug, project.root);
  if (clash.length)
    console.log(
      `${chalk.yellow("⚠")} slug "${slug}" is also used by ${clash.map((r) => r.root).join(", ")} — set \`slug:\` in one kraftwerk.yml so each workspace keeps its own address`,
    );
  console.log(
    `${chalk.green("✔")} Kraftwerk UI: ${chalk.cyan(`http://localhost:${port}`)} ` +
      chalk.dim(`(output: ${outputDir})`)
  );
  const lan = networkUrls(port);
  if (lan.length) {
    console.log(`${chalk.green("✔")} On your network: ${lan.map((u) => chalk.cyan(u)).join(", ")}`);
    console.log(chalk.dim("  Devices there get a pairing screen — `kraftwerk devices pair` (or settings → devices) makes the code."));
  }
}

/**
 * Respawn loop around the real server. Spawns this same bin script via the
 * current node (selfCommand) — works identically for global installs,
 * local node_modules, npx, and a file: dev checkout. Any exit other than
 * RESTART_EXIT_CODE ends the loop. A SIGTERM/SIGINT to the supervisor is
 * forwarded to the server, so `kill <supervisor pid>` (what `kraftwerk
 * workspaces start` reports) takes the whole UI down; Ctrl-C signals the
 * foreground group and reaches both anyway.
 */
async function superviseUi(opts: { port?: string; output?: string }): Promise<void> {
  return supervise(["ui", "--standalone", ...(opts.port ? ["--port", opts.port] : []), ...(opts.output ? ["--output", opts.output] : [])], "the UI");
}

/** The respawn loop for any long-running kraftwerk process (`ui`, `daemon`): see superviseUi. */
export async function supervise(argv: string[], what: string): Promise<void> {
  const { cmd, args } = selfCommand(argv);
  for (;;) {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: { ...process.env, KRAFTWERK_UI_SUPERVISED: "1" },
    });
    const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
    const handlers = { SIGTERM: forward("SIGTERM"), SIGINT: forward("SIGINT") };
    process.on("SIGTERM", handlers.SIGTERM);
    process.on("SIGINT", handlers.SIGINT);
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    process.off("SIGTERM", handlers.SIGTERM);
    process.off("SIGINT", handlers.SIGINT);
    if (result.code !== RESTART_EXIT_CODE) {
      // A signal-killed server is not a clean exit — say so in the exit code
      // (128 + signal, the shell convention) so callers can tell.
      if (result.signal) process.exit(128 + (os.constants.signals[result.signal] ?? 1));
      process.exit(result.code ?? 1);
    }
    console.log(chalk.dim(`↻ relaunching ${what} with the current install ...`));
  }
}
