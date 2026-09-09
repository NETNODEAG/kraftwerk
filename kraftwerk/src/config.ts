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
 *   color: "#c2410c"           # accent for this workspace in the switcher (default: derived from the root)
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
 *   vibeables:                 # small apps built live in a chat, rendered in the inspector (absent = off, bare key = on)
  *     root: apps               # one folder per app, part of the workspace. Default: kraftwerk-data/vibeables
 *   projects:                  # goal-scoped folders (brief, systems of record, links) that chats work in (absent = off, bare key = on)
 *     root: kraftwerk-data/projects   # one folder per project, part of the workspace. Default: kraftwerk-data/projects
 *   public: https://kw.example.com   # hostname the inspector is reached at through a tunnel or reverse proxy
 *   tunnel:                    # Cloudflare Tunnel run by `kraftwerk ui` (absent = off, bare key = on)
 *     name: kraftwerk          # locally-managed tunnel (cloudflared tunnel create); absent: TUNNEL_TOKEN env, dashboard-managed
 *     access:                  # verify the Cloudflare Access login on every request that arrives via `public`
 *       team: acme             # Zero Trust team name (https://<team>.cloudflareaccess.com)
 *       aud: 4714c135…         # Application Audience tag of the Access application
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
 * skills), channels/, README.md and kraftwerk.yml itself. Commit and push stay manual; the
 * interval only fetches, and pulls when `autosync` allows it.
 */
/**
 * A remote or branch name kraftwerk will hand to git as a positional
 * argument. Git reads a leading dash as an option ("--upload-pack=<cmd>"
 * runs a command), so such values are refused wherever they enter — config
 * load, settings API — and the git calls add --end-of-options as well.
 */
export function isSafeGitName(value: string): boolean {
  return value.length > 0 && !value.startsWith("-") && !/[\s\x00-\x1f]/.test(value);
}

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

/**
 * Vibeables: small applications the user builds live with an agent — a chat
 * with a preview pane. Each is one folder under the root, plain files the
 * inspector serves (or a dev command it runs). The root is part of the
 * workspace and synced by the workspace git like agents and knowledge.
 */
export interface VibeablesConfig {
  /** false keeps the block but turns the feature off. Default: true. */
  enabled?: boolean;
  /** Where the apps live, relative to the project root. Default: kraftwerk-data/vibeables */
  root?: string;
}

/** Where vibeables live when `vibeables.root` is not set. */
export const VIBEABLES_DEFAULT_ROOT = "kraftwerk-data/vibeables";

/** Absolute vibeables root when the feature is on, undefined otherwise. */
export function vibeablesRootFor(project: Project): string | undefined {
  const v = project.config.vibeables;
  if (!v || v.enabled === false) return undefined;
  return path.resolve(project.root, v.root ?? VIBEABLES_DEFAULT_ROOT);
}

/**
 * Projects: a goal with everything the agents need to reach it in one
 * folder — a brief, the systems of record where the truth lives, and links
 * to the workspace's knowledge, vibeables, repositories, workflows and
 * agents. Each is one folder under the root; part of the workspace and
 * synced by the workspace git like agents and knowledge.
 */
export interface ProjectsConfig {
  /** false keeps the block but turns the feature off. Default: true. */
  enabled?: boolean;
  /** Where the projects live, relative to the project root. Default: kraftwerk-data/projects */
  root?: string;
}

/** Where projects live when `projects.root` is not set. */
export const PROJECTS_DEFAULT_ROOT = "kraftwerk-data/projects";

/** Absolute projects root when the feature is on, undefined otherwise. */
export function projectsRootFor(project: Project): string | undefined {
  const p = project.config.projects;
  if (!p || p.enabled === false) return undefined;
  return path.resolve(project.root, p.root ?? PROJECTS_DEFAULT_ROOT);
}

/**
 * Cloudflare Access in front of the public hostname. Access puts a login
 * page on the hostname at Cloudflare's edge and hands the origin a signed
 * JWT per request (Cf-Access-Jwt-Assertion). With this block the inspector
 * verifies that token itself, so a removed or misconfigured Access policy
 * fails closed instead of exposing the UI, which has no login of its own.
 */
