import { currentWorkspace } from "./workspace.js";

/**
 * Shorthands for the current workspace's paths (see workspace.ts for how
 * the current workspace is chosen).
 */

/** Absolute output directory (runs/ + chats/ live inside). */
export function getOutputDir(): string {
  return currentWorkspace().outputDir;
}

/** The workspace root: where kraftwerk.yml lives. */
export function getProjectRoot(): string {
  return currentWorkspace().root;
}
