import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { projectsRootFor, resolveProject, type Project } from "../config.js";
import { EFFORTS, HARNESSES, listAgents } from "./agents.js";
import type { ChatAgentId } from "./chat/types.js";
import { getProjectRoot } from "./context.js";
import { knowledgeIndex } from "./knowledge.js";
import { newestMtime } from "./mtime.js";
import { listRepos } from "./repos.js";
import { listVibeables } from "./vibeables.js";
import { listWorkflows } from "./workflows.js";

/**
 * Projects: a goal with everything the agents need to reach it gathered in
 * one folder — the brief, the systems of record where the truth is managed
 * outside kraftwerk, and links to the workspace's knowledge, vibeables,
 * repositories, workflows and agents. Working in a project is chat: a
 * session scoped to it carries all of this as context (sessions.ts).
 *
 * One folder per project under the projects root (`projects.root` in
 * kraftwerk.yml, default kraftwerk-data/projects/). Like agents and
 * knowledge it is part of the workspace: versioned by the workspace git,
 * no repository of its own. The folder is the registry — whatever
 * directory under the root holds a project.yml is a project.
 *
 *   projects/<slug>/project.yml   # title, status, goal, harness/model/effort, records, links (slug lists)
 *   projects/<slug>/brief.md      # the goal in full: what done looks like, constraints, stakeholders
 *   projects/<slug>/state.md      # current state, rewritten at the end of a session
 *   projects/<slug>/log.md        # append-only: decisions, milestones (newest first, stamped)
 *
 * Links are one-directional lists of slugs; a target that does not exist
 * is reported ("configured but not found"), never an error — the same
 * rule agent knowledge follows. A system of record is context, not a
 * credential and not a grant: it says where the truth lives and how it is
 * usually reached, and the harness decides what the agent may call.
 */

