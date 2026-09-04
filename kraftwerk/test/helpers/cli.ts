import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Run the real `kraftwerk` bin the way a user would: a fresh process, a
 * working directory, a private HOME. Colours are off so assertions can
 * match plain text. Nothing is mocked; commands that would spawn docker or
 * a coding agent are simply not exercised here.
 */
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/kraftwerk.js");

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** stdout + stderr, for assertions that do not care which stream. */
  all: string;
}

export function cli(
  cwd: string,
  home: string,
  args: string[],
  opts: { stdin?: string; env?: Record<string, string> } = {}
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        ...opts.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr, all: stdout + stderr }));
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

/** Parse the JSON a `--json` command printed on stdout. */
export function json<T = unknown>(r: CliResult): T {
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    throw new Error(`not JSON (exit ${r.code}):\n${r.all}`);
  }
}
