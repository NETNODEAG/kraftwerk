import { existsSync } from "node:fs";
import { cp, readFile } from "node:fs/promises";
import os from "node:os";
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
const packageRoot = (): string =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const inNodeModules = (p: string): boolean =>
  p.split(path.sep).includes("node_modules");

/**
 * The inspector cannot run in place from an installed package: Next.js
 * excludes everything under node_modules/ from compilation, so its .ts/.tsx
 * sources would be served raw. Installed copies are materialized (sources
 * only) into ~/.cache/kraftwerk/inspector-<version>/ and run from there;
 * dev checkouts run in place.
 */
async function materializeInspector(): Promise<string> {
  const src = path.join(packageRoot(), "inspector");
  if (!inNodeModules(src)) return src;

  const pkg = JSON.parse(await readFile(path.join(packageRoot(), "package.json"), "utf8"));
  const dest = path.join(os.homedir(), ".cache", "kraftwerk", `inspector-${pkg.version}`);
  if (!existsSync(path.join(dest, "package.json"))) {
    await cp(src, dest, {
      recursive: true,
      filter: (s) => {
        const parts = path.relative(src, s).split(path.sep);
        return !parts.includes("node_modules") && !parts.includes(".next");
      },
    });
  }
  return dest;
}

export async function runUi(cwd: string, opts: { port?: string; output?: string }): Promise<void> {
  if (!existsSync(path.join(packageRoot(), "inspector", "package.json"))) {
    console.error(chalk.red(`Inspector not found at ${path.join(packageRoot(), "inspector")} — broken install?`));
    process.exit(1);
  }
  const dir = await materializeInspector();

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