export const PROJECT_FILE = "project.yml";
export const PROJECT_STATUSES = ["active", "paused", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Where truth is managed outside kraftwerk: a tool, a folder, a board. */
export interface SystemOfRecord {
  /** my-netnode | google-drive | github | bitbucket | notion | slack | url | anything else (rendered by name). */
  kind: string;
  /** Display name ("Figma board", "Contracts folder"). */
  title?: string;
  url?: string;
  /** For tools with workspaces or boards: the id the agent needs (a my.netnode.ch workspace, a Slack channel). */
  workspace?: string;
  /** What lives there and how it is usually reached ("tickets and roadmap, `my` CLI"). */
  note?: string;
}

/** What kraftwerk knows about a record kind: a label and what such a place usually holds. */
export const RECORD_KINDS: Record<string, { label: string; hint: string }> = {
  "my-netnode": { label: "my.netnode.ch", hint: "tickets, roadmap items, meetings and workspace memory" },
  "google-drive": { label: "Google Drive", hint: "documents and folders" },
  github: { label: "GitHub", hint: "issues, pull requests and discussions" },
  bitbucket: { label: "Bitbucket", hint: "pull requests and pipelines" },
  notion: { label: "Notion", hint: "pages and databases" },
  slack: { label: "Slack", hint: "conversations and decisions" },
  url: { label: "Link", hint: "" },
};

export const LINK_KINDS = ["knowledge", "vibeables", "repos", "workflows", "agents"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface ProjectDef {
  slug: string;
  title: string;
  status: ProjectStatus;
  /** One line: what the project is for. brief.md holds the long form. */
  goal: string;
  /** Harness every chat in the project runs on, like an agent's. Default: claude. */
  harness: ChatAgentId;
  /** Model for that harness; absent = the harness default. */
  model?: string;
  /** Reasoning effort (low … max); absent = the harness default. */
  effort?: string;
  records: SystemOfRecord[];
  /** OKF bundle names. */
  knowledge: string[];
  /** Folder names under the vibeables root. */
  vibeables: string[];
  /** Folder names under the repos root. */
  repos: string[];
  /** Workflow slugs. */
  workflows: string[];
  /** Agent slugs. */
  agents: string[];
}

export interface ProjectSummary extends ProjectDef {
  /** Absolute folder path. */
  path: string;
  /** Newest change inside the folder. */
  updatedAt?: string;
  /** Set when project.yml exists but is unusable; the rest shows defaults. */
  configError?: string;
}

/** One linked slug and whether its target exists right now. */
export interface LinkState {
  slug: string;
  found: boolean;
  /** Display name of the target when found (an agent's name, a workflow's description). */
  label?: string;
}

export type ProjectLinks = Record<LinkKind, LinkState[]>;

export interface ProjectDetail extends ProjectSummary {
  brief: string;
  state: string;
  log: string;
  links: ProjectLinks;
}

export interface ProjectsView {
  enabled: boolean;
  root?: string;
  projects: ProjectSummary[];
  /** Set when the feature is off or the root cannot be read. */
  error?: string;
}

/** Every field optional: omitted = untouched. */
export interface SaveProjectInput {
  title?: string;
  status?: string;
  goal?: string;
  harness?: string;
  model?: string;
  effort?: string;
  records?: unknown;
  knowledge?: unknown;
  vibeables?: unknown;
  repos?: unknown;
  workflows?: unknown;
  agents?: unknown;
  brief?: string;
  state?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;

export function safeProjectSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid project name "${slug}"`);
  return slug;
}

/** Derive a slug from a title: "Relaunch netnode.ch" -> "relaunch-netnode-ch". */
export function projectSlugFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

/* ---------- root ---------- */

export async function openProjects(): Promise<{ project?: Project; root?: string; off?: boolean; error?: string }> {
  let project: Project;
  try {
    project = await resolveProject(getProjectRoot());
  } catch (err) {
    return { error: (err as Error).message };
  }
  const root = projectsRootFor(project);
  if (!root) return { off: true, error: "projects are off (enable them in settings or add `projects:` to kraftwerk.yml)" };
  return { project, root };
}

/** Make sure the root exists; runs when the feature is switched on. */
export async function ensureProjectsRoot(): Promise<void> {
  const opened = await openProjects();
  if (opened.root) await fs.mkdir(opened.root, { recursive: true });
}

async function requireRoot(): Promise<string> {
  const opened = await openProjects();
  if (!opened.root) throw new Error(opened.error ?? "projects are off");
  return opened.root;
}

/* ---------- files ---------- */

const strList = (v: unknown, field: string): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`${field} must be a list of names`);
  return [...new Set(v.map((x) => x.trim()).filter(Boolean))];
};

const cleanRecords = (v: unknown): SystemOfRecord[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error("records must be a list");
  return v.map((r, i) => {
    if (typeof r !== "object" || r === null || Array.isArray(r)) throw new Error(`records[${i}] must be a mapping (kind, title, url, workspace, note)`);
    const o = r as Record<string, unknown>;
    const kind = typeof o.kind === "string" ? o.kind.trim().toLowerCase() : "";
    if (!kind) throw new Error(`records[${i}]: kind is required (e.g. my-netnode, google-drive, url)`);
    const str = (k: string): string | undefined => {
      const x = o[k];
      if (x === undefined || x === null || x === "") return undefined;
      if (typeof x === "number") return String(x);
      if (typeof x !== "string") throw new Error(`records[${i}].${k} must be a string`);
      return x.trim() || undefined;
    };
    const url = str("url");
    if (url && !/^https?:\/\//.test(url)) throw new Error(`records[${i}].url must start with http:// or https://`);
    const out: SystemOfRecord = { kind };
    const title = str("title");
    const workspace = str("workspace");
    const note = str("note");
    if (title) out.title = title;
    if (url) out.url = url;
    if (workspace) out.workspace = workspace;
    if (note) out.note = note;
    return out;
  });
};

const cleanHarness = (v: unknown): ChatAgentId => {
  if (v === undefined || v === null || v === "") return "claude";
  if (typeof v !== "string" || !HARNESSES.includes(v as ChatAgentId)) throw new Error(`harness must be one of ${HARNESSES.join(", ")}`);
  return v as ChatAgentId;
};

const cleanEffort = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !(EFFORTS as readonly string[]).includes(v)) throw new Error(`effort must be one of ${EFFORTS.join(", ")}`);
  return v;
};

const cleanModel = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error("model must be a string");
  return v.trim() || undefined;
};

const cleanStatus = (v: unknown): ProjectStatus => {
  if (v === undefined || v === null || v === "") return "active";
  if (typeof v !== "string" || !(PROJECT_STATUSES as readonly string[]).includes(v)) {
    throw new Error(`status must be one of ${PROJECT_STATUSES.join(", ")}`);
  }
  return v as ProjectStatus;
};

