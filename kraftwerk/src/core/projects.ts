import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { projectsRootFor, resolveWorkspace, type ResolvedWorkspace } from "../config.js";
import { EFFORTS, HARNESSES } from "./agents.js";
import type { ChatAgentId } from "./chat/types.js";
import { workspaceRoot } from "./context.js";
import { CONTACTS, entityLine, EVENTS, listEntities, PLACES, type EntityBase, type EntityKindDef } from "./entities.js";
import { syncWorkspaceProjects } from "./instances.js";
import { newestMtime } from "./mtime.js";
import { cleanRecords, RECORD_KINDS, recordLine, type SystemOfRecord } from "./records.js";
import { resolveRefs, type LinkState } from "./refs.js";
import { listRepos } from "./repos.js";
import { SLUG_RE, slugify } from "./slug.js";
import { moveToTrash } from "./trash.js";
import { filesContext } from "./files.js";

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
 * Links are one-directional lists of slugs, resolved through the reference
 * registry (refs.ts); a target that does not exist is reported
 * ("configured but not found"), never an error — the same rule agent
 * knowledge follows. A system of record (records.ts) is context, not a
 * credential and not a grant: it says where the truth lives and how it is
 * usually reached, and the harness decides what the agent may call.
 */

export const PROJECT_FILE = "project.yml";
export const PROJECT_STATUSES = ["active", "paused", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export { RECORD_KINDS, recordLine, type SystemOfRecord };
export type { LinkState };

/** What a project links to, in the order project.yml and the UI list them; each is a kind of the reference registry. */
export const LINK_KINDS = ["knowledge", "vibeables", "repos", "workflows", "agents", "contacts", "places", "events"] as const;
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
  /** Contact slugs (contact:<slug>). */
  contacts: string[];
  /** Place slugs. */
  places: string[];
  /** Event slugs. */
  events: string[];
}

/** What the ⌘K palette needs of a project: also the shape kept in the workspace registry. */
export interface ProjectHit {
  slug: string;
  title: string;
  status: ProjectStatus;
  goal?: string;
}

export const toProjectHit = (p: ProjectDef): ProjectHit => ({
  slug: p.slug,
  title: p.title,
  status: p.status,
  ...(p.goal ? { goal: p.goal } : {}),
});

export interface ProjectSummary extends ProjectDef {
  /** Absolute folder path. */
  path: string;
  /** Newest change inside the folder. */
  updatedAt?: string;
  /** Set when project.yml exists but is unusable; the rest shows defaults. */
  configError?: string;
}

export type ProjectLinks = Record<LinkKind, LinkState[]>;

export interface ProjectDetail extends ProjectSummary {
  brief: string;
  state: string;
  log: string;
  links: ProjectLinks;
}

/**
 * The sidebar's order of the projects, with named sections (ORDER_FILE in the
 * projects root, versioned with the workspace). Normalised on every read:
 * each project appears exactly once, gone ones are dropped, and a project
 * nobody placed yet joins the end of `top`.
 */
export interface ProjectLayout {
  /** Projects above every section, in order. */
  top: string[];
  sections: { name: string; projects: string[] }[];
}

export interface ProjectsView {
  enabled: boolean;
  root?: string;
  projects: ProjectSummary[];
  layout: ProjectLayout;
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
  contacts?: unknown;
  places?: unknown;
  events?: unknown;
  brief?: string;
  state?: string;
}

