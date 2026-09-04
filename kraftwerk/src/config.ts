import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

/**
 * Project resolution + optional project config.
 *
 * `kraftwerk.yml` at the project root is both the config file and the
 * root marker, so every CLI command works from any subdirectory. Without
 * it, the walk-up falls back to the first ancestor containing a workflows
 * root (src/workflows/ or workflows/), then to the first .git directory,
 * then to the starting cwd.
 *
 * All fields are optional — a valid kraftwerk.yml may be empty:
 *
 *   name: my-project           # display name (inspector header, "environment")
 *   icon: "⚡"                  # emoji shown as inspector favicon
 *   port: 1981                 # port `kraftwerk ui` listens on
 *   workflows: src/workflows   # workflows root, relative to the file
 *   output: output             # run-artifact directory, relative to the file
 *   knowledge: knowledge       # OKF knowledge-bundle root, relative to the file
 *   agents: agents             # agent-definition root, relative to the file
 *   skills: skills             # workspace skill root, relative to the file
 *   switcher:                  # other kraftwerk workspaces, linked from the header dropdown
 *     - name: other space
 *       url: https://localhost:1985
 *       icon: "🛰"              # optional emoji shown next to the entry
 *   git:                       # workspace git sync (absent = off, bare key = on with defaults)
 *     remote: origin
 *     interval: 300            # seconds between background fetches
 *     autosync: pull           # off | pull
 *   repos:                     # git repositories the agents work on (absent = off, bare key = on)
 *     root: kraftwerk-data/repos   # where clones land, relative to the file. Default: repos
 */

/** Stable, versionless URL of the workflow JSON schema (editor validation). */
export const SCHEMA_URL =
  "https://raw.githubusercontent.com/NETNODEAG/kraftwerk/main/kraftwerk/schema/workflow.schema.json";

/** Stable, versionless URL of the kraftwerk.yml JSON schema (editor validation). */
export const CONFIG_SCHEMA_URL =
  "https://raw.githubusercontent.com/NETNODEAG/kraftwerk/main/kraftwerk/schema/kraftwerk.schema.json";

export const CONFIG_FILENAMES = ["kraftwerk.yml", "kraftwerk.yaml"];

const WORKFLOW_ROOT_CANDIDATES = ["src/workflows", "workflows"];

/**
 * Git sync for the workspace. The synced paths are not configurable: they
 * are the roots this file already declares (workflows, knowledge, agents,
 * skills) plus kraftwerk.yml itself. Commit and push stay manual; the
 * interval only fetches, and pulls when `autosync` allows it.
 */
export interface GitConfig {
  /** false keeps the block but turns the feature off. Default: true. */
  enabled?: boolean;
  /** Remote to fetch, pull and push. Default: origin. */
  remote?: string;
  /** Branch to sync. Default: whatever is checked out. */
  branch?: string;
  /** Seconds between background fetches. 0 disables the timer. Default: 300. */
  interval?: number;
  /** off = fetch only. pull = also fast-forward when behind and clean. Default: pull. */
  autosync?: "off" | "pull";
}

/**
 * Repositories: git clones the agents work on, kept under one root inside
 * the project so every agent finds them at a known path. The root is never
 * synced by the workspace git and should be git-ignored.
 */
export interface ReposConfig {
  /** false keeps the block but turns the feature off. Default: true. */
  enabled?: boolean;
  /** Where clones land, relative to the project root. Default: repos */
  root?: string;
}

/** Where clones land when `repos.root` is not set. */
export const REPOS_DEFAULT_ROOT = "repos";

/**
 * Absolute repos root when the feature is on, undefined otherwise. The one
 * place that reads the block, so the sync exclude, the doctor check, the
 * settings save and the module itself cannot disagree.
 */
export function reposRootFor(project: Project): string | undefined {
  const r = project.config.repos;
  if (!r || r.enabled === false) return undefined;
  return path.resolve(project.root, r.root ?? REPOS_DEFAULT_ROOT);
}

/** A directory as a .gitignore entry: relative, forward slashes, no trailing slash; undefined outside the root. */
export function ignoreEntryFor(projectRoot: string, dir: string): string | undefined {
  const rel = path.relative(projectRoot, path.resolve(projectRoot, dir)).split(path.sep).join("/");
  if (!rel || rel === "." || rel.startsWith("..")) return undefined;
  return rel;
}