/** Parse project.yml text into a definition; every problem is one error the caller can show. */
function parseDef(slug: string, raw: string): ProjectDef {
  const data = parse(raw);
  if (data === null || data === undefined) return { ...emptyDef(slug) };
  if (typeof data !== "object" || Array.isArray(data)) throw new Error("project.yml must be a mapping");
  const d = data as Record<string, unknown>;
  const title = typeof d.title === "string" && d.title.trim() ? d.title.trim() : slug;
  const goal = typeof d.goal === "string" ? d.goal.trim() : d.goal === undefined || d.goal === null ? "" : String(d.goal);
  const model = cleanModel(d.model);
  const effort = cleanEffort(d.effort);
  return {
    slug,
    title,
    status: cleanStatus(d.status),
    goal,
    harness: cleanHarness(d.harness),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    records: cleanRecords(d.records),
    knowledge: strList(d.knowledge, "knowledge"),
    vibeables: strList(d.vibeables, "vibeables"),
    repos: strList(d.repos, "repos"),
    workflows: strList(d.workflows, "workflows"),
    agents: strList(d.agents, "agents"),
  };
}

const emptyDef = (slug: string): ProjectDef => ({
  slug,
  title: slug,
  status: "active",
  goal: "",
  harness: "claude",
  records: [],
  knowledge: [],
  vibeables: [],
  repos: [],
  workflows: [],
  agents: [],
});

/** project.yml as written: no slug (the folder is the slug), empty lists left out. */
function defToYaml(def: ProjectDef): string {
  const doc: Record<string, unknown> = { title: def.title, status: def.status, goal: def.goal, harness: def.harness };
  if (def.model) doc.model = def.model;
  if (def.effort) doc.effort = def.effort;
  if (def.records.length) doc.records = def.records;
  for (const kind of LINK_KINDS) if (def[kind].length) doc[kind] = def[kind];
  return stringify(doc);
}

const readText = (file: string): Promise<string> => fs.readFile(file, "utf8").catch(() => "");

async function readSummary(root: string, slug: string): Promise<ProjectSummary | null> {
  const dir = path.join(root, slug);
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, PROJECT_FILE), "utf8");
  } catch {
    return null;
  }
  const newest = await newestMtime(dir).catch(() => 0);
  const updatedAt = newest ? new Date(newest).toISOString() : undefined;
  try {
    return { ...parseDef(slug, raw), path: dir, ...(updatedAt ? { updatedAt } : {}) };
  } catch (err) {
    return { ...emptyDef(slug), path: dir, ...(updatedAt ? { updatedAt } : {}), configError: (err as Error).message };
  }
}

/* ---------- reads ---------- */

const STATUS_ORDER: Record<ProjectStatus, number> = { active: 0, paused: 1, done: 2, archived: 3 };

/** Every project under the root: active ones first, then by title. */
export async function listProjects(): Promise<ProjectsView> {
  const opened = await openProjects();
  if (!opened.root) return { enabled: false, projects: [], error: opened.error };
  const root = opened.root;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const slugs = entries.filter((e) => e.isDirectory() && SLUG_RE.test(e.name)).map((e) => e.name);
  const projects = (await Promise.all(slugs.map((s) => readSummary(root, s)))).filter((p): p is ProjectSummary => p != null);
  projects.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.title.localeCompare(b.title));
  return { enabled: true, root, projects };
}

/** Which of the linked slugs exist right now, with a display label for the ones that do. */
export async function resolveLinks(def: ProjectDef): Promise<ProjectLinks> {
  const [knowledge, vibeables, repos, workflows, agents] = await Promise.all([
    knowledgeIndex().catch(() => ({ bundles: [] as Array<{ name: string; concepts: number }> })),
    listVibeables().catch(() => ({ vibeables: [] as Array<{ slug: string; dev?: string }> })),
    listRepos().catch(() => ({ repos: [] as Array<{ slug: string; branch?: string }> })),
    listWorkflows().catch(() => ({ workflows: [] as Array<{ slug: string; name?: string; description?: string }> })),
    listAgents().catch(() => [] as Array<{ slug: string; name: string; emoji: string; archived?: boolean }>),
  ]);
  const state = (slugs: string[], lookup: (s: string) => string | undefined): LinkState[] =>
    slugs.map((slug) => {
      const label = lookup(slug);
      return label === undefined ? { slug, found: false } : { slug, found: true, ...(label ? { label } : {}) };
    });
  return {
    knowledge: state(def.knowledge, (s) => {
      const b = knowledge.bundles.find((x) => x.name === s);
      return b ? `${b.concepts} concepts` : undefined;
    }),
    vibeables: state(def.vibeables, (s) => {
      const v = vibeables.vibeables.find((x) => x.slug === s);
      return v ? (v.dev ? "dev" : "static") : undefined;
    }),
    repos: state(def.repos, (s) => {
      const r = repos.repos.find((x) => x.slug === s);
      return r ? r.branch ?? "" : undefined;
    }),
    workflows: state(def.workflows, (s) => {
      const w = workflows.workflows.find((x) => x.slug === s);
      return w ? w.description ?? w.name ?? "" : undefined;
    }),
    agents: state(def.agents, (s) => {
      const a = agents.find((x) => x.slug === s && !x.archived);
      return a ? `${a.emoji} ${a.name}` : undefined;
    }),
  };
}

