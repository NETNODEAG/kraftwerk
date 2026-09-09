import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The project's `.env`: KEY=VALUE lines next to kraftwerk.yml, loaded into
 * this process at CLI start (a commander preAction hook in kraftwerk.ts),
 * so every kraftwerk process sees them and everything it spawns inherits
 * them — the inspector, the chat agents and routines, workflow runs, the
 * tunnel (TUNNEL_TOKEN), `requires:` checks.
 *
 * A variable already set in the shell wins over the file, the dotenv
 * convention, with one exception that makes restarts work: a value this
 * process inherited from an earlier kraftwerk process that itself took it
 * from a `.env` is not a shell setting. Those keys are listed in
 * KRAFTWERK_DOTENV_KEYS by whoever injected them, so a restarted server
 * (the `kraftwerk ui` supervisor respawns it with its own environment)
 * re-reads the file and applies changed values, and a project launched
 * from another workspace's inspector drops that workspace's variables
 * instead of running with them.
 *
 * Never synced: `.env` is on the workspace git's deny list (git.ts) and in
 * the .gitignore `kraftwerk init` writes.
 */

export const DOTENV_FILE = ".env";
export const DOTENV_MARKER = "KRAFTWERK_DOTENV_KEYS";

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parse dotenv text: comments, `export ` prefixes, single/double quotes, `\n` in double quotes. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!KEY.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      // An unquoted value ends at a comment: `PORT=1981 # inspector`.
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[key] = value;
  }
  return out;
}

export interface DotenvResult {
  /** Absolute path of the file, undefined when the project has none. */
  file?: string;
  /** Keys set from the file. */
  applied: string[];
  /** Keys in the file left alone because the shell had set them. */
  kept: string[];
  /** Keys an earlier kraftwerk process had injected that this file no longer has. */
  removed: string[];
}

/**
 * Apply `<root>/.env` to process.env (see the module comment for the
 * precedence). Idempotent: a second call re-applies the same keys. Without
 * a file it still drops keys an earlier process injected.
 */
export async function applyDotenv(root: string): Promise<DotenvResult> {
  const file = path.join(root, DOTENV_FILE);
  const text = await readFile(file, "utf8").catch(() => undefined);
  const parsed = text === undefined ? {} : parseDotenv(text);
  const injected = new Set((process.env[DOTENV_MARKER] ?? "").split(",").filter(Boolean));
  const applied: string[] = [];
  const kept: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    // An empty shell value is as good as unset (`requires:` treats it so too).
    if (!process.env[key] || injected.has(key)) {
      process.env[key] = value;
      applied.push(key);
    } else {
      kept.push(key);
    }
  }
  const removed = [...injected].filter((key) => !(key in parsed));
  for (const key of removed) delete process.env[key];
  if (applied.length > 0) process.env[DOTENV_MARKER] = applied.join(",");
  else delete process.env[DOTENV_MARKER];
  return { file: text === undefined ? undefined : file, applied, kept, removed };
}