export interface AccessConfig {
  /** Zero Trust team name: the subdomain of https://<team>.cloudflareaccess.com */
  team: string;
  /** Application Audience (AUD) tag of the Access application, from its overview page. */
  aud: string;
}

/**
 * Cloudflare Tunnel: `kraftwerk ui` runs cloudflared next to the inspector
 * so the loopback bind is reachable at `public` without an open port. The
 * tunnel itself is created once with cloudflared (or in the Zero Trust
 * dashboard); this block only says which one to run.
 */
export interface TunnelConfig {
  /** false keeps the block but turns the feature off. Default: true. */
  enabled?: boolean;
  /**
   * Name of a locally-managed tunnel (`cloudflared tunnel create <name>`,
   * `cloudflared tunnel route dns <name> <public host>`); cloudflared routes
   * everything to the inspector port. Absent: a dashboard-managed tunnel,
   * whose token comes from the TUNNEL_TOKEN environment variable and whose
   * route to http://localhost:<port> is configured in the dashboard.
   */
  name?: string;
  /** Verify the Cloudflare Access token on every request that arrives via `public`. */
  access?: AccessConfig;
}

/** The public hostname (lowercase, no port) when `public` is set, undefined otherwise. */
export function publicHostFor(project: Project): string | undefined {
  return project.config.public ? parsePublic(project.config.public)?.hostname : undefined;
}

/** The public origin ("https://kw.example.com") when `public` is set, undefined otherwise. */
export function publicUrlFor(project: Project): string | undefined {
  return project.config.public ? parsePublic(project.config.public)?.origin : undefined;
}

/** The tunnel block when the feature is on, undefined otherwise. */
export function tunnelFor(project: Project): TunnelConfig | undefined {
  const t = project.config.tunnel;
  if (!t || t.enabled === false) return undefined;
  return t;
}

/** "kw.example.com" or "https://kw.example.com[:port]" → its URL; undefined when it is neither. */
export function parsePublic(value: string): URL | undefined {
  const text = value.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!url.hostname || url.pathname !== "/" || url.search || url.hash || url.username) return undefined;
    return url;
  } catch {
    return undefined;
  }
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
  /** Accent colour (#rgb / #rrggbb) for this workspace in the switcher. Default: derived from the root path. */
  color?: string;
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
  /** Vibeables: apps built live in a chat. Absent = off. */
  vibeables?: VibeablesConfig;
  /** Projects: goal-scoped folders the chats work in. Absent = off. */
  projects?: ProjectsConfig;
  /**
   * Hostname the inspector is reached at through a tunnel or reverse proxy,
   * e.g. "https://kw.example.com". The loopback bind then answers requests
   * carrying that Host even without X-Forwarded-Host (cloudflared sends none).
   */
  public?: string;
  /** Cloudflare Tunnel run alongside the inspector. Absent = off. */
  tunnel?: TunnelConfig;
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

const KNOWN_KEYS = ["name", "icon", "color", "port", "workflows", "output", "knowledge", "agents", "skills", "switcher", "git", "repos", "vibeables", "projects", "public", "tunnel"];

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
    } else if (key === "color") {
      if (typeof config[key] !== "string" || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(config[key] as string)) {
        throw new Error(`${path.basename(configPath)}: color must be a hex colour like "#c2410c"`);
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
      validateRootBlock(configPath, "repos", config[key]);
    } else if (key === "vibeables") {
      if (config[key] === null) config[key] = {};
      validateRootBlock(configPath, "vibeables", config[key]);
    } else if (key === "projects") {
      if (config[key] === null) config[key] = {};
      validateRootBlock(configPath, "projects", config[key]);
    } else if (key === "public") {
      if (typeof config[key] !== "string" || !parsePublic(config[key] as string)) {
        throw new Error(`${path.basename(configPath)}: public must be a hostname or https URL like "https://kw.example.com"`);
      }
    } else if (key === "tunnel") {
      if (config[key] === null) config[key] = {};
      validateTunnel(configPath, config[key]);
    } else if (typeof config[key] !== "string") {
      throw new Error(`${path.basename(configPath)}: ${key} must be a string`);
    }
  }
  const tunnel = config.tunnel as TunnelConfig | undefined;
  if (tunnel && tunnel.enabled !== false && !config.public) {
    throw new Error(`${path.basename(configPath)}: tunnel needs public: the hostname the tunnel routes to`);
  }
  return config as ProjectConfig;
}

