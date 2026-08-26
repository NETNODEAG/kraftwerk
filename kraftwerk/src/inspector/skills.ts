import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { getProjectRoot } from "./context.js";

/**
 * Skills: reusable instruction packages for chats, discovered from the
 * Claude-style skill layout — one folder per skill holding a SKILL.md with
 * YAML frontmatter (name, description). Two roots are scanned:
 *
 *   <projectRoot>/.claude/skills/<name>/SKILL.md   (git-tracked, per project)
 *   ~/.claude/skills/<name>/SKILL.md               (personal, per user)
 *
 * A project skill shadows a user skill with the same name. Skills are
 * surfaced to every chat as context (and expanded on /<name> invocation),
 * so they work identically on claude, codex, and pi.
 */

export interface SkillInfo {
  /** Frontmatter `name`, falling back to the folder name. */
  name: string;
  description: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Absolute path to the skill folder (for harnesses that take a dir). */
  dir: string;
  source: "project" | "user";
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

/** All discovered skills; a project skill shadows a same-named user skill. */
export async function listSkills(): Promise<SkillInfo[]> {
  const [project, user] = await Promise.all([
    scanRoot(path.join(getProjectRoot(), ".claude", "skills"), "project"),
    scanRoot(path.join(os.homedir(), ".claude", "skills"), "user"),
  ]);
  const seen = new Set(project.map((s) => s.name.toLowerCase()));
  return [...project, ...user.filter((s) => !seen.has(s.name.toLowerCase()))];
}

/** Read a skill's SKILL.md contents (empty string when unreadable). */
export function readSkill(skill: SkillInfo): Promise<string> {
  return fs.readFile(skill.path, "utf8").catch(() => "");
}
