import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import chalk from "chalk";
import { resolveProject } from "../config.js";

/**
 * `kraftwerk ui` — start the inspector web UI (Next.js app shipped in the
 * package under inspector/) pointed at the current project's output dir.
 * First launch installs the inspector's dependencies; the server then runs
 * in the foreground until Ctrl-C.
 */

/** Package root is two levels up from this file (src/cli/ or dist/cli/). */
const inspectorDir = (): string =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../inspector");

export async function runUi(cwd: string, opts: { port?: string; output?: string }): Promise<void> {
  const dir = inspectorDir();
  if (!existsSync(path.join(dir, "package.json"))) {
    console.error(chalk.red(`Inspector not found at ${dir} — broken install?`));
    process.exit(1);
  }

  const outputDir = opts.output
    ? path.resolve(cwd, opts.output)
    : (await resolveProject(cwd)).outputDir;
  const port = opts.port ?? "4499";

  if (!existsSync(path.join(dir, "node_modules"))) {
    console.log(chalk.dim("First launch — installing inspector dependencies ..."));
    const install = spawnSync("npm", ["install", "--no-fund", "--no-audit"], {
      cwd: dir,
      stdio: "inherit",
    });
    if (install.status !== 0) {
      console.error(chalk.red("npm install failed in the inspector directory."));
      process.exit(1);
    }
  }

  console.log(
    `${chalk.green("✔")} Inspector: ${chalk.cyan(`http://localhost:${port}`)} ` +
      chalk.dim(`(output: ${outputDir})`)
  );

  const nextBin = path.join(dir, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "-p", port], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, KRAFTWERK_OUTPUT: outputDir },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code) => process.exit(code ?? 0));
}
