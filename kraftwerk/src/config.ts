import { readFile, stat } from "node:fs/promises";
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
 *   workflows: src/workflows   # workflows root, relative to the file
 *   output: output             # run-artifact directory, relative to the file
 */

/** Stable, versionless URL of the workflow JSON schema (editor validation). */
export const SCHEMA_URL =
  "https://raw.githubusercontent.com/NETNODEAG/kraftwerk/main/kraftwerk/schema/workflow.schema.json";

export const CONFIG_FILENAMES = ["kraftwerk.yml", "kraftwerk.yaml"];

const WORKFLOW_ROOT_CANDIDATES = ["src/workflows", "workflows"];

export interface ProjectConfig {
  /** Workflows root relative to the project root. */
  workflows?: string;
  /** Run-artifact directory relative to the project root. Default: output */
  output?: string;
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
const isDir = async (p: string): Promise<boolean> =>
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

async function loadConfig(configPath: string): Promise<ProjectConfig> {
  let raw: unknown;
  try {
    raw = parse(await readFile(configPath, "utf8"));
  } catch (err) {
    throw new Error(`${path.basename(configPath)}: unreadable YAML: ${(err as Error).message}`);
  }
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path.basename(configPath)}: expected a mapping (workflows, output)`);
  }
  const config = raw as Record<string, unknown>;
  const known = ["workflows", "output"];
  for (const key of Object.keys(config)) {
    if (!known.includes(key)) {
      throw new Error(
        `${path.basename(configPath)}: unknown key "${key}" (allowed: ${known.join(", ")})`
      );
    }
    if (typeof config[key] !== "string") {
      throw new Error(`${path.basename(configPath)}: ${key} must be a string`);
    }
  }
  return config as ProjectConfig;
}
