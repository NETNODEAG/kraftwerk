import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { ignoreEntryFor, REPOS_DEFAULT_ROOT, resolveProject, VIBEABLES_DEFAULT_ROOT, type GitConfig, type ProjectConfig, type ReposConfig, type SwitcherEntry, type VibeablesConfig } from "../config.js";
import { disposeAllDevs, ensureVibeablesRoot } from "./vibeables.js";
import { getProjectRoot } from "./context.js";
import { ensureReposRoot } from "./repos.js";

/**
 * Workspace settings: read kraftwerk.yml for the UI and write the
 * UI-editable subset (name, icon, switcher, git, repos, vibeables) back. Edits go through the
 * yaml Document API so comments and every other key survive untouched;
 * a missing kraftwerk.yml is created at the project root on first save.
 */

export interface SettingsView {
  root: string;
  configPath: string;
  exists: boolean;
  config: ProjectConfig;
  resolved: {
    workflowsRoot: string | null;
    outputDir: string;
    port: number;
  };
}

export interface SaveSettingsInput {
  /** Omitted = untouched; empty string = remove the key. */
  name?: string;
  icon?: string;
  /** Omitted = untouched; empty string = remove the key. Hex colour otherwise. */
  color?: string;
  /** Omitted = untouched; empty list = remove the key. */
  switcher?: SwitcherEntry[];
  /** Omitted = untouched. See cleanGit for how the block is written. */
  git?: GitSettingsInput;
  /** Omitted = untouched. Same rules as git: off with defaults = no block. */
  repos?: ReposSettingsInput;
  /** Omitted = untouched. Same shape and rules as repos. */
  vibeables?: ReposSettingsInput;
}

export interface ReposSettingsInput {
  enabled: boolean;
  root?: string;
}

/** The git form as the settings screen posts it. Every field but `enabled` may be blank. */
export interface GitSettingsInput {
  enabled: boolean;
  remote?: string;
  branch?: string;
  interval?: number | string;
  autosync?: "off" | "pull" | "";
}

const GIT_DEFAULTS = { remote: "origin", interval: 300, autosync: "pull" } as const;

export async function getSettings(): Promise<SettingsView> {
  const project = await resolveProject(getProjectRoot());
  return {
    root: project.root,
    configPath: project.configPath ?? path.join(project.root, "kraftwerk.yml"),
    exists: !!project.configPath,
    config: project.config,
    resolved: {
      workflowsRoot: project.workflowsRoot ?? null,
      outputDir: project.outputDir,
      port: project.config.port ?? 1981,
    },
  };
}