/** tunnel: { enabled?, name?, access?: { team, aud } } */
function validateTunnel(configPath: string, value: unknown): void {
  const file = path.basename(configPath);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file}: tunnel must be a mapping (enabled, name, access)`);
  }
  const t = value as Record<string, unknown>;
  for (const key of Object.keys(t)) {
    if (!["enabled", "name", "access"].includes(key)) {
      throw new Error(`${file}: tunnel.${key} is unknown (allowed: enabled, name, access)`);
    }
  }
  if (t.enabled !== undefined && typeof t.enabled !== "boolean") {
    throw new Error(`${file}: tunnel.enabled must be true or false`);
  }
  // The name is handed to cloudflared as a positional argument.
  if (t.name !== undefined && (typeof t.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(t.name))) {
    throw new Error(`${file}: tunnel.name must be a plain tunnel name (letters, digits, ".", "_", "-")`);
  }
  if (t.access !== undefined) {
    if (typeof t.access !== "object" || t.access === null || Array.isArray(t.access)) {
      throw new Error(`${file}: tunnel.access must be a mapping (team, aud)`);
    }
    const a = t.access as Record<string, unknown>;
    for (const key of Object.keys(a)) {
      if (!["team", "aud"].includes(key)) {
        throw new Error(`${file}: tunnel.access.${key} is unknown (allowed: team, aud)`);
      }
    }
    // The team becomes a hostname (<team>.cloudflareaccess.com).
    if (typeof a.team !== "string" || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(a.team)) {
      throw new Error(`${file}: tunnel.access.team must be the Zero Trust team name (the subdomain of cloudflareaccess.com)`);
    }
    if (typeof a.aud !== "string" || !/^[a-f0-9]{64}$/i.test(a.aud)) {
      throw new Error(`${file}: tunnel.access.aud must be the 64-character Application Audience tag`);
    }
  }
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
    if (typeof g[key] === "string" && !isSafeGitName((g[key] as string).trim())) {
      throw new Error(`${file}: git.${key} must be a plain name (no leading "-", no whitespace)`);
    }
  }
  if (g.interval !== undefined && (typeof g.interval !== "number" || !Number.isInteger(g.interval) || g.interval < 0)) {
    throw new Error(`${file}: git.interval must be a whole number of seconds (0 disables the timer)`);
  }
  if (g.autosync !== undefined && g.autosync !== "off" && g.autosync !== "pull") {
    throw new Error(`${file}: git.autosync must be "off" or "pull"`);
  }
}

/**
 * `repos`, `vibeables` and `projects` share one shape: { enabled?, root? }. The root
 * must never be the project itself or anything outside it — it is what
 * remove/delete operate under, and what the workspace git may stage.
 */
function validateRootBlock(configPath: string, block: "repos" | "vibeables" | "projects", value: unknown): void {
  const file = path.basename(configPath);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file}: ${block} must be a mapping (enabled, root)`);
  }
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!["enabled", "root"].includes(key)) {
      throw new Error(`${file}: ${block}.${key} is unknown (allowed: enabled, root)`);
    }
  }
  if (r.enabled !== undefined && typeof r.enabled !== "boolean") {
    throw new Error(`${file}: ${block}.enabled must be true or false`);
  }
  if (r.root !== undefined && (typeof r.root !== "string" || !r.root.trim())) {
    throw new Error(`${file}: ${block}.root must be a non-empty string`);
  }
  if (typeof r.root === "string" && !ignoreEntryFor(path.dirname(configPath), r.root.trim())) {
    throw new Error(`${file}: ${block}.root must be a directory inside the project (not ".", ".." or an absolute path outside it)`);
  }
}
