import path from "node:path";

/**
 * Server-side context for the inspector: which consumer project it looks at.
 * Set once by startInspector() before any request is served.
 */

let outputDir = "";

export function setOutputDir(dir: string): void {
  outputDir = path.resolve(dir);
}

/** Absolute output directory (one run-* folder per run). */
export function getOutputDir(): string {
  if (!outputDir) throw new Error("inspector context not initialized");
  return outputDir;
}

/** The consumer project root is the parent of the output dir. */
export function getProjectRoot(): string {
  return path.dirname(getOutputDir());
}
