import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { resolveProject, type ProjectConfig, type SwitcherEntry } from "../config.js";
import { getProjectRoot } from "./context.js";

/**
 * Workspace settings: read kraftwerk.yml for the UI and write the
 * UI-editable subset (name, icon, switcher) back. Edits go through the
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
}

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

  await fs.writeFile(configPath, doc.toString());
  return getSettings();
}