/** One project with its files and link states; null when the folder is not a project. */
export async function getProject(slug: string): Promise<ProjectDetail | null> {
  const root = await requireRoot();
  const summary = await readSummary(root, safeProjectSlug(slug));
  if (!summary) return null;
  const [brief, state, log, links] = await Promise.all([
    readText(path.join(summary.path, "brief.md")),
    readText(path.join(summary.path, "state.md")),
    readText(path.join(summary.path, "log.md")),
    resolveLinks(summary),
  ]);
  return { ...summary, brief, state, log, links };
}

/* ---------- writes ---------- */

/** The files a fresh project starts with. */
export function projectStarter(def: ProjectDef): Record<string, string> {
  return {
    [PROJECT_FILE]: defToYaml(def),
    "brief.md": `# ${def.title}\n\n${def.goal ? `${def.goal}\n\n` : ""}## What done looks like\n\n- \n\n## Constraints\n\n- \n\n## Stakeholders\n\n- \n`,
    "state.md": `# Current state\n\nNothing recorded yet.\n`,
    "log.md": `# ${def.title} Log\n`,
  };
}

export async function createProject(input: { title: string; goal?: string; slug?: string; harness?: string; model?: string; effort?: string }): Promise<ProjectDetail> {
  const root = await requireRoot();
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title is required");
  const slug = safeProjectSlug((input.slug ?? "").trim() || projectSlugFromTitle(title) || "project");
  const dir = path.join(root, slug);
  if (await fs.stat(dir).catch(() => null)) throw new Error(`project "${slug}" already exists`);
  const model = cleanModel(input.model);
  const effort = cleanEffort(input.effort);
  const def: ProjectDef = {
    ...emptyDef(slug),
    title,
    goal: (input.goal ?? "").trim(),
    harness: cleanHarness(input.harness),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  };
  await fs.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(projectStarter(def))) {
    await fs.writeFile(path.join(dir, name), content);
  }
  await appendProjectLog(slug, `**Created**: project "${title}".`, "human:user");
  return (await getProject(slug))!;
}

/** Merge the given fields into project.yml (and brief/state when given); lists replace wholesale. */
export async function saveProject(slug: string, input: SaveProjectInput): Promise<ProjectDetail> {
  const current = await getProject(slug);
  if (!current) throw new Error(`no project "${slug}"`);
  const next: ProjectDef = {
    slug: current.slug,
    title: input.title !== undefined ? String(input.title).trim() || current.slug : current.title,
    status: input.status !== undefined ? cleanStatus(input.status) : current.status,
    goal: input.goal !== undefined ? String(input.goal).trim() : current.goal,
    harness: input.harness !== undefined ? cleanHarness(input.harness) : current.harness,
    records: input.records !== undefined ? cleanRecords(input.records) : current.records,
    knowledge: input.knowledge !== undefined ? strList(input.knowledge, "knowledge") : current.knowledge,
    vibeables: input.vibeables !== undefined ? strList(input.vibeables, "vibeables") : current.vibeables,
    repos: input.repos !== undefined ? strList(input.repos, "repos") : current.repos,
    workflows: input.workflows !== undefined ? strList(input.workflows, "workflows") : current.workflows,
    agents: input.agents !== undefined ? strList(input.agents, "agents") : current.agents,
  };
  const model = input.model !== undefined ? cleanModel(input.model) : current.model;
  const effort = input.effort !== undefined ? cleanEffort(input.effort) : current.effort;
  if (model) next.model = model;
  if (effort) next.effort = effort;
  await fs.writeFile(path.join(current.path, PROJECT_FILE), defToYaml(next));
  if (typeof input.brief === "string") await fs.writeFile(path.join(current.path, "brief.md"), input.brief);
  if (typeof input.state === "string") await fs.writeFile(path.join(current.path, "state.md"), input.state);
  return (await getProject(slug))!;
}

