import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { resolveProject } from "../config.js";
import { getProjectRoot } from "./context.js";
import {
  normalizeSandbox,
  removeAgentSandbox,
  stopAgentContainer,
  type SandboxProfile,
  type SandboxStart,
} from "../runner/agent-sandbox.js";
import { knowledgeRoot } from "../okf.js";
import { reposRootFor } from "../config.js";
import type { ChatAgentId } from "./chat/types.js";
import { syncWorkspaceAgents } from "./instances.js";

/**
 * Agents: persistent agents, defined on the filesystem. Each one
 * is one folder under the project's agents/ root:
 *
 *   agents/<slug>/agent.yml    # name, emoji, harness, model, effort, workflows
 *   agents/<slug>/system.md    # the agent's system prompt / role description
 *
 * Definitions are git-tracked project config (like workflows/), not run
 * state — sessions with a member are ordinary chats scoped to it.
 */

export const HARNESSES: ChatAgentId[] = ["claude", "codex", "pi"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export interface Agent {
  slug: string;
  name: string;
  emoji: string;
  description?: string;
  harness: ChatAgentId;
  model?: string;
  effort?: string;
  /** Optional group ("Team Content"); absent = ungrouped. */
  group?: string;
  /** Workflow slugs this member knows about and may run. */
  workflows: string[];
  /** Knowledge bundles (OKF) this member works with. */
  knowledge: string[];
  /**
   * Repositories (slugs under `repos.root`) this agent may read. Sandboxed
   * agents get exactly these mounted, read-only: the clone is the control
   * plane's, kept current by kraftwerk, and no deploy key ever enters the
   * container. An unsandboxed agent reaches every clone anyway — the list
   * then only decides what its context mentions.
   */
  repos: string[];
  /**
   * Skill allowlist (names from .claude/skills, project or user level).
   * Absent = all discovered skills; empty list = no skills.
   */
  skills?: string[];
  /**
   * Run this agent's adapter in a Docker sandbox instead of on the host.
   * Absent = host (as before). The block pins the boundary — which files it
   * reaches, whether it has a network, which secrets exist in its
   * environment — not which tools it may call; the harness still decides
   * that. Admin-only: it is not part of SaveAgentInput, so the profile
   * screen cannot widen it. See runner/agent-sandbox.ts.
   */
  sandbox?: SandboxProfile;
  /** Archived: hidden from the active roster, restorable any time. */
  archived?: boolean;
}

/** What the ⌘K palette needs to find and show an agent — kept in the project registry. */
export interface AgentSummary {
  slug: string;
  name: string;
  emoji: string;
  description?: string;
  group?: string;
}

export const toSummary = (a: Agent): AgentSummary => ({
  slug: a.slug,
  name: a.name,
  emoji: a.emoji,
  ...(a.description ? { description: a.description } : {}),
  ...(a.group ? { group: a.group } : {}),
});

export interface AgentDetail extends Agent {
  /** Contents of system.md — the member's system prompt. */
  system: string;
}

export async function agentsRoot(): Promise<string> {
  const project = await resolveProject(getProjectRoot());
  return path.resolve(project.root, project.config.agents ?? "agents");
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;

export function safeAgentSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid agent slug "${slug}"`);
  return slug;
}

/** Derive a slug from a display name: "Max Müller" -> "max-mueller"-ish. */
export function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!SLUG_RE.test(slug)) throw new Error("name must contain at least one letter or digit");
  return slug;
}

interface AgentYaml {
  name?: unknown;
  emoji?: unknown;
  description?: unknown;
  harness?: unknown;
  model?: unknown;
  effort?: unknown;
  group?: unknown;
  workflows?: unknown;
  knowledge?: unknown;
  repos?: unknown;
  skills?: unknown;
  sandbox?: unknown;
  archived?: unknown;
}

function normalize(slug: string, raw: AgentYaml): Agent {
  const harness = String(raw.harness ?? "claude") as ChatAgentId;
  const sandbox = normalizeSandbox(raw.sandbox);
  return {
    slug,
    name: String(raw.name ?? slug),
    emoji: String(raw.emoji ?? "🤖"),
    ...(raw.description ? { description: String(raw.description) } : {}),
    harness: HARNESSES.includes(harness) ? harness : "claude",
    ...(raw.model ? { model: String(raw.model) } : {}),
    ...(raw.effort ? { effort: String(raw.effort) } : {}),
    ...(raw.group ? { group: String(raw.group) } : {}),
    workflows: Array.isArray(raw.workflows) ? raw.workflows.map(String) : [],
    knowledge: Array.isArray(raw.knowledge) ? raw.knowledge.map(String) : [],
    repos: Array.isArray(raw.repos) ? raw.repos.map(String) : [],
    ...(Array.isArray(raw.skills) ? { skills: raw.skills.map(String) } : {}),
    ...(sandbox ? { sandbox } : {}),
    ...(raw.archived === true ? { archived: true } : {}),
  };
}

export async function listAgents(): Promise<Agent[]> {
  const root = await agentsRoot();
  let entries: string[];
  try {
    entries = (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && SLUG_RE.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const agents = await Promise.all(
    entries.map(async (slug) => {
      try {
        const raw = parse(await fs.readFile(path.join(root, slug, "agent.yml"), "utf8"));
        return normalize(slug, (raw ?? {}) as AgentYaml);
      } catch {
        return null;
      }
    })
  );
  const list = (agents.filter(Boolean) as Agent[]).sort((a, b) => a.name.localeCompare(b.name));
  // Keep the registry's copy of the roster current for the other instances'
  // palettes. Awaited so a read that follows a save sees the record updated;
  // it only writes when the roster changed.
  await resolveProject(getProjectRoot())
    .then((p) => syncWorkspaceAgents(p.root, list.filter((a) => !a.archived).map(toSummary)))
    .catch(() => {});
  return list;
}

export async function getAgent(slug: string): Promise<AgentDetail | null> {
  const dir = path.join(await agentsRoot(), safeAgentSlug(slug));
  let raw: unknown;
  try {
    raw = parse(await fs.readFile(path.join(dir, "agent.yml"), "utf8"));
  } catch {
    return null;
  }
  const system = await fs.readFile(path.join(dir, "system.md"), "utf8").catch(() => "");
  return { ...normalize(slug, (raw ?? {}) as AgentYaml), system: system.trim() };
}

/**
 * Everything needed to start this agent's sandbox — resolved in one place so
 * the chat and the CLI produce the *same* container. It is started once and
 * reused, so whoever starts it first fixes its mounts; two callers disagreeing
 * about the grants would mean the agent's reach depends on who got there
 * first. Returns null when the agent is not sandboxed.
 *
 * The workspace is never mounted whole: only kraftwerk.yml, the granted
 * knowledge bundles (writable — agents maintain them), the granted workflows
 * and skills (read-only), and the runs directory. An omitted `skills:` keeps
 * its existing meaning of "all of them".
 */
/**
 * Where a sandboxed agent's attachments are staged for it: one folder per
 * agent, under the output directory, mounted read-only into its container.
 * Per agent and not per workspace, so one agent's customer never reaches
 * another's uploads.
 */
export const uploadsRootFor = (outputDir: string, slug: string): string =>
  path.join(outputDir, "uploads", slug);

export async function sandboxStartFor(slug: string): Promise<SandboxStart | null> {
  const safe = safeAgentSlug(slug);
  const def = await getAgent(safe);
  if (!def?.sandbox?.enabled) return null;
  const project = await resolveProject(getProjectRoot());
  const reposRoot = reposRootFor(project);
  // Docker would create a missing bind source as root; make it ours first.
  await fs.mkdir(uploadsRootFor(project.outputDir, safe), { recursive: true }).catch(() => {});
  return {
    slug: safe,
    projectRoot: project.root,
    outputDir: project.outputDir,
    profile: def.sandbox,
    grants: {
      config: path.join(project.root, "kraftwerk.yml"),
      knowledge: { root: knowledgeRoot(project.root, project.config.knowledge), allow: def.knowledge },
      ...(project.workflowsRoot
        ? { workflows: { root: project.workflowsRoot, allow: def.workflows } }
        : {}),
      ...(reposRoot ? { repos: { root: reposRoot, allow: def.repos } } : {}),
      uploads: { root: uploadsRootFor(project.outputDir, safe) },
      skills: {
        root: path.resolve(project.root, project.config.skills ?? "skills"),
        allow: def.skills ?? null,
      },
    },
  };
}

export interface SaveAgentInput {
  slug?: string;
  name: string;
  emoji?: string;
  description?: string;
  harness: string;
  model?: string;
  effort?: string;
  /** Group name; omitted/empty = ungrouped. */
  group?: string;
  workflows?: string[];
  knowledge?: string[];
  repos?: string[];
  /** Omit for "all skills"; a list (possibly empty) restricts to those names. */
  skills?: string[];
  system?: string;
}

export async function saveAgent(input: SaveAgentInput): Promise<AgentDetail> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  if (!HARNESSES.includes(input.harness as ChatAgentId)) {
    throw new Error(`harness must be one of: ${HARNESSES.join(", ")}`);
  }
  if (input.effort && !EFFORTS.includes(input.effort as (typeof EFFORTS)[number])) {
    throw new Error(`effort must be one of: ${EFFORTS.join(", ")}`);
  }
  const slug = input.slug ? safeAgentSlug(input.slug) : slugFromName(name);
  const dir = path.join(await agentsRoot(), slug);
  await fs.mkdir(dir, { recursive: true });

  // Profile edits must not silently unarchive, and must never touch the
  // sandbox profile: both are admin decisions the profile screen does not
  // own. Carry them over verbatim.
  const existing = await fs
    .readFile(path.join(dir, "agent.yml"), "utf8")
    .then((raw) => (parse(raw) ?? {}) as AgentYaml)
    .catch(() => null);

  const yml: Record<string, unknown> = {
    name,
    emoji: input.emoji?.trim() || "🤖",
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    harness: input.harness,
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.group?.trim() ? { group: input.group.trim() } : {}),
    workflows: (input.workflows ?? []).map(String),
    knowledge: (input.knowledge ?? []).map(String),
    repos: (input.repos ?? []).map(String),
    ...(input.skills ? { skills: input.skills.map(String) } : {}),
    ...(existing?.sandbox !== undefined ? { sandbox: existing.sandbox } : {}),
    ...(existing?.archived === true ? { archived: true } : {}),
  };
  await fs.writeFile(path.join(dir, "agent.yml"), stringify(yml));
  await fs.writeFile(path.join(dir, "system.md"), (input.system ?? "").trim() + "\n");
  // The grants are what a sandbox mounts, and a running container keeps the
  // mounts it started with. Connecting a workflow and then finding the agent
  // cannot see it — until something else happens to restart the container —
  // is the kind of gap nobody debugs, they just conclude the feature is
  // broken. Stop it here; the next message starts it with the new grants.
  if (existing?.sandbox !== undefined && grantsChanged(existing, yml)) {
    await stopAgentContainer(getProjectRoot(), slug).catch(() => {});
  }
  return (await getAgent(slug))!;
}

/** Did this save change anything the sandbox mounts? */
function grantsChanged(before: AgentYaml, after: Record<string, unknown>): boolean {
  const norm = (v: unknown): string => (Array.isArray(v) ? v.map(String).sort().join(",") : v === undefined ? "\u0000" : String(v));
  return (["workflows", "knowledge", "repos", "skills"] as const).some(
    (key) => norm(before[key]) !== norm(after[key])
  );
}

/**
 * Write the agent's `sandbox:` block (or drop it, so the agent runs on the
 * host again). Separate from saveAgent on purpose: the profile form must
 * not be able to touch the boundary as a side effect of a rename, and this
 * one call is the only way the block changes through the API.
 *
 * Every value goes through normalizeSandbox, which is also what the docker
 * arguments are built from — a field that does not fit its shape falls back
 * to the default rather than reaching the command line.
 *
 * The running container keeps the profile it was started with, so the
 * caller stops it; the next message starts a fresh one under the new rules.
 */
export async function saveAgentSandbox(slug: string, raw: unknown): Promise<AgentDetail> {
  const dir = path.join(await agentsRoot(), safeAgentSlug(slug));
  let current: AgentYaml;
  try {
    current = (parse(await fs.readFile(path.join(dir, "agent.yml"), "utf8")) ?? {}) as AgentYaml;
  } catch {
    throw new Error("agent not found");
  }
  const yml = { ...current } as Record<string, unknown>;
  const profile = normalizeSandbox(raw);
  if (!profile) delete yml.sandbox;
  else yml.sandbox = profile;
  await fs.writeFile(path.join(dir, "agent.yml"), stringify(yml));
  // Stop, not remove: the home volume holds the agent's harness login, and
  // losing it on every edit to a memory limit would be absurd. Best effort —
  // a Docker that is not running must not block the edit.
  await stopAgentContainer(getProjectRoot(), safeAgentSlug(slug)).catch(() => {});
  return (await getAgent(slug))!;
}

/** Archive/unarchive a member: toggles `archived:` in agent.yml, nothing else. */
export async function setAgentArchived(slug: string, archived: boolean): Promise<AgentDetail> {
  const dir = path.join(await agentsRoot(), safeAgentSlug(slug));
  let raw: AgentYaml;
  try {
    raw = (parse(await fs.readFile(path.join(dir, "agent.yml"), "utf8")) ?? {}) as AgentYaml;
  } catch {
    throw new Error("agent not found");
  }
  const yml = { ...raw } as Record<string, unknown>;
  if (archived) yml.archived = true;
  else delete yml.archived;
  await fs.writeFile(path.join(dir, "agent.yml"), stringify(yml));
  return (await getAgent(slug))!;
}

export async function deleteAgent(slug: string): Promise<void> {
  const safe = safeAgentSlug(slug);
  const dir = path.join(await agentsRoot(), safe);
  // A sandboxed agent owns a container and a home volume holding its
  // logins. Both go with the definition — best effort, because a missing
  // Docker must not block deleting the agent.
  const sandboxed = (await getAgent(safe).catch(() => null))?.sandbox;
  if (sandboxed) await removeAgentSandbox(getProjectRoot(), safe).catch(() => {});
  await fs.rm(dir, { recursive: true, force: true });
  // Files people handed this agent go with it; nothing would name them again.
  const project = await resolveProject(getProjectRoot()).catch(() => null);
  if (project) await fs.rm(uploadsRootFor(project.outputDir, safe), { recursive: true, force: true }).catch(() => {});
}
