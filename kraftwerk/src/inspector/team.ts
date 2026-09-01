import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { resolveProject } from "../config.js";
import { getProjectRoot } from "./context.js";
import type { ChatAgentId } from "./chat/types.js";

/**
 * Team: persistent agent teammates, defined on the filesystem. Each member
 * is one folder under the project's agents/ root:
 *
 *   agents/<slug>/agent.yml    # name, emoji, harness, model, effort, workflows
 *   agents/<slug>/system.md    # the member's system prompt / role description
 *
 * Definitions are git-tracked project config (like workflows/), not run
 * state — sessions with a member are ordinary chats scoped to it.
 */

export const HARNESSES: ChatAgentId[] = ["claude", "codex", "pi"];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export interface TeamMember {
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
}

export interface TeamMemberDetail extends TeamMember {
  /** Contents of system.md — the member's system prompt. */
  system: string;
}

export async function teamRoot(): Promise<string> {
  const project = await resolveProject(getProjectRoot());
  return path.resolve(project.root, project.config.agents ?? "agents");
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;

export function safeMemberSlug(slug: string): string {
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

interface MemberYaml {
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
}

function normalize(slug: string, raw: MemberYaml): TeamMember {
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
  };
}

export async function listMembers(): Promise<TeamMember[]> {
  const root = await teamRoot();
  let entries: string[];
  try {
    entries = (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && SLUG_RE.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const members = await Promise.all(
    entries.map(async (slug) => {
      try {
        const raw = parse(await fs.readFile(path.join(root, slug, "agent.yml"), "utf8"));
        return normalize(slug, (raw ?? {}) as MemberYaml);
      } catch {
        return null;
      }
    })
  );
  return (members.filter(Boolean) as TeamMember[]).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getMember(slug: string): Promise<TeamMemberDetail | null> {
  const dir = path.join(await teamRoot(), safeMemberSlug(slug));
  let raw: unknown;
  try {
    raw = parse(await fs.readFile(path.join(dir, "agent.yml"), "utf8"));
  } catch {
    return null;
  }
  const system = await fs.readFile(path.join(dir, "system.md"), "utf8").catch(() => "");
  return { ...normalize(slug, (raw ?? {}) as MemberYaml), system: system.trim() };
}

export interface SaveMemberInput {
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

export async function saveMember(input: SaveMemberInput): Promise<TeamMemberDetail> {
  const name = input.name?.trim();
  if (!name) throw new Error("name is required");
  if (!HARNESSES.includes(input.harness as ChatAgentId)) {
    throw new Error(`harness must be one of: ${HARNESSES.join(", ")}`);
  }
  if (input.effort && !EFFORTS.includes(input.effort as (typeof EFFORTS)[number])) {
    throw new Error(`effort must be one of: ${EFFORTS.join(", ")}`);
  }
  const slug = input.slug ? safeMemberSlug(input.slug) : slugFromName(name);
  const dir = path.join(await teamRoot(), slug);
  await fs.mkdir(dir, { recursive: true });

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
  };
  await fs.writeFile(path.join(dir, "agent.yml"), stringify(yml));
  await fs.writeFile(path.join(dir, "system.md"), (input.system ?? "").trim() + "\n");
  return (await getMember(slug))!;
}

export async function deleteMember(slug: string): Promise<void> {
  const dir = path.join(await teamRoot(), safeMemberSlug(slug));
  await fs.rm(dir, { recursive: true, force: true });
}