/** Add or remove one slug in a link list. */
export async function linkProject(slug: string, kind: string, target: string, remove = false): Promise<ProjectDetail> {
  if (!(LINK_KINDS as readonly string[]).includes(kind)) throw new Error(`link kind must be one of ${LINK_KINDS.join(", ")}`);
  const current = await getProject(slug);
  if (!current) throw new Error(`no project "${slug}"`);
  const k = kind as LinkKind;
  const t = target.trim();
  if (!t) throw new Error("target name is required");
  const list = remove ? current[k].filter((x) => x !== t) : [...new Set([...current[k], t])];
  return saveProject(slug, { [k]: list });
}

/**
 * Prepend an entry under today's heading in log.md (newest first, like a
 * knowledge bundle's log). The actor is stamped so a line written by an
 * agent reads as such next to a human's.
 */
export async function appendProjectLog(slug: string, entry: string, actor: string): Promise<string> {
  const root = await requireRoot();
  const dir = path.join(root, safeProjectSlug(slug));
  if (!(await fs.stat(path.join(dir, PROJECT_FILE)).catch(() => null))) throw new Error(`no project "${slug}"`);
  const text = entry.trim().replace(/\s*\n\s*/g, " ");
  if (!text) throw new Error("entry is required");
  const who = actor.trim() || "human:user";
  const file = path.join(dir, "log.md");
  const today = new Date().toISOString().slice(0, 10);
  let raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) raw = `# ${slug} Log\n`;
  const lines = raw.split("\n");
  const line = `* ${text} (${who})`;
  const todayIdx = lines.findIndex((l) => l.trim() === `## ${today}`);
  if (todayIdx >= 0) {
    lines.splice(todayIdx + 1, 0, line);
  } else {
    const titleIdx = lines.findIndex((l) => l.startsWith("# "));
    lines.splice(titleIdx + 1, 0, "", `## ${today}`, line);
  }
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  await fs.writeFile(file, out);
  return out;
}

/** Remove the folder; its history stays in the workspace git. */
export async function deleteProject(slug: string): Promise<void> {
  const root = await requireRoot();
  const dir = path.join(root, safeProjectSlug(slug));
  if (!(await fs.stat(path.join(dir, PROJECT_FILE)).catch(() => null))) throw new Error(`no project "${slug}"`);
  await fs.rm(dir, { recursive: true, force: true });
}

/* ---------- chat context ---------- */

/** One line per system of record: what it is, where, and what usually lives there. */
export function recordLine(r: SystemOfRecord): string {
  const known = RECORD_KINDS[r.kind];
  const label = known?.label ?? r.kind;
  const head = r.title ? `${label}: ${r.title}` : label;
  const parts = [
    r.workspace ? `workspace ${r.workspace}` : "",
    r.url ?? "",
    known?.hint ?? "",
    r.note ?? "",
  ].filter(Boolean);
  return `- ${head}${parts.length ? ` — ${parts.join("; ")}` : ""}`;
}

/**
 * The "## …" blocks a project chat starts with: brief, state, records,
 * every link with how to reach it, and how to keep the project current.
 * `actor` is stamped on log entries the agent writes.
 */
