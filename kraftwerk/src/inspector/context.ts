import path from "node:path";

/**
 * Server-side context for the inspector: which consumer project it looks at.
 * Set once by startInspector() before any request is served.
 */

let outputDir = "";
let projectRoot = "";

export function setOutputDir(dir: string): void {
  outputDir = path.resolve(dir);
}

export function setProjectRoot(dir: string): void {
  projectRoot = path.resolve(dir);
}

/** Absolute output directory (runs/ + chats/ live inside). */
export function getOutputDir(): string {
  if (!outputDir) throw new Error("inspector context not initialized");
  return outputDir;
}

/**
 * The consumer project root. Set explicitly at startup; falls back to the
 * parent of the output dir (wrong for nested output dirs like
 * kraftwerk-data/output — always pass projectRoot when known).
 */
export function getProjectRoot(): string {
  return projectRoot || path.dirname(getOutputDir());
}
