import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { resolveProject } from "../config.js";
import { getProjectRoot } from "./context.js";
import type { ChatAgentId } from "./chat/types.js";
import { syncProjectAgents } from "./instances.js";

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
   * Skill allowlist (names from .claude/skills, project or user level).
   * Absent = all discovered skills; empty list = no skills.
   */
  skills?: string[];
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
  skills?: unknown;
  archived?: unknown;
}

function normalize(slug: string, raw: AgentYaml): Agent {
  const harness = String(raw.harness ?? "claude") as ChatAgentId;
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
    ...(Array.isArray(raw.skills) ? { skills: raw.skills.map(String) } : {}),
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
    .then((p) => syncProjectAgents(p.root, list.filter((a) => !a.archived).map(toSummary)))
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

  // Profile edits must not silently unarchive: carry the flag over.
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
    ...(input.skills ? { skills: input.skills.map(String) } : {}),
    ...(existing?.archived === true ? { archived: true } : {}),
  };
  await fs.writeFile(path.join(dir, "agent.yml"), stringify(yml));
  await fs.writeFile(path.join(dir, "system.md"), (input.system ?? "").trim() + "\n");
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
  const dir = path.join(await agentsRoot(), safeAgentSlug(slug));
  await fs.rm(dir, { recursive: true, force: true });
}