export function safeProjectSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid project name "${slug}"`);
  return slug;
}

/** Derive a slug from a title: "Relaunch netnode.ch" -> "relaunch-netnode-ch". */
export const projectSlugFromTitle = (title: string): string => slugify(title);

/* ---------- root ---------- */

export async function openProjects(): Promise<{ project?: ResolvedWorkspace; root?: string; off?: boolean; error?: string }> {
  let project: ResolvedWorkspace;
  try {
    project = await resolveWorkspace(workspaceRoot());
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
    ...linkLists((kind) => strList(d[kind], kind)),
  };
}

/** The link lists of a definition, one per LINK_KIND, from a function that gives each. */
const linkLists = (of: (kind: LinkKind) => string[]): Record<LinkKind, string[]> =>
  Object.fromEntries(LINK_KINDS.map((kind) => [kind, of(kind)])) as Record<LinkKind, string[]>;

const emptyDef = (slug: string): ProjectDef => ({
  slug,
  title: slug,
  status: "active",
  goal: "",
  harness: "claude",
  records: [],
  ...linkLists(() => []),
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
  if (!opened.root) return { enabled: false, projects: [], layout: { top: [], sections: [] }, error: opened.error };
  const root = opened.root;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const slugs = entries.filter((e) => e.isDirectory() && SLUG_RE.test(e.name)).map((e) => e.name);
  const projects = (await Promise.all(slugs.map((s) => readSummary(root, s)))).filter((p): p is ProjectSummary => p != null);
  projects.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.title.localeCompare(b.title));
  // Like the agent roster: the registry copy feeds other instances' palettes. Archived projects stay out.
  await syncWorkspaceProjects(opened.project!.root, projects.filter((p) => p.status !== "archived").map(toProjectHit)).catch(() => {});
  const layout = normaliseLayout(await readLayout(root), projects.map((p) => p.slug));
  return { enabled: true, root, projects, layout };
}

/* ---------- the sidebar's order ---------- */

const ORDER_FILE = "order.yml";
const SECTION_NAME_MAX = 60;

async function readLayout(root: string): Promise<unknown> {
  const raw = await fs.readFile(path.join(root, ORDER_FILE), "utf8").catch(() => "");
  try {
    return parse(raw) ?? {};
  } catch {
    return {}; // a broken file falls back to the default order rather than hiding the projects
  }
}

/** Any input -> a layout over exactly `slugs` (in their default order for the unplaced ones). */
function normaliseLayout(input: unknown, slugs: string[]): ProjectLayout {
  const exists = new Set(slugs);
  const seen = new Set<string>();
  const take = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).filter((s): s is string => typeof s === "string" && exists.has(s) && !seen.has(s) && !!seen.add(s));
  const o = (input && typeof input === "object" ? input : {}) as { projects?: unknown; sections?: unknown };
  const top = take(o.projects);
  const names = new Set<string>();
  const sections: ProjectLayout["sections"] = [];
  for (const raw of Array.isArray(o.sections) ? o.sections : []) {
    const s = (raw && typeof raw === "object" ? raw : {}) as { name?: unknown; projects?: unknown };
    const name = typeof s.name === "string" ? s.name.trim().slice(0, SECTION_NAME_MAX) : "";
    if (!name || names.has(name)) continue;
    names.add(name);
    sections.push({ name, projects: take(s.projects) });
  }
  top.push(...slugs.filter((s) => !seen.has(s)));
  return { top, sections };
}

/** Save the sidebar's order (PUT /api/projects); section names must be unique and non-empty. */
export async function saveLayout(input: unknown): Promise<ProjectLayout> {
  const root = await requireRoot();
  const l = (input && typeof input === "object" ? input : {}) as Partial<ProjectLayout>;
  const names = (Array.isArray(l.sections) ? l.sections : []).map((s) => (typeof s?.name === "string" ? s.name.trim() : ""));
  if (names.some((n) => !n)) throw new Error("a section needs a name");
  if (names.some((n) => n.length > SECTION_NAME_MAX)) throw new Error(`a section name has at most ${SECTION_NAME_MAX} characters`);
  if (new Set(names).size !== names.length) throw new Error("two sections share a name");
  const view = await listProjects();
  const layout = normaliseLayout({ projects: l.top, sections: l.sections }, view.projects.map((p) => p.slug));
  const doc = { projects: layout.top, sections: layout.sections.map((s) => ({ name: s.name, projects: s.projects })) };
  await fs.writeFile(path.join(root, ORDER_FILE), `# The order of the projects in the sidebar, with its sections. Drag them there.\n${stringify(doc)}`);
  return layout;
}

/** Which of the linked slugs exist right now, with a display label for the ones that do (the reference registry decides). */
export const resolveLinks = (def: ProjectDef): Promise<ProjectLinks> => resolveRefs(linkLists((kind) => def[kind]));

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
    ...linkLists((kind) => (input[kind] !== undefined ? strList(input[kind], kind) : current[kind])),
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

/** Move the folder to the trash. */
export async function deleteProject(slug: string): Promise<void> {
  const root = await requireRoot();
  const dir = path.join(root, safeProjectSlug(slug));
  if (!(await fs.stat(path.join(dir, PROJECT_FILE)).catch(() => null))) throw new Error(`no project "${slug}"`);
  await moveToTrash("projects", slug, dir);
}

/* ---------- chat context ---------- */

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
  // Who, where and when: the linked entries as one-liners, each with its reference token.
  const entityBlock = async (def: EntityKindDef<any>, slugs: string[], heading: string, intro: string): Promise<string> => {
    if (slugs.length === 0) return "";
    const view = await listEntities(def).catch(() => ({ items: [] as EntityBase[] }));
    const lines = slugs.map((slug) => {
      const item = view.items.find((x) => x.slug === slug);
      return item ? entityLine(def, item) : `- ${def.singular}:${slug} (configured but not found in this workspace — tell the user if you need it)`;
    });
    return `## ${heading}\n${intro}\n${lines.join("\n")}\n\`npx kraftwerk ${def.kind} show <slug> --json\` has the full entry and notes.`;
  };
  const [contactsBlock, placesBlock, eventsBlock] = await Promise.all([
    entityBlock(CONTACTS, p.contacts, "Contacts", "People and organisations of this project (reference one as contact:<slug>):"),
    entityBlock(PLACES, p.places, "Places", "Where this project happens (reference one as place:<slug>):"),
    entityBlock(EVENTS, p.events, "Events", "Dates of this project (reference one as event:<slug>):"),
  ]);
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
    await filesContext(`project:${p.slug}`, "Files", "The project's files (briefings, drafts, designs, deliverables) are in"),
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
    contactsBlock,
    placesBlock,
    eventsBlock,
    `## Keeping the project current\n` +
      `- brief.md is the user's: propose changes and write them only when they agree.\n` +
      `- state.md is the project's memory between sessions. At the end of a session that changed something, rewrite it so the next session ` +
      `(yours or a colleague's) can continue without this transcript: what is done, what is open, what was decided.\n` +
      `- log.md is append-only. Record decisions and milestones with\n` +
      `  npx kraftwerk projects log ${p.slug} "<one line>" --actor ${actor}\n` +
      `  (stamps the date and you as the author; never edit log.md by hand).\n` +
      `- Links (knowledge, vibeables, repositories, workflows, agents, contacts, places, events) live in project.yml: \`npx kraftwerk projects link ${p.slug} <kind> <name>\` adds one, \`unlink\` removes it.`,
  ];
  return sections.filter(Boolean).join("\n\n");
}