/** True when .gitignore text already covers the entry (with or without a leading or trailing slash). */
export function gitignoreHas(text: string, entry: string): boolean {
  return text.split("\n").some((l) => l.trim().replace(/^\//, "").replace(/\/$/, "") === entry);
}

/** One entry of the workspace switcher: another kraftwerk instance to link to. */
export interface SwitcherEntry {
  /** Display name of the other workspace. */
  name: string;
  /** URL the other workspace's inspector runs on, e.g. https://localhost:1985 */
  url: string;
  /** Optional emoji shown next to the entry. */
  icon?: string;
}

export interface ProjectConfig {
  /** Display name of the project ("environment"), shown in the inspector header. */
  name?: string;
  /** Emoji used as the inspector favicon (browser-tab icon). */
  icon?: string;
  /** Port `kraftwerk ui` listens on. Default: 1981 (CLI --port wins). */
  port?: number;
  /** Workflows root relative to the project root. */
  workflows?: string;
  /** Run-artifact directory relative to the project root. Default: output */
  output?: string;
  /** OKF knowledge-bundle root relative to the project root. Default: knowledge */
  knowledge?: string;
  /** Agent-definition root relative to the project root. Default: agents */
  agents?: string;
  /** Workspace skill root relative to the project root. Default: skills */
  skills?: string;
  /** Other kraftwerk workspaces, shown as a switcher dropdown in the inspector header. */
  switcher?: SwitcherEntry[];
  /** Workspace git sync. Absent = off. */
  git?: GitConfig;
  /** Repositories the agents work on. Absent = off. */
  repos?: ReposConfig;
}

export interface Project {
  /** Absolute project root the CLI operates on. */
  root: string;
  /** Parsed kraftwerk.yml, {} if none exists. */
  config: ProjectConfig;
  /** Absolute path of the config file, if one exists. */
  configPath?: string;
  /** Absolute workflows root, if one exists. */
  workflowsRoot?: string;
  /** Absolute run-artifact directory (may not exist yet). */
  outputDir: string;
}

const exists = async (p: string): Promise<boolean> => !!(await stat(p).catch(() => null));

/** True when the path exists and is a directory. */
/**
 * A user-supplied path as an absolute one: a leading `~` is the home
 * directory (shells expand it, JSON bodies and quoted args do not), then
 * path.resolve. Every path that gets stored or compared — registry roots,
 * `--output`, project refs — goes through here so nothing ever persists
 * `~/…` or `<cwd>/~/…`.
 */
export function absolutePath(p: string, from: string = process.cwd()): string {
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(from, p);
}

export const isDir = async (p: string): Promise<boolean> =>
  (await stat(p).catch(() => null))?.isDirectory() ?? false;

async function findConfigFile(dir: string): Promise<string | undefined> {
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(dir, name);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function findWorkflowsDir(dir: string, configured?: string): Promise<string | undefined> {
  const candidates = configured ? [configured] : WORKFLOW_ROOT_CANDIDATES;
  for (const candidate of candidates) {
    const abs = path.resolve(dir, candidate);
    if (await isDir(abs)) return abs;
  }
  return undefined;
}

/**
 * Resolve the project for a cwd: walk up until a kraftwerk.yml or a
 * workflows root appears; a .git directory is the fallback root, the cwd
 * itself the last resort.
 */
export async function resolveProject(cwd: string): Promise<Project> {
  const start = path.resolve(cwd);
  let gitFallback: string | undefined;

  for (let dir = start; ; dir = path.dirname(dir)) {
    const configPath = await findConfigFile(dir);
    if (configPath) {
      const config = await loadConfig(configPath);
      return {
        root: dir,
        config,
        configPath,
        workflowsRoot: await findWorkflowsDir(dir, config.workflows),
        outputDir: path.resolve(dir, config.output ?? "output"),
      };
    }
    const workflowsRoot = await findWorkflowsDir(dir);
    if (workflowsRoot) {
      return { root: dir, config: {}, workflowsRoot, outputDir: path.join(dir, "output") };
    }
    if (!gitFallback && (await exists(path.join(dir, ".git")))) gitFallback = dir;
    if (dir === path.dirname(dir)) break;
  }

  const root = gitFallback ?? start;
  return { root, config: {}, outputDir: path.join(root, "output") };
}

const KNOWN_KEYS = ["name", "icon", "port", "workflows", "output", "knowledge", "agents", "skills", "switcher", "git", "repos"];

async function loadConfig(configPath: string): Promise<ProjectConfig> {
  let raw: unknown;
  try {
    raw = parse(await readFile(configPath, "utf8"));
  } catch (err) {
    throw new Error(`${path.basename(configPath)}: unreadable YAML: ${(err as Error).message}`);
  }
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path.basename(configPath)}: expected a mapping (${KNOWN_KEYS.join(", ")})`);
  }
  const config = raw as Record<string, unknown>;
  const known = KNOWN_KEYS;
  for (const key of Object.keys(config)) {
    if (!known.includes(key)) {
      throw new Error(
        `${path.basename(configPath)}: unknown key "${key}" (allowed: ${known.join(", ")})`
      );
    }
    if (key === "port") {
      if (typeof config[key] !== "number" || !Number.isInteger(config[key])) {
        throw new Error(`${path.basename(configPath)}: port must be an integer`);
      }
    } else if (key === "switcher") {
      validateSwitcher(configPath, config[key]);
    } else if (key === "git") {
      // A bare `git:` line parses as null. Every field has a default, so read
      // it as "on, with defaults" instead of failing the whole config load
      // and taking the rest of the inspector down with it.
      if (config[key] === null) config[key] = {};
      validateGit(configPath, config[key]);
    } else if (key === "repos") {
      if (config[key] === null) config[key] = {};
      validateRepos(configPath, config[key]);
    } else if (typeof config[key] !== "string") {
      throw new Error(`${path.basename(configPath)}: ${key} must be a string`);
    }
  }
  return config as ProjectConfig;
}

function validateSwitcher(configPath: string, value: unknown): void {
  const file = path.basename(configPath);
  if (!Array.isArray(value)) {
    throw new Error(`${file}: switcher must be a list of { name, url, icon? } entries`);
  }
  value.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${file}: switcher[${i}] must be a mapping with name and url`);
    }
    const e = entry as Record<string, unknown>;
    for (const key of Object.keys(e)) {
      if (!["name", "url", "icon"].includes(key)) {
        throw new Error(`${file}: switcher[${i}]: unknown key "${key}" (allowed: name, url, icon)`);
      }
    }
    if (typeof e.name !== "string" || !e.name.trim()) {
      throw new Error(`${file}: switcher[${i}]: name must be a non-empty string`);
    }
    if (typeof e.url !== "string" || !/^https?:\/\//.test(e.url)) {
      throw new Error(`${file}: switcher[${i}]: url must be an http(s) URL`);
    }
    if (e.icon !== undefined && typeof e.icon !== "string") {
      throw new Error(`${file}: switcher[${i}]: icon must be a string`);
    }
  });
}

