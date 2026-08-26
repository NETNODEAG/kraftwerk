import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { resolveProject } from "../config.js";
import { startInspector } from "../inspector/server.js";

/**
 * `kraftwerk ui` — start the inspector web UI pointed at the current
 * project's output dir. The server is dependency-free node:http (part of
 * this package); the frontend is a prebuilt Vite bundle shipped in
 * inspector/dist. Nothing to install at runtime — the server starts
 * instantly and runs in the foreground until Ctrl-C.
 */

/** Package root is two levels up from this file (src/cli/ or dist/cli/). */
const packageRoot = (): string =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Published packages ship inspector/dist. A dev checkout builds it on
 * first use (and after frontend edits: `npm run build` in inspector/).
 */
function ensureBuilt(): string {
  const inspector = path.join(packageRoot(), "inspector");
  const dist = path.join(inspector, "dist");
  if (existsSync(path.join(dist, "index.html"))) return dist;

  if (!existsSync(path.join(inspector, "src"))) {
    console.error(chalk.red(`Inspector assets missing at ${dist} — broken install?`));
    process.exit(1);
  }
  console.log(chalk.dim("Building the inspector frontend (first use in this checkout) ..."));
  for (const args of [
    ...(existsSync(path.join(inspector, "node_modules")) ? [] : [["install", "--no-fund", "--no-audit"]]),
    ["run", "build"],
  ]) {
    const r = spawnSync("npm", args, { cwd: inspector, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(chalk.red(`npm ${args.join(" ")} failed in inspector/.`));
      process.exit(1);
    }
  }
  return dist;
}

export async function runUi(cwd: string, opts: { port?: string; output?: string }): Promise<void> {
  const staticDir = ensureBuilt();
  const project = await resolveProject(cwd);
  const outputDir = opts.output ? path.resolve(cwd, opts.output) : project.outputDir;
  const port = Number(opts.port ?? "1981");

  await startInspector({ outputDir, staticDir, port, projectRoot: project.root });
  console.log(
    `${chalk.green("✔")} Kraftwerk UI: ${chalk.cyan(`http://localhost:${port}`)} ` +
      chalk.dim(`(output: ${outputDir})`)
  );
}
