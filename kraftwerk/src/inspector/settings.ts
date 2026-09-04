import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { resolveProject, type GitConfig, type ProjectConfig, type SwitcherEntry } from "../config.js";
import { getProjectRoot } from "./context.js";

/**
 * Workspace settings: read kraftwerk.yml for the UI and write the
 * UI-editable subset (name, icon, switcher, git) back. Edits go through the
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
  /** Omitted = untouched; empty list = remove the key. */
  switcher?: SwitcherEntry[];
  /** Omitted = untouched. See cleanGit for how the block is written. */
  git?: GitSettingsInput;
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

export async function saveSettings(input: SaveSettingsInput): Promise<SettingsView> {
  if (input.name !== undefined && typeof input.name !== "string") throw new Error("name must be a string");
  if (input.icon !== undefined && typeof input.icon !== "string") throw new Error("icon must be a string");
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
  setOrDelete("switcher", switcher);
  if (input.git !== undefined) {
    const git = cleanGit(input.git);
    if (git === null) doc.delete("git");
    else doc.set("git", git);
  }

  await fs.writeFile(configPath, doc.toString());
  return getSettings();
}
