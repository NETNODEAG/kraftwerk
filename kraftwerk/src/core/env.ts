import { readFileSync } from "node:fs";
import path from "node:path";
import { DOTENV_FILE, DOTENV_MARKER, parseDotenv } from "../dotenv.js";
import { currentWorkspace } from "./workspace.js";

/**
 * The environment a workspace's processes run with: this process's, plus
 * the workspace's own `.env` (dotenv.ts for the precedence — a value set in
 * the shell wins, unless an earlier kraftwerk process injected it from a
 * `.env`). Everything a workspace spawns — agents, workflow runs, app dev
 * servers, git — takes its environment from here, never from process.env
 * directly: one process may serve several workspaces, and one team's
 * `.env` must not reach another's agents.
 *
 * With one workspace per process the CLI has already applied that
 * workspace's `.env` to process.env, so the result is the same as before.
 */

/** Read `<root>/.env` (parsed, not applied); {} without one. Read when a workspace is served — a changed file applies on restart, as before. */
export function readWorkspaceDotenv(root: string): Record<string, string> {
  try {
    return parseDotenv(readFileSync(path.join(root, DOTENV_FILE), "utf8"));
  } catch {
    return {};
  }
}

/** The current workspace's environment (outside any workspace: process.env). */
export function workspaceEnv(): NodeJS.ProcessEnv {
  let dotenv: Record<string, string>;
  try {
    dotenv = currentWorkspace().env;
  } catch {
    return { ...process.env };
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  const injected = new Set((process.env[DOTENV_MARKER] ?? "").split(",").filter(Boolean));
  // What another workspace's .env put into this process is not this workspace's.
  for (const key of injected) if (!(key in dotenv)) delete env[key];
  for (const [key, value] of Object.entries(dotenv)) if (!process.env[key] || injected.has(key)) env[key] = value;
  return env;
}
