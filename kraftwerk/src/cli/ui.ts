import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import chalk from "chalk";
import { absolutePath, publicUrlFor, resolveWorkspace } from "../config.js";
import { startTunnel } from "./tunnel.js";
import { selfCommand } from "../core/self-command.js";
import { RESTART_EXIT_CODE, startInspector } from "../server/server.js";

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
function ensureBuilt(): string {
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

export async function runUi(cwd: string, opts: { port?: string; output?: string }): Promise<void> {
  if (process.env.KRAFTWERK_UI_SUPERVISED !== "1") return superviseUi(cwd, opts);

  const staticDir = ensureBuilt();
  const project = await resolveWorkspace(cwd);
  const outputDir = opts.output ? absolutePath(opts.output, cwd) : project.outputDir;
  // Port precedence: --port flag > kraftwerk.yml `port` > 1981.
  const port = opts.port ? Number(opts.port) : (project.config.port ?? 1981);

  await startInspector({ outputDir, staticDir, port, root: project.root });
  console.log(
    `${chalk.green("✔")} Kraftwerk UI: ${chalk.cyan(`http://localhost:${port}`)} ` +
      chalk.dim(`(output: ${outputDir})`)
  );
  const publicUrl = publicUrlFor(project);
  if (publicUrl) console.log(`${chalk.green("✔")} Public URL: ${chalk.cyan(publicUrl)}`);
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
async function superviseUi(cwd: string, opts: { port?: string; output?: string }): Promise<void> {
  const { cmd, args } = selfCommand([
    "ui",
    ...(opts.port ? ["--port", opts.port] : []),
    ...(opts.output ? ["--output", opts.output] : []),
  ]);
  // The tunnel lives with the supervisor, not the server: a self-restart
  // (new version) swaps the server process and the tunnel stays up.
  const project = await resolveWorkspace(cwd).catch(() => null);
  const tunnel = project ? startTunnel(project, opts.port ? Number(opts.port) : (project.config.port ?? 1981)) : undefined;
  for (;;) {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: { ...process.env, KRAFTWERK_UI_SUPERVISED: "1" },
    });
    const forward = (sig: NodeJS.Signals) => () => {
      tunnel?.stop();
      child.kill(sig);
    };
    const handlers = { SIGTERM: forward("SIGTERM"), SIGINT: forward("SIGINT") };
    process.on("SIGTERM", handlers.SIGTERM);
    process.on("SIGINT", handlers.SIGINT);
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    process.off("SIGTERM", handlers.SIGTERM);
    process.off("SIGINT", handlers.SIGINT);
    if (result.code !== RESTART_EXIT_CODE) {
      tunnel?.stop();
      // A signal-killed server is not a clean exit — say so in the exit code
      // (128 + signal, the shell convention) so callers can tell.
      if (result.signal) process.exit(128 + (os.constants.signals[result.signal] ?? 1));
      process.exit(result.code ?? 1);
    }
    console.log(chalk.dim("↻ relaunching the UI with the current install ..."));
  }
}