function validateGit(configPath: string, value: unknown): void {
  const file = path.basename(configPath);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file}: git must be a mapping (enabled, remote, branch, interval, autosync)`);
  }
  const g = value as Record<string, unknown>;
  const known = ["enabled", "remote", "branch", "interval", "autosync"];
  for (const key of Object.keys(g)) {
    if (!known.includes(key)) {
      throw new Error(`${file}: git.${key} is unknown (allowed: ${known.join(", ")})`);
    }
  }
  if (g.enabled !== undefined && typeof g.enabled !== "boolean") {
    throw new Error(`${file}: git.enabled must be true or false`);
  }
  for (const key of ["remote", "branch"] as const) {
    if (g[key] !== undefined && (typeof g[key] !== "string" || !(g[key] as string).trim())) {
      throw new Error(`${file}: git.${key} must be a non-empty string`);
    }
  }
  if (g.interval !== undefined && (typeof g.interval !== "number" || !Number.isInteger(g.interval) || g.interval < 0)) {
    throw new Error(`${file}: git.interval must be a whole number of seconds (0 disables the timer)`);
  }
  if (g.autosync !== undefined && g.autosync !== "off" && g.autosync !== "pull") {
    throw new Error(`${file}: git.autosync must be "off" or "pull"`);
  }
}

function validateRepos(configPath: string, value: unknown): void {
  const file = path.basename(configPath);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file}: repos must be a mapping (enabled, root)`);
  }
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!["enabled", "root"].includes(key)) {
      throw new Error(`${file}: repos.${key} is unknown (allowed: enabled, root)`);
    }
  }
  if (r.enabled !== undefined && typeof r.enabled !== "boolean") {
    throw new Error(`${file}: repos.enabled must be true or false`);
  }
  if (r.root !== undefined && (typeof r.root !== "string" || !r.root.trim())) {
    throw new Error(`${file}: repos.root must be a non-empty string`);
  }
  // The root is what `repos remove --force` deletes under, so it must never
  // be the project itself or anything outside it.
  if (typeof r.root === "string" && !ignoreEntryFor(path.dirname(configPath), r.root.trim())) {
    throw new Error(`${file}: repos.root must be a directory inside the project (not ".", ".." or an absolute path outside it)`);
  }
}
