import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Gates verify post-execution claims, never predictions: they run AFTER the
 * agent finishes and look only at the files it left behind. A gate returns
 * null (passed) or a human-readable failure that goes verbatim into the
 * correction prompt.
 *
 * Only workflow-agnostic gates live here; workflow-specific ones (schema
 * checks etc.) live next to their workflow and implement the same interface.
 */

export interface Gate {
  name: string;
  check(runDir: string): Promise<string | null>;
}

export const fileNonEmpty = (file: string): Gate => ({
  name: `file_non_empty(${file})`,
  async check(runDir) {
    try {
      const stats = await stat(path.join(runDir, file));
      return stats.size > 0 ? null : `${file} exists but is empty`;
    } catch {
      return `${file} was not written`;
    }
  },
});

/** No {{...}} template slots may survive a fill step. */
export const slotsFilled = (file: string): Gate => ({
  name: `slots_filled(${file})`,
  async check(runDir) {
    const content = await readFile(path.join(runDir, file), "utf8").catch(() => "");
    return content.includes("{{")
      ? `${file} still contains unfilled {{...}} slots`
      : null;
  },
});

/**
 * Workflow-specific validation as a bash script: exit 0 = passed, non-zero =
 * failed and everything the script printed becomes the failure message — so
 * precise per-violation output turns directly into a precise correction
 * prompt. The script runs in the run directory (env: RUN_DIR).
 */
export const checkScript = (script: string, label: string): Gate => ({
  name: `check(${label})`,
  async check(runDir) {
    const result = await new Promise<{ code: number; output: string }>((resolve, reject) => {
      const child = spawn("bash", ["-c", script], {
        cwd: runDir,
        env: { ...process.env, RUN_DIR: runDir },
      });
      let output = "";
      child.stdout.on("data", (chunk) => (output += String(chunk)));
      child.stderr.on("data", (chunk) => (output += String(chunk)));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, output }));
    });
    if (result.code === 0) return null;
    const tail = result.output.trim().split("\n").slice(-12).join("\n");
    return tail || `check script failed with exit code ${result.code}`;
  },
});

/** Fixed template parts chosen by code must survive byte-identically. */
export const containsText = (file: string, needle: string, label: string): Gate => ({
  name: `contains(${file}, ${label})`,
  async check(runDir) {
    const content = await readFile(path.join(runDir, file), "utf8").catch(() => "");
    return content.includes(needle)
      ? null
      : `${file} no longer contains "${needle}" — the fixed template part was changed`;
  },
});
