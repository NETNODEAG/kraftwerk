import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { resolveProject } from "../config.js";
import { getProjectRoot } from "./context.js";

/**
 * Skills: reusable instruction packages for chats, discovered from the
 * Claude-style skill layout — one folder per skill holding a SKILL.md with
 * YAML frontmatter (name, description). Three roots are scanned:
 *
 *   <projectRoot>/<skills root>/<name>/SKILL.md    (workspace, git-tracked;
 *                                                   kraftwerk.yml `skills`, default skills/)
 *   <projectRoot>/.claude/skills/<name>/SKILL.md   (project .claude, git-tracked)
 *   ~/.claude/skills/<name>/SKILL.md               (global, this machine only)
 *
 * Workspace skills are the shared, first-class ones; a workspace skill
 * shadows a same-named project skill, which shadows a same-named global
 * skill. Skills are surfaced to every chat as context (and expanded on
 * /<name> invocation), so they work identically on claude, codex, and pi.
 */

export interface SkillInfo {
  /** Frontmatter `name`, falling back to the folder name. */
  name: string;
  description: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Absolute path to the skill folder (for harnesses that take a dir). */
  dir: string;
  /** workspace = kraftwerk skills root; project = .claude/skills; user = ~/.claude/skills. */
  source: "workspace" | "project" | "user";
}

export interface SkillDetail extends SkillInfo {
  /** Full SKILL.md contents. */
  content: string;
  /** Non-SKILL.md files bundled in the skill folder (relative paths). */
  files: string[];
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function frontmatter(md: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(md);
  if (!m) return {};
  try {
    const parsed = parse(m[1]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Absolute workspace skills root (kraftwerk.yml `skills`, default skills/). */
export async function skillsRoot(): Promise<string> {
  const project = await resolveProject(getProjectRoot()).catch(() => null);
  const root = project?.root ?? getProjectRoot();
  return path.resolve(root, project?.config.skills ?? "skills");
}

async function scanRoot(root: string, source: SkillInfo["source"]): Promise<SkillInfo[]> {
  let entries: string[];
  try {
    entries = (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const skills = await Promise.all(
    entries.map(async (dirName): Promise<SkillInfo | null> => {
      const dir = path.join(root, dirName);
      const file = path.join(dir, "SKILL.md");
      let md: string;
      try {
        md = await fs.readFile(file, "utf8");
      } catch {
        return null;
      }
      const fm = frontmatter(md);
      const name = String(fm.name ?? dirName).trim() || dirName;
      if (!NAME_RE.test(name)) return null;
      return {
        name,
        description: String(fm.description ?? "").trim(),
        path: file,
        dir,
        source,
      };
    })
  );
  return (skills.filter(Boolean) as SkillInfo[]).sort((a, b) => a.name.localeCompare(b.name));
}

/** All discovered skills; workspace shadows project shadows user (global). */
export async function listSkills(): Promise<SkillInfo[]> {
  const [workspace, project, user] = await Promise.all([
    skillsRoot().then((root) => scanRoot(root, "workspace")),
    scanRoot(path.join(getProjectRoot(), ".claude", "skills"), "project"),
    scanRoot(path.join(os.homedir(), ".claude", "skills"), "user"),
  ]);
  const out = [...workspace];
  const seen = new Set(out.map((s) => s.name.toLowerCase()));
  for (const s of [...project, ...user]) {
    if (seen.has(s.name.toLowerCase())) continue;
    seen.add(s.name.toLowerCase());
    out.push(s);
  }
  return out;
}

/** Read a skill's SKILL.md contents (empty string when unreadable). */
export function readSkill(skill: SkillInfo): Promise<string> {
  return fs.readFile(skill.path, "utf8").catch(() => "");
}

/** One skill by name (post-shadowing), with SKILL.md content + bundled files. */
export async function getSkill(name: string): Promise<SkillDetail | null> {
  const skill = (await listSkills()).find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!skill) return null;
  const content = await readSkill(skill);
  const files: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) await walk(path.join(dir, e.name), `${rel}${e.name}/`);
      else if (`${rel}${e.name}` !== "SKILL.md") files.push(`${rel}${e.name}`);
    }
  };
  await walk(skill.dir, "");
  return { ...skill, content, files: files.sort() };
}