export async function projectContext(slug: string, actor: string, opts: { member?: boolean } = {}): Promise<string> {
  const p = await getProject(slug).catch(() => null);
  if (!p) {
    return opts.member
      ? `This channel belongs to project "${slug}", but its folder under the projects root is missing (or projects are switched off in this workspace). Tell the humans.`
      : `You were opened for project "${slug}", but its folder under the projects root is missing (or projects are switched off in this workspace). Tell the user and ask how to proceed.`;
  }
  const linkLines = (kind: LinkKind, describe: (l: LinkState) => string): string =>
    p.links[kind].map((l) => (l.found ? describe(l) : `- ${l.slug} (configured but not found in this workspace — tell the user if you need it)`)).join("\n");
  const repos = await listRepos().catch(() => null);
  const reposRoot = repos?.enabled && repos.root ? repos.root : undefined;
  const vibeables = p.vibeables.length > 0;
  const sections = [
    (opts.member
      ? `## Project: ${p.title}\nThis channel works in the project "${p.title}" (status ${p.status}) of this kraftwerk workspace. ` +
        `Goal: ${p.goal || "(no goal written yet)"}\n` +
        `The project folder is ${p.path} (project.yml, brief.md, state.md, log.md); your working directory is the workspace root, ` +
        `so every linked folder below is reachable by path. Keep your role, but work towards this goal with what the project has gathered, and keep its files current.`
      : `You are the assistant of the project "${p.title}" in this kraftwerk workspace. Status: ${p.status}.\n` +
        `Goal: ${p.goal || "(no goal written yet — ask the user what the project is for)"}\n` +
        `The project folder is ${p.path} (project.yml, brief.md, state.md, log.md); your working directory is the workspace root, ` +
        `so every linked folder below is reachable by path. Work towards the goal, use what the project has gathered, and keep its files current.`),
    `## Brief\n${p.brief.trim() || "(no brief yet — ask the user what done looks like and write brief.md together)"}`,
    `## Current state\n${p.state.trim() || "(nothing recorded yet)"}`,
    p.records.length > 0
      ? `## Systems of record\nWhere the truth of this project is managed outside kraftwerk. Reach them through the tools your harness already has ` +
        `(CLIs, MCP servers, the browser); an entry here grants nothing by itself — when a tool is missing, say so instead of guessing at the content.\n` +
        p.records.map(recordLine).join("\n")
      : "",
    p.knowledge.length > 0
      ? `## Knowledge\nOKF bundles linked to this project (markdown + YAML frontmatter under the knowledge root):\n` +
        linkLines("knowledge", (l) => `- ${l.slug}${l.label ? ` (${l.label})` : ""}`) +
        `\nRead with \`npx kraftwerk knowledge list <bundle>\`, \`get <bundle>/<path>\`, \`search <text>\`. ` +
        `Write ONLY through \`npx kraftwerk knowledge put <bundle>/<path> --file <tmp.md> --actor ${actor}\` ` +
        `(stamps provenance, maintains index.md/log.md — never hand-edit those).`
      : "",
    p.repos.length > 0
      ? `## Repositories\nGit clones linked to this project${reposRoot ? `, under ${reposRoot}` : ""}:\n` +
        linkLines("repos", (l) => {
          const r = repos?.repos.find((x) => x.slug === l.slug);
          return `- ${l.slug}${r ? ` — ${r.path}${r.branch ? `, branch ${r.branch}` : ""}${r.dirty ? `, ${r.dirty} uncommitted` : ""}` : ""}`;
        }) +
        (reposRoot
          ? `\nWork inside a clone's folder when the task concerns it: read its README first, keep commits on a branch unless told otherwise, never push or force-push without asking. ` +
            `\`npx kraftwerk repos\` lists every clone, \`repos add <url>\` clones a new one into the root.`
          : `\nRepositories are switched off in this workspace's settings, so these clones are not reachable right now — tell the user.`)
      : "",
    vibeables
      ? `## Vibeables\nSmall apps of this project (one folder each under the vibeables root):\n` +
        linkLines("vibeables", (l) => `- ${l.slug}${l.label ? ` (${l.label})` : ""}`) +
        `\nThe user opens one in the preview pane with the vibeable button; from then on that folder is your working directory and every file you save is what they see next.`
      : "",
    p.workflows.length > 0
      ? `## Workflows\nkraftwerk workflows that belong to this project. When the user's request matches one, run it instead of doing the work by hand:\n` +
        linkLines("workflows", (l) => `- ${l.slug}${l.label ? `: ${l.label}` : ""}`) +
        `\nRun one with:\n  KRAFTWERK_YES=1 npx kraftwerk run <workflow> "<request>"\n` +
        `The command blocks until the run finishes and prints the run id; artifacts land in the output folder. Confirm before a long or expensive run unless the user clearly asked for it.`
      : "",
    p.agents.length > 0
      ? `## Agents\nPersistent agents attached to this project:\n` +
        linkLines("agents", (l) => `- ${l.slug}${l.label ? ` — ${l.label}` : ""}`) +
        `\nThe user talks to them on the Agents screen; you cannot message them yourself. When a request clearly belongs to one of them, say so.`
      : "",
    `## Keeping the project current\n` +
      `- brief.md is the user's: propose changes and write them only when they agree.\n` +
      `- state.md is the project's memory between sessions. At the end of a session that changed something, rewrite it so the next session ` +
      `(yours or a colleague's) can continue without this transcript: what is done, what is open, what was decided.\n` +
      `- log.md is append-only. Record decisions and milestones with\n` +
      `  npx kraftwerk projects log ${p.slug} "<one line>" --actor ${actor}\n` +
      `  (stamps the date and you as the author; never edit log.md by hand).\n` +
      `- Links (knowledge, vibeables, repositories, workflows, agents) live in project.yml: \`npx kraftwerk projects link ${p.slug} <kind> <name>\` adds one, \`unlink\` removes it.`,
  ];
  return sections.filter(Boolean).join("\n\n");
}