function cleanSwitcher(value: SwitcherEntry[]): SwitcherEntry[] {
  if (!Array.isArray(value)) throw new Error("switcher must be a list");
  return value.map((entry, i) => {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const url = typeof entry?.url === "string" ? entry.url.trim() : "";
    if (!name) throw new Error(`switcher entry ${i + 1}: name is required`);
    if (!/^https?:\/\//.test(url)) throw new Error(`switcher entry ${i + 1}: url must start with http:// or https://`);
    const icon = typeof entry.icon === "string" ? entry.icon.trim() : "";
    return icon ? { name, url, icon } : { name, url };
  });
}

/**
 * The git block to write. Defaults are left out so the file only says what
 * differs from them, and `enabled: false` keeps the other fields so turning
 * the feature back on restores them. Returns null when the block should not
 * exist at all: sync off and nothing else set, which is what no block means.
 */
function cleanGit(value: GitSettingsInput): GitConfig | null {
  if (typeof value !== "object" || value === null) throw new Error("git must be an object");
  if (typeof value.enabled !== "boolean") throw new Error("git.enabled must be true or false");
  const out: GitConfig = {};
  const remote = typeof value.remote === "string" ? value.remote.trim() : "";
  if (remote && remote !== GIT_DEFAULTS.remote) out.remote = remote;
  const branch = typeof value.branch === "string" ? value.branch.trim() : "";
  if (branch) out.branch = branch;
  if (value.interval !== undefined && value.interval !== "") {
    const n = typeof value.interval === "string" ? Number(value.interval) : value.interval;
    if (!Number.isInteger(n) || n < 0) throw new Error("git.interval must be a whole number of seconds (0 disables the timer)");
    if (n !== GIT_DEFAULTS.interval) out.interval = n;
  }
  if (value.autosync !== undefined && value.autosync !== "") {
    if (value.autosync !== "off" && value.autosync !== "pull") throw new Error('git.autosync must be "off" or "pull"');
    if (value.autosync !== GIT_DEFAULTS.autosync) out.autosync = value.autosync;
  }
  if (value.enabled) return out;
  if (Object.keys(out).length === 0) return null;
  return { enabled: false, ...out };
}

/** The repos or vibeables block to write; null when the feature is off and nothing else is set. */
function cleanRootBlock(block: "repos" | "vibeables", value: ReposSettingsInput, projectRoot: string): ReposConfig | VibeablesConfig | null {
  if (typeof value !== "object" || value === null) throw new Error(`${block} must be an object`);
  if (typeof value.enabled !== "boolean") throw new Error(`${block}.enabled must be true or false`);
  const out: ReposConfig = {};
  const root = typeof value.root === "string" ? value.root.trim().replace(/\/+$/, "") : "";
  if (root && !ignoreEntryFor(projectRoot, root)) {
    throw new Error(`${block}.root must be a directory inside the project (not ".", ".." or an absolute path outside it)`);
  }
  const dflt = block === "repos" ? REPOS_DEFAULT_ROOT : VIBEABLES_DEFAULT_ROOT;
  if (root && root !== dflt) out.root = root;
  if (value.enabled) return out;
  if (Object.keys(out).length === 0) return null;
  return { enabled: false, ...out };
}

export async function saveSettings(input: SaveSettingsInput): Promise<SettingsView> {
  if (input.name !== undefined && typeof input.name !== "string") throw new Error("name must be a string");
  if (input.icon !== undefined && typeof input.icon !== "string") throw new Error("icon must be a string");
  if (input.color !== undefined) {
    if (typeof input.color !== "string") throw new Error("color must be a string");
    if (input.color.trim() && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(input.color.trim())) {
      throw new Error('color must be a hex colour like "#c2410c"');
    }
  }
  const switcher = input.switcher === undefined ? undefined : cleanSwitcher(input.switcher);

  const project = await resolveProject(getProjectRoot());
  const configPath = project.configPath ?? path.join(project.root, "kraftwerk.yml");
  const raw = project.configPath ? await fs.readFile(configPath, "utf8") : "";
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) throw new Error(`${path.basename(configPath)}: ${doc.errors[0].message}`);

  const setOrDelete = (key: string, value: unknown): void => {
    if (value === undefined) return; // untouched
    if (value === "" || (Array.isArray(value) && value.length === 0)) doc.delete(key);
    else doc.set(key, value);
  };
  setOrDelete("name", input.name?.trim());
  setOrDelete("icon", input.icon?.trim());
  setOrDelete("color", input.color?.trim());
  setOrDelete("switcher", switcher);
  if (input.git !== undefined) {
    const git = cleanGit(input.git);
    if (git === null) doc.delete("git");
    else doc.set("git", git);
  }
  if (input.repos !== undefined) {
    const repos = cleanRootBlock("repos", input.repos, project.root);
    if (repos === null) doc.delete("repos");
    else doc.set("repos", repos);
  }
  if (input.vibeables !== undefined) {
    const vibeables = cleanRootBlock("vibeables", input.vibeables, project.root);
    if (vibeables === null) doc.delete("vibeables");
    else doc.set("vibeables", vibeables);
    // Off, or a different root: running dev servers belong to folders the
    // API can no longer address, so they must not outlive this save.
    const before = project.config.vibeables;
    const rootBefore = before && before.enabled !== false ? before.root ?? VIBEABLES_DEFAULT_ROOT : undefined;
    const rootAfter = vibeables && vibeables.enabled !== false ? vibeables.root ?? VIBEABLES_DEFAULT_ROOT : undefined;
    if (rootBefore !== rootAfter) disposeAllDevs();
  }

  await fs.writeFile(configPath, doc.toString());
  // Turning repositories on prepares the folder so the first clone and the
  // workspace git both find it in the right state.
  if (input.repos?.enabled) await ensureReposRoot().catch(() => {});
  if (input.vibeables?.enabled) await ensureVibeablesRoot().catch(() => {});
  return getSettings();
}
