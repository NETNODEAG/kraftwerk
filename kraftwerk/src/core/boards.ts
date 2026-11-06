import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { boardsRootFor, resolveWorkspace, type ResolvedWorkspace } from "../config.js";
import { changed } from "./changes.js";
import { getOutputDir, workspaceRoot } from "./context.js";
import { mergeDays } from "./journal.js";
import { newestMtime } from "./mtime.js";
import { openProjects, safeProjectSlug } from "./projects.js";
import { findRefs } from "./refs.js";
import { SLUG_RE, slugify } from "./slug.js";
import { moveToTrash } from "./trash.js";

/**
 * Boards and tasks: the work of a project (or of the whole workspace) as
 * columns of cards, stored as plain folders so humans, agents and git all
 * read the same thing. A board holds columns and tasks; a task is a folder
 * with the markdown that describes it, an append-only log of what happened
 * to it, and whatever files it needs.
 *
 *   projects/<p>/boards/<board>/board.md             # title, columns, default agent + the board's rules (body)
 *   projects/<p>/boards/<board>/tasks/<n>-<slug>/task.md   # title, status (a column), order, assignee, due, tags, refs + the task (body)
 *   projects/<p>/boards/<board>/tasks/<n>-<slug>/log.md    # newest first: moves, hand-overs, comments, files (journal format)
 *   projects/<p>/boards/<board>/tasks/<n>-<slug>/…         # the task's files
 *   kraftwerk-data/boards/<board>/…                    # workspace boards, same shape (`boards.root`)
 *
 * The folder is the registry: a folder with a board.md is a board, a
 * folder under tasks/ with a task.md is a task. The column is a field of
 * task.md, not a folder per column, so a move is a one-line diff and the
 * task's path (links, files) never changes. Task folders are numbered per
 * board (`50-write-a-press-release`): the number is the short handle in
 * the CLI, the whole name is the reference token (task:50-write-a-press-release).
 *
 * Agents are woken by events, not by polling: whoever writes a task (an API
 * route, the CLI in another process) appends a line to <output>/boards/events.jsonl
 * when a task with an agent as assignee sits in a work column, and the server
 * on this machine consumes the file (board-wake.ts). The output folder is
 * local, so a clone of the workspace never sees another machine's events.
 */

export const BOARD_FILE = "board.md";
export const TASK_FILE = "task.md";
export const TASK_LOG = "log.md";
const TASKS_DIR = "tasks";
const BOARDS_DIR = "boards";
const LOCK_FILE = ".lock";
/** A lock older than this is a crashed writer's, not a live one. */
const LOCK_STALE_MS = 10_000;
/** The folder (and the default board's slug) a project's tasks go to when no board is named. */
export const DEFAULT_BOARD = "tasks";

export interface Column {
  slug: string;
  label: string;
  /** Work-in-progress limit; the UI marks the column when it is exceeded, nothing is refused. */
  limit?: number;
  /** Tasks here are finished. */
  done?: boolean;
  /** Tasks here wait for a human: they count as attention. */
  review?: boolean;
}

export const DEFAULT_COLUMNS: Column[] = [
  { slug: "draft", label: "Draft" },
  { slug: "todo", label: "Todo" },
  { slug: "progress", label: "In progress" },
  { slug: "review", label: "Review", review: true },
  { slug: "done", label: "Done", done: true },
];

/** Where a board lives: in a project, or at the workspace level. */
export interface BoardRef {
  project?: string;
  board: string;
}

export interface BoardDef extends BoardRef {
  title: string;
  columns: Column[];
  /** Tasks entering todo without an assignee get this agent (and wake it). */
  agent?: string;
  /** A task in a work column with no log entry for this long shows as stale. Default: 1d. */
  staleAfter?: string;
}

export interface BoardSummary extends BoardDef {
  /** Absolute folder path. */
  path: string;
  updatedAt?: string;
  /** Set when board.md exists but is unusable; the rest shows defaults. */
  configError?: string;
  /** Tasks per column slug (tasks in no known column under ""). */
  counts: Record<string, number>;
  tasks: number;
  /** Tasks in a review column. */
  review: number;
}

export interface BoardDetail extends BoardSummary {
  /** The body of board.md: what the board is for, the rules agents follow. */
  notes: string;
  items: TaskSummary[];
}

export interface TaskDef {
  /** The folder name: <number>-<slug>. */
  slug: string;
  number: number;
  title: string;
  /** A column slug of the board. */
  status: string;
  /** Position inside the column; sparse, renumbered on save. */
  order: number;
  /** An agent slug; absent = unassigned. */
  assignee?: string;
  due?: string;
  created: string;
  tags: string[];
  /** kind:slug tokens this task refers to. */
  refs: string[];
  /** Unknown frontmatter keys, kept as written. */
  extra?: Record<string, unknown>;
}

export interface TaskSummary extends TaskDef {
  /** The task's reference: <project>/<board>/<slug> or <board>/<slug>. */
  ref: string;
  path: string;
  updatedAt?: string;
  configError?: string;
  /** Files in the folder (task.md, log.md and dot files not counted). */
  files: number;
  /** The newest log line, without its stamp. */
  lastLog?: string;
  /** In a work column with an assignee and nothing logged for staleAfter. */
  stale?: boolean;
}

export interface TaskDetail extends TaskSummary {
  /** The body of task.md. */
  notes: string;
  /** log.md as written. */
  log: string;
  /** The task's files, relative to its folder. */
  fileList: string[];
  board: string;
  project?: string;
}

export interface BoardsView {
  enabled: boolean;
  /** The workspace boards root. */
  root?: string;
  boards: BoardSummary[];
  error?: string;
}

/** Every field optional: omitted = untouched. */
export interface SaveBoardInput {
  title?: string;
  columns?: unknown;
  agent?: string | null;
  staleAfter?: string | null;
  notes?: string;
}

export interface TaskInput {
  title?: string;
  status?: string;
  order?: number;
  assignee?: string | null;
  due?: string | null;
  tags?: unknown;
  refs?: unknown;
  notes?: string;
}

/** Who writes (an actor string: human:user, lisa/claude, …) and an optional message for the log. */
export interface WriteOpts {
  actor?: string;
  message?: string;
}

/* ---------- root ---------- */

export async function openBoards(): Promise<{ project?: ResolvedWorkspace; root?: string; off?: boolean; error?: string }> {
  let project: ResolvedWorkspace;
  try {
    project = await resolveWorkspace(workspaceRoot());
  } catch (err) {
    return { error: (err as Error).message };
  }
  const root = boardsRootFor(project);
  if (!root) return { off: true, error: "boards are off (enable them in settings or add `boards:` to kraftwerk.yml)" };
  return { project, root };
}

/** Make sure the workspace boards root exists; runs when the feature is switched on. */
export async function ensureBoardsRoot(): Promise<void> {
  const opened = await openBoards();
  if (opened.root) await fs.mkdir(opened.root, { recursive: true });
}

async function requireRoot(): Promise<string> {
  const opened = await openBoards();
  if (!opened.root) throw new Error(opened.error ?? "boards are off");
  return opened.root;
}

export function safeBoardSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid board name "${slug}"`);
  return slug;
}

const TASK_SLUG_RE = /^(\d+)-([a-z0-9][a-z0-9-]{0,48})$/;

/** The folder name of a task: <number>-<slug>. */
export function safeTaskSlug(slug: string): string {
  if (!TASK_SLUG_RE.test(slug)) throw new Error(`invalid task name "${slug}" (expected <number>-<slug>, e.g. 50-write-a-press-release)`);
  return slug;
}

/** The folder a board lives in: inside its project (projects must be on) or under the workspace root. */
export async function boardDir(ref: BoardRef): Promise<string> {
  const root = await requireRoot();
  const board = safeBoardSlug(ref.board);
  if (!ref.project) return path.join(root, board);
  const projects = await openProjects();
  if (!projects.root) throw new Error(projects.error ?? "projects are off");
  const dir = path.join(projects.root, safeProjectSlug(ref.project));
  if (!(await fs.stat(path.join(dir, "project.yml")).catch(() => null))) throw new Error(`no project "${ref.project}"`);
  return path.join(dir, BOARDS_DIR, board);
}

/** "<project>/<board>" or "<board>". */
export const boardKey = (ref: BoardRef): string => (ref.project ? `${ref.project}/${ref.board}` : ref.board);
/** "<project>/<board>/<task>" or "<board>/<task>". */
export const taskRef = (ref: BoardRef, task: string): string => `${boardKey(ref)}/${task}`;

/** Parse "<project>/<board>/<task>" or "<board>/<task>" (and the two-or-one-part board forms when `task` is false). */
export function parseTaskRef(text: string): { board: BoardRef; task: string } {
  const parts = text.trim().split("/").filter(Boolean);
  if (parts.length === 2) return { board: { board: safeBoardSlug(parts[0]) }, task: safeTaskSlug(parts[1]) };
  if (parts.length === 3) return { board: { project: safeProjectSlug(parts[0]), board: safeBoardSlug(parts[1]) }, task: safeTaskSlug(parts[2]) };
  throw new Error(`invalid task reference "${text}" (expected <board>/<task> or <project>/<board>/<task>)`);
}

export function parseBoardRef(text: string): BoardRef {
  const parts = text.trim().split("/").filter(Boolean);
  if (parts.length === 1) return { board: safeBoardSlug(parts[0]) };
  if (parts.length === 2) return { project: safeProjectSlug(parts[0]), board: safeBoardSlug(parts[1]) };
  throw new Error(`invalid board reference "${text}" (expected <board> or <project>/<board>)`);
}

/* ---------- board.md ---------- */

const cleanColumns = (v: unknown): Column[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length === 0) throw new Error("columns must be a non-empty list");
  const out: Column[] = [];
  for (const raw of v) {
    const c = typeof raw === "string" ? { slug: raw } : raw;
    if (typeof c !== "object" || c === null || Array.isArray(c)) throw new Error("each column is a slug or {slug, label, limit, done, review}");
    const r = c as Record<string, unknown>;
    const slug = typeof r.slug === "string" ? r.slug.trim() : "";
    if (!SLUG_RE.test(slug)) throw new Error(`column slug "${slug}" must be lowercase letters, digits and dashes`);
    if (out.some((x) => x.slug === slug)) throw new Error(`column "${slug}" appears twice`);
    const label = typeof r.label === "string" && r.label.trim() ? r.label.trim() : slug[0].toUpperCase() + slug.slice(1);
    const col: Column = { slug, label };
    if (r.limit !== undefined && r.limit !== null) {
      const n = Number(r.limit);
      if (!Number.isInteger(n) || n < 1) throw new Error(`column "${slug}": limit must be a positive whole number`);
      col.limit = n;
    }
    if (r.done !== undefined && typeof r.done !== "boolean") throw new Error(`column "${slug}": done must be true or false`);
    if (r.review !== undefined && typeof r.review !== "boolean") throw new Error(`column "${slug}": review must be true or false`);
    if (r.done) col.done = true;
    if (r.review) col.review = true;
    out.push(col);
  }
  return out;
};

/** "1d", "12h", "90m" -> milliseconds. */
export function parseDuration(text: string): number {
  const m = /^(\d+)\s*([mhd])$/.exec(text.trim());
  if (!m) throw new Error(`stale_after must be like 90m, 12h or 2d, not "${text}"`);
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "m" | "h" | "d"];
}

const cleanAgentSlug = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !SLUG_RE.test(v.trim())) throw new Error("agent must be an agent slug");
  return v.trim();
};

/** Split a Markdown file into its frontmatter text and body (same rule as entities.ts). */
function splitFrontmatter(raw: string): { fm: string | null; body: string } {
  if (!raw.startsWith("---")) return { fm: null, body: raw };
  const m = /^---[ \t]*\r?\n---[ \t]*(\r?\n|$)/.exec(raw) ?? /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(raw);
  if (!m) return { fm: null, body: raw };
  return { fm: m[1] ?? "", body: raw.slice(m[0].length).replace(/^\r?\n/, "") };
}

const toFile = (doc: Record<string, unknown>, body: string): string => `---\n${stringify(doc)}---\n${body.trim() ? `\n${body.replace(/\s+$/, "")}\n` : ""}`;

const fmData = (fm: string | null): Record<string, unknown> => {
  const data = fm === null ? {} : (parse(fm) ?? {});
  if (typeof data !== "object" || Array.isArray(data)) throw new Error("frontmatter must be a mapping");
  return data as Record<string, unknown>;
};

/** The workspace's default columns: `boards.columns` in kraftwerk.yml, else DEFAULT_COLUMNS. */
async function defaultColumns(): Promise<Column[]> {
  const opened = await openBoards();
  const v = opened.project?.config.boards?.columns;
  if (!v) return DEFAULT_COLUMNS;
  try {
    return cleanColumns(v);
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function parseBoard(ref: BoardRef, data: Record<string, unknown>, fallback: Column[]): BoardDef {
  const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : ref.board;
  const columns = cleanColumns(data.columns);
  const def: BoardDef = { ...ref, title, columns: columns.length ? columns : fallback };
  const agent = cleanAgentSlug(data.agent);
  if (agent) def.agent = agent;
  if (data.stale_after !== undefined && data.stale_after !== null && data.stale_after !== "") {
    parseDuration(String(data.stale_after));
    def.staleAfter = String(data.stale_after).trim();
  }
  return def;
}

function boardToFile(def: BoardDef, notes: string, explicitColumns: boolean): string {
  const doc: Record<string, unknown> = { title: def.title };
  if (explicitColumns) doc.columns = def.columns.map((c) => (Object.keys(c).length === 2 && c.label === c.slug[0].toUpperCase() + c.slug.slice(1) ? c.slug : c));
  if (def.agent) doc.agent = def.agent;
  if (def.staleAfter) doc.stale_after = def.staleAfter;
  return toFile(doc, notes);
}

const emptyBoard = (ref: BoardRef, columns: Column[]): BoardDef => ({ ...ref, title: ref.board, columns });

/** The column `tasks pick` takes from: "todo" when the board has it, else the second column (the first is the inbox), else the only one. */
export const pickColumn = (columns: Column[]): Column | undefined => columns.find((c) => c.slug === "todo") ?? columns[1] ?? columns[0];
/** A column's role: work columns — from the pick column on, review and done excepted — are where an assigned agent is expected to act. */
export const isWorkColumn = (c: Column | undefined, columns: Column[]): boolean => {
  if (!c || c.done || c.review) return false;
  const pick = pickColumn(columns);
  return !pick || columns.indexOf(c) >= columns.indexOf(pick);
};
export const reviewColumn = (columns: Column[]): Column | undefined => columns.find((c) => c.review) ?? columns.find((c) => c.slug === "review");

async function readBoard(ref: BoardRef, dir: string, fallback: Column[]): Promise<{ summary: Omit<BoardSummary, "counts" | "tasks" | "review">; notes: string } | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, BOARD_FILE), "utf8");
  } catch {
    return null;
  }
  const newest = await newestMtime(dir).catch(() => 0);
  const updatedAt = newest ? new Date(newest).toISOString() : undefined;
  const { fm, body } = splitFrontmatter(raw);
  try {
    return { summary: { ...parseBoard(ref, fmData(fm), fallback), path: dir, ...(updatedAt ? { updatedAt } : {}) }, notes: body };
  } catch (err) {
    return { summary: { ...emptyBoard(ref, fallback), path: dir, ...(updatedAt ? { updatedAt } : {}), configError: (err as Error).message }, notes: body };
  }
}

/* ---------- task.md ---------- */

const strList = (v: unknown, field: string): string[] => {
  if (v === undefined || v === null || v === "") return [];
  const list = typeof v === "string" ? v.split(",") : v;
  if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) throw new Error(`${field} must be a list`);
  return [...new Set(list.map((x) => x.trim()).filter(Boolean))];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const cleanDate = (v: unknown, field: string): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const s = v instanceof Date ? v.toISOString() : String(v).trim();
  const iso = v instanceof Date && /T00:00:00\.000Z$/.test(s) ? s.slice(0, 10) : s;
  if (!DATE_RE.test(iso) || Number.isNaN(Date.parse(iso))) throw new Error(`${field} must be an ISO date (2026-11-20)`);
  return iso;
};

const TASK_KEYS = new Set(["title", "status", "order", "assignee", "due", "created", "tags", "refs"]);
const TASK_READ_ONLY = new Set(["slug", "number", "ref", "path", "updatedAt", "configError", "files", "lastLog", "stale", "notes", "log", "fileList", "board", "project", "extra"]);

function parseTask(slug: string, data: Record<string, unknown>, columns: Column[]): TaskDef {
  const m = TASK_SLUG_RE.exec(slug);
  const number = m ? Number(m[1]) : 0;
  const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : slug;
  const status = typeof data.status === "string" && data.status.trim() ? data.status.trim() : columns[0]?.slug ?? "draft";
  if (!SLUG_RE.test(status)) throw new Error(`status "${status}" is not a column slug`);
  const order = data.order === undefined || data.order === null ? 0 : Number(data.order);
  if (!Number.isFinite(order)) throw new Error("order must be a number");
  const def: TaskDef = { slug, number, title, status, order, created: cleanDate(data.created, "created") ?? "", tags: strList(data.tags, "tags"), refs: strList(data.refs, "refs") };
  const assignee = cleanAgentSlug(data.assignee);
  if (assignee) def.assignee = assignee;
  const due = cleanDate(data.due, "due");
  if (due) def.due = due;
  const extra = Object.fromEntries(Object.entries(data).filter(([k, v]) => !TASK_KEYS.has(k) && !TASK_READ_ONLY.has(k) && v !== undefined));
  if (Object.keys(extra).length) def.extra = extra;
  return def;
}

function taskToFile(def: TaskDef, notes: string): string {
  const doc: Record<string, unknown> = { title: def.title, status: def.status, order: def.order };
  if (def.assignee) doc.assignee = def.assignee;
  if (def.due) doc.due = def.due;
  if (def.created) doc.created = def.created;
  if (def.tags.length) doc.tags = def.tags;
  if (def.refs.length) doc.refs = def.refs;
  for (const [k, v] of Object.entries(def.extra ?? {})) if (!(k in doc)) doc[k] = v;
  return toFile(doc, notes);
}

const emptyTask = (slug: string, columns: Column[]): TaskDef => ({
  slug,
  number: Number(TASK_SLUG_RE.exec(slug)?.[1] ?? 0),
  title: slug,
  status: columns[0]?.slug ?? "draft",
  order: 0,
  created: "",
  tags: [],
  refs: [],
});

/** The files of a task folder: everything but task.md, log.md and dot files, relative to the folder. */
async function taskFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    if (out.length > 500) return;
    for (const k of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (k.name.startsWith(".")) continue;
      const abs = path.join(d, k.name);
      if (k.isDirectory()) await walk(abs);
      else if (k.isFile() && !(d === dir && (k.name === TASK_FILE || k.name === TASK_LOG))) out.push(path.relative(dir, abs).split(path.sep).join("/"));
    }
  };
  await walk(dir);
  return out.sort();
}

/** The newest entry of a log in the journal format, without its stamp and actor. */
function lastLogLine(raw: string): string | undefined {
  const line = raw.split("\n").find((l) => l.startsWith("* "));
  return line ? line.replace(/^\* (\d\d:\d\d )?/, "").replace(/\s\([^()]*\)\s*$/, "").trim() : undefined;
}

/** The moment of the newest log entry (local time, as the journal format writes it). */
function lastLogAt(raw: string): number | undefined {
  const lines = raw.split("\n");
  const day = lines.find((l) => /^## \d{4}-\d{2}-\d{2}/.test(l))?.slice(3).trim();
  const time = lines.find((l) => /^\* \d\d:\d\d /.test(l))?.slice(2, 7);
  if (!day) return undefined;
  const t = Date.parse(`${day}T${time ?? "00:00"}`);
  return Number.isNaN(t) ? undefined : t;
}

async function readTask(ref: BoardRef, board: BoardDef, slug: string): Promise<{ summary: TaskSummary; notes: string; log: string } | null> {
  const dir = path.join(await boardDir(ref), TASKS_DIR, slug);
  let raw: string;
  let st: { mtimeMs: number };
  const file = path.join(dir, TASK_FILE);
  try {
    [raw, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
  } catch {
    return null;
  }
  const [log, files] = await Promise.all([fs.readFile(path.join(dir, TASK_LOG), "utf8").catch(() => ""), taskFiles(dir)]);
  const updatedAt = new Date(st.mtimeMs).toISOString();
  const { fm, body } = splitFrontmatter(raw);
  const base = { ref: taskRef(ref, slug), path: dir, updatedAt, files: files.length };
  const last = lastLogLine(log);
  try {
    const def = parseTask(slug, fmData(fm), board.columns);
    const col = board.columns.find((c) => c.slug === def.status);
    const summary: TaskSummary = { ...def, ...base, ...(last ? { lastLog: last } : {}) };
    if (def.assignee && isWorkColumn(col, board.columns)) {
      const at = lastLogAt(log) ?? st.mtimeMs;
      if (Date.now() - at > parseDuration(board.staleAfter ?? "1d")) summary.stale = true;
    }
    return { summary, notes: body, log };
  } catch (err) {
    return { summary: { ...emptyTask(slug, board.columns), ...base, configError: (err as Error).message, ...(last ? { lastLog: last } : {}) }, notes: body, log };
  }
}

/* ---------- reads ---------- */

async function boardSlugsIn(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && SLUG_RE.test(e.name)).map((e) => e.name).sort();
}

async function taskSlugsIn(dir: string): Promise<string[]> {
  const entries = await fs.readdir(path.join(dir, TASKS_DIR), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && TASK_SLUG_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => Number(TASK_SLUG_RE.exec(a)![1]) - Number(TASK_SLUG_RE.exec(b)![1]));
}

const byColumn = (columns: Column[]) => {
  const rank = new Map(columns.map((c, i) => [c.slug, i]));
  return (a: TaskSummary, b: TaskSummary): number =>
    (rank.get(a.status) ?? columns.length) - (rank.get(b.status) ?? columns.length) || a.order - b.order || (a.due ?? "9").localeCompare(b.due ?? "9") || a.number - b.number;
};

async function summarise(ref: BoardRef, dir: string, fallback: Column[]): Promise<{ summary: BoardSummary; notes: string; items: TaskSummary[] } | null> {
  const read = await readBoard(ref, dir, fallback);
  if (!read) return null;
  const items = (await Promise.all((await taskSlugsIn(dir)).map((s) => readTask(ref, read.summary, s)))).filter((t) => t != null).map((t) => t.summary);
  items.sort(byColumn(read.summary.columns));
  const counts: Record<string, number> = Object.fromEntries(read.summary.columns.map((c) => [c.slug, 0]));
  for (const t of items) counts[read.summary.columns.some((c) => c.slug === t.status) ? t.status : ""] = (counts[read.summary.columns.some((c) => c.slug === t.status) ? t.status : ""] ?? 0) + 1;
  const review = items.filter((t) => read.summary.columns.find((c) => c.slug === t.status)?.review).length;
  return { summary: { ...read.summary, counts, tasks: items.length, review }, notes: read.notes, items };
}

/** The boards of a project (its boards/ folder), or the workspace boards when no project is given. */
export async function listBoards(project?: string): Promise<BoardsView> {
  const opened = await openBoards();
  if (!opened.root) return { enabled: false, boards: [], error: opened.error };
  const fallback = await defaultColumns();
  let dir: string;
  if (project) {
    const projects = await openProjects();
    if (!projects.root) return { enabled: true, root: opened.root, boards: [], error: projects.error };
    dir = path.join(projects.root, safeProjectSlug(project), BOARDS_DIR);
  } else dir = opened.root;
  const boards = (await Promise.all((await boardSlugsIn(dir)).map((b) => summarise({ ...(project ? { project } : {}), board: b }, path.join(dir, b), fallback))))
    .filter((x) => x != null)
    .map((x) => x.summary);
  return { enabled: true, root: opened.root, boards };
}

/** Every board of the workspace: the workspace ones first, then each project's. */
export async function listAllBoards(): Promise<BoardSummary[]> {
  const opened = await openBoards();
  if (!opened.root) return [];
  const out = (await listBoards()).boards;
  const projects = await openProjects();
  if (projects.root) {
    const slugs = (await fs.readdir(projects.root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && SLUG_RE.test(e.name)).map((e) => e.name);
    for (const p of slugs) out.push(...(await listBoards(p).catch(() => ({ boards: [] as BoardSummary[] }))).boards);
  }
  return out;
}

export async function getBoard(ref: BoardRef): Promise<BoardDetail | null> {
  const dir = await boardDir(ref);
  const read = await summarise(ref, dir, await defaultColumns());
  return read ? { ...read.summary, notes: read.notes, items: read.items } : null;
}

async function requireBoard(ref: BoardRef): Promise<BoardDetail> {
  const b = await getBoard(ref);
  if (!b) throw new Error(`no board "${boardKey(ref)}"`);
  return b;
}

/** Tasks of a board, optionally narrowed by column, assignee (or "" for unassigned) and tag. */
export async function listTasks(ref: BoardRef, filter: { status?: string; assignee?: string; tag?: string } = {}): Promise<TaskSummary[]> {
  const b = await requireBoard(ref);
  return b.items.filter(
    (t) => (filter.status === undefined || t.status === filter.status) && (filter.assignee === undefined || (t.assignee ?? "") === filter.assignee) && (filter.tag === undefined || t.tags.includes(filter.tag)),
  );
}

/** A task by its folder name or its bare number. */
async function resolveTaskSlug(ref: BoardRef, idOrNumber: string): Promise<string> {
  const id = idOrNumber.trim();
  if (TASK_SLUG_RE.test(id)) return id;
  if (/^\d+$/.test(id)) {
    const n = Number(id);
    const slugs = await taskSlugsIn(await boardDir(ref));
    const hit = slugs.find((s) => Number(TASK_SLUG_RE.exec(s)![1]) === n);
    if (hit) return hit;
    throw new Error(`no task ${n} on board "${boardKey(ref)}"`);
  }
  return safeTaskSlug(id);
}

export async function getTask(ref: BoardRef, idOrNumber: string): Promise<TaskDetail | null> {
  const board = await requireBoard(ref);
  const slug = await resolveTaskSlug(ref, idOrNumber).catch(() => null);
  if (!slug) return null;
  const read = await readTask(ref, board, slug);
  if (!read) return null;
  return { ...read.summary, notes: read.notes, log: read.log, fileList: await taskFiles(read.summary.path), board: ref.board, ...(ref.project ? { project: ref.project } : {}) };
}

/** Find a task by its reference anywhere: "<project>/<board>/<task>" or "<board>/<task>". */
export async function findTask(reference: string): Promise<TaskDetail | null> {
  const { board, task } = parseTaskRef(reference);
  return getTask(board, task).catch(() => null);
}

/* ---------- writes: boards ---------- */

export async function createBoard(input: { project?: string; title: string; slug?: string; columns?: unknown; agent?: string; notes?: string }): Promise<BoardDetail> {
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title is required");
  const slug = safeBoardSlug((input.slug ?? "").trim() || slugify(title) || "board");
  const ref: BoardRef = { ...(input.project ? { project: safeProjectSlug(input.project) } : {}), board: slug };
  const dir = await boardDir(ref);
  if (await fs.stat(dir).catch(() => null)) throw new Error(`board "${boardKey(ref)}" already exists`);
  const columns = cleanColumns(input.columns);
  const def: BoardDef = { ...ref, title, columns: columns.length ? columns : await defaultColumns() };
  const agent = cleanAgentSlug(input.agent);
  if (agent) def.agent = agent;
  await fs.mkdir(path.join(dir, TASKS_DIR), { recursive: true });
  await fs.writeFile(path.join(dir, BOARD_FILE), boardToFile(def, input.notes ?? "", columns.length > 0), { flag: "wx" });
  changed();
  return (await getBoard(ref))!;
}

export async function saveBoard(ref: BoardRef, input: SaveBoardInput): Promise<BoardDetail> {
  const current = await requireBoard(ref);
  if (current.configError) throw new Error(`board "${boardKey(ref)}" cannot be saved until its file is fixed by hand (${current.configError}): ${current.path}`);
  const raw = await fs.readFile(path.join(current.path, BOARD_FILE), "utf8");
  const { fm } = splitFrontmatter(raw);
  const data = fmData(fm);
  const explicit = input.columns !== undefined ? cleanColumns(input.columns).length > 0 : data.columns !== undefined && data.columns !== null;
  const next: BoardDef = {
    ...ref,
    title: input.title !== undefined ? String(input.title).trim() || ref.board : current.title,
    columns: input.columns !== undefined && cleanColumns(input.columns).length ? cleanColumns(input.columns) : explicit ? current.columns : await defaultColumns(),
  };
  const agent = input.agent !== undefined ? cleanAgentSlug(input.agent ?? undefined) : current.agent;
  if (agent) next.agent = agent;
  const stale = input.staleAfter !== undefined ? (input.staleAfter ? input.staleAfter.trim() : undefined) : current.staleAfter;
  if (stale) {
    parseDuration(stale);
    next.staleAfter = stale;
  }
  await fs.writeFile(path.join(current.path, BOARD_FILE), boardToFile(next, typeof input.notes === "string" ? input.notes : current.notes, explicit));
  changed();
  return (await getBoard(ref))!;
}

/** Move the board folder, tasks and all, to the trash. */
export async function deleteBoard(ref: BoardRef): Promise<void> {
  const b = await requireBoard(ref);
  await moveToTrash("boards", boardKey(ref), b.path);
  changed();
}

/** The project's default board (`tasks`), created on first use. */
export async function ensureDefaultBoard(project?: string): Promise<BoardRef> {
  const ref: BoardRef = { ...(project ? { project } : {}), board: DEFAULT_BOARD };
  if (await getBoard(ref)) return ref;
  await createBoard({ project, title: "Tasks", slug: DEFAULT_BOARD, notes: "The tasks of this " + (project ? "project" : "workspace") + ". Agents pick from Todo, work in In progress and hand finished work to Review; only a human moves a task to Done." });
  return ref;
}

/* ---------- the task lock ---------- */

/**
 * One writer at a time per task folder: the UI, an agent's CLI and the
 * event consumer may all touch task.md within the same second. The lock is
 * a file created exclusively; a lock older than LOCK_STALE_MS belonged to
 * a writer that died and is taken over.
 */
async function withTaskLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = path.join(dir, LOCK_FILE);
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await fs.writeFile(lock, String(process.pid), { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const st = await fs.stat(lock).catch(() => null);
      if (!st || Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`task is being written by another process (${lock})`);
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { force: true });
  }
}

/* ---------- the task log ---------- */

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Prepend one stamped line to a task's log.md (journal format: `## day`, `* HH:MM text (actor)`, newest first). No lock: callers hold it. */
async function writeLogLine(dir: string, title: string, text: string, actor: string, now = new Date()): Promise<void> {
  const file = path.join(dir, TASK_LOG);
  const raw = (await fs.readFile(file, "utf8").catch(() => null)) ?? `# ${title} — log\n`;
  const lines = mergeDays(raw).split("\n");
  const line = `* ${clock(now)} ${text} (${actor})`;
  const today = localDate(now);
  const todayIdx = lines.findIndex((l) => l.trim() === `## ${today}`);
  if (todayIdx >= 0) lines.splice(todayIdx + 1, 0, line);
  else {
    const titleIdx = lines.findIndex((l) => l.startsWith("# "));
    lines.splice(titleIdx + 1, 0, "", `## ${today}`, line);
  }
  await fs.writeFile(file, lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

const cleanActor = (actor?: string): string => (actor ?? "").trim() || "human:user";
const oneLine = (text: string): string => text.trim().replace(/\s*\n\s*/g, " ");

/** Append a free entry to a task's log: what was done, a comment, a question. */
export async function appendTaskLog(ref: BoardRef, idOrNumber: string, entry: string, actor?: string): Promise<TaskDetail> {
  const t = await getTask(ref, idOrNumber);
  if (!t) throw new Error(`no task "${idOrNumber}" on board "${boardKey(ref)}"`);
  const text = oneLine(entry);
  if (!text) throw new Error("entry is required");
  await withTaskLock(t.path, () => writeLogLine(t.path, t.title, text, cleanActor(actor)));
  changed();
  return (await getTask(ref, t.slug))!;
}

/* ---------- events ---------- */

/** What the server acts on: a task with an agent in a work column, after a change of that pair. */
export interface TaskEvent {
  at: string;
  ref: string;
  project?: string;
  board: string;
  task: string;
  title: string;
  agent: string;
  status: string;
  /** Why the agent is woken, for the message it gets. */
  reason: "assigned" | "moved" | "created";
  actor: string;
  message?: string;
}

export const EVENTS_FILE = "boards/events.jsonl";

/** Append an event for the server on this machine (board-wake.ts reads the file). Local run-state: never in git. */
async function emitTaskEvent(ev: TaskEvent): Promise<void> {
  const file = path.join(getOutputDir(), EVENTS_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(ev)}\n`);
  changed();
}

/** After a write: wake the assignee when the (assignee, status) pair changed into "an agent in a work column". */
async function maybeEmit(ref: BoardRef, board: BoardDef, before: Pick<TaskDef, "assignee" | "status"> | null, after: TaskDef, reason: TaskEvent["reason"], actor: string, message?: string): Promise<void> {
  const col = board.columns.find((c) => c.slug === after.status);
  if (!after.assignee || !isWorkColumn(col, board.columns)) return;
  if (before && before.assignee === after.assignee && before.status === after.status) return;
  // The assignee acting on its own task (moving it to progress, logging) is already at work: no wake.
  if (actor === after.assignee || actor.startsWith(`${after.assignee}/`)) return;
  await emitTaskEvent({
    at: new Date().toISOString(),
    ref: taskRef(ref, after.slug),
    ...(ref.project ? { project: ref.project } : {}),
    board: ref.board,
    task: after.slug,
    title: after.title,
    agent: after.assignee,
    status: after.status,
    reason,
    actor,
    ...(message ? { message } : {}),
  });
}

/* ---------- writes: tasks ---------- */

/** Validate refs tokens: each must be a kind:slug the registry knows (a missing target is fine). */
const cleanRefs = (v: unknown): string[] =>
  strList(v, "refs").map((t) => {
    const found = findRefs(t);
    if (found.length !== 1 || found[0].token !== t) throw new Error(`refs must be kind:slug tokens (contact:anna-meier), not "${t}"`);
    return t;
  });

function applyInput(def: TaskDef, input: TaskInput, board: BoardDef): TaskDef {
  const next: TaskDef = { ...def, tags: [...def.tags], refs: [...def.refs] };
  if (input.title !== undefined) {
    const t = String(input.title).trim();
    if (!t) throw new Error("title is required");
    next.title = t;
  }
  if (input.status !== undefined) {
    const s = String(input.status).trim();
    if (!board.columns.some((c) => c.slug === s)) throw new Error(`no column "${s}" on board "${boardKey(board)}" (columns: ${board.columns.map((c) => c.slug).join(", ")})`);
    next.status = s;
  }
  if (input.order !== undefined) {
    if (!Number.isFinite(Number(input.order))) throw new Error("order must be a number");
    next.order = Number(input.order);
  }
  if (input.assignee !== undefined) {
    const a = cleanAgentSlug(input.assignee ?? undefined);
    if (a) next.assignee = a;
    else delete next.assignee;
  }
  if (input.due !== undefined) {
    const d = cleanDate(input.due ?? undefined, "due");
    if (d) next.due = d;
    else delete next.due;
  }
  if (input.tags !== undefined) next.tags = strList(input.tags, "tags");
  if (input.refs !== undefined) next.refs = cleanRefs(input.refs);
  return next;
}

/** Sparse order numbers, so a card can be dropped between two others without renumbering the column every time. */
const ORDER_STEP = 10;

/** The next order value at the end of a column. */
const nextOrder = (items: TaskSummary[], status: string): number => Math.max(0, ...items.filter((t) => t.status === status).map((t) => t.order)) + ORDER_STEP;

export async function createTask(ref: BoardRef, input: TaskInput & { actor?: string; message?: string }): Promise<TaskDetail> {
  const board = await requireBoard(ref);
  if (board.configError) throw new Error(`board "${boardKey(ref)}" cannot take tasks until its file is fixed by hand (${board.configError}): ${board.path}`);
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title is required");
  const actor = cleanActor(input.actor);
  const base = emptyTask("0-task", board.columns);
  base.created = localDate(new Date());
  let def = applyInput(base, { ...input, title }, board);
  // A task created straight into todo on a board with a default agent is that agent's.
  if (!def.assignee && board.agent && def.status === pickColumn(board.columns)?.slug) def.assignee = board.agent;
  if (input.order === undefined) def.order = nextOrder(board.items, def.status);
  const tasksDir = path.join(board.path, TASKS_DIR);
  await fs.mkdir(tasksDir, { recursive: true });
  // The number counts up per board; exclusive mkdir settles a race between two creators.
  let dir = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    const slugs = await taskSlugsIn(board.path);
    const n = Math.max(0, ...slugs.map((s) => Number(TASK_SLUG_RE.exec(s)![1]))) + 1;
    const slug = `${n}-${slugify(title, 40) || "task"}`;
    try {
      await fs.mkdir(path.join(tasksDir, slug));
      def = { ...def, slug, number: n };
      dir = path.join(tasksDir, slug);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  if (!dir) throw new Error("could not allot a task number");
  await fs.writeFile(path.join(dir, TASK_FILE), taskToFile(def, typeof input.notes === "string" ? input.notes : ""), { flag: "wx" });
  const col = board.columns.find((c) => c.slug === def.status);
  await writeLogLine(dir, def.title, `Created in ${col?.label ?? def.status}${def.assignee ? `, assigned to ${def.assignee}` : ""}${input.message ? `: ${oneLine(input.message)}` : ""}`, actor);
  await maybeEmit(ref, board, null, def, "created", actor, input.message);
  changed();
  return (await getTask(ref, def.slug))!;
}

/** Merge fields (and the notes when given) into task.md; a status or assignee change is logged and may wake the assignee. */
export async function saveTask(ref: BoardRef, idOrNumber: string, input: TaskInput, opts: WriteOpts = {}): Promise<TaskDetail> {
  const board = await requireBoard(ref);
  const current = await getTask(ref, idOrNumber);
  if (!current) throw new Error(`no task "${idOrNumber}" on board "${boardKey(ref)}"`);
  if (current.configError) throw new Error(`task "${current.slug}" cannot be saved until its file is fixed by hand (${current.configError}): ${current.path}`);
  const actor = cleanActor(opts.actor);
  const { ref: _r, path: _p, updatedAt: _u, configError: _c, files: _f, lastLog: _l, stale: _s, notes: _n, log: _g, fileList: _fl, board: _b, project: _pj, ...def } = current;
  const next = applyInput(def, input, board);
  if (input.status !== undefined && input.status !== def.status && input.order === undefined) next.order = nextOrder(board.items, next.status);
  await withTaskLock(current.path, async () => {
    await fs.writeFile(path.join(current.path, TASK_FILE), taskToFile(next, typeof input.notes === "string" ? input.notes : current.notes));
    const msg = opts.message ? `: ${oneLine(opts.message)}` : "";
    const label = (s: string) => board.columns.find((c) => c.slug === s)?.label ?? s;
    if (next.status !== def.status) await writeLogLine(current.path, next.title, `Moved ${label(def.status)} → ${label(next.status)}${msg}`, actor);
    if ((next.assignee ?? "") !== (def.assignee ?? "")) {
      await writeLogLine(current.path, next.title, next.assignee ? `Assigned ${def.assignee ? `${def.assignee} → ` : ""}${next.assignee}${msg}` : `Unassigned${def.assignee ? ` (was ${def.assignee})` : ""}${msg}`, actor);
    } else if (opts.message && next.status === def.status) await writeLogLine(current.path, next.title, oneLine(opts.message), actor);
  });
  await maybeEmit(ref, board, def, next, next.status !== def.status ? "moved" : "assigned", actor, opts.message);
  changed();
  return (await getTask(ref, next.slug))!;
}

/** Put a task into a column (and, with `order`, at a position: the orders of the column are renumbered around it). */
export async function moveTask(ref: BoardRef, idOrNumber: string, status: string, opts: WriteOpts & { order?: number; before?: string } = {}): Promise<TaskDetail> {
  const board = await requireBoard(ref);
  const slug = await resolveTaskSlug(ref, idOrNumber);
  let order = opts.order;
  if (opts.before !== undefined) {
    // Drop above a sibling: take its order and push the rest of the column down.
    const column = board.items.filter((t) => t.status === status && t.slug !== slug).sort((a, b) => a.order - b.order);
    const idx = column.findIndex((t) => t.slug === opts.before);
    if (idx < 0) order = nextOrder(board.items, status);
    else {
      order = (idx + 1) * ORDER_STEP;
      for (let i = 0; i < column.length; i++) {
        const want = (i + 1 + (i >= idx ? 1 : 0)) * ORDER_STEP;
        if (column[i].order !== want) await withTaskLock(column[i].path, () => rewriteOrder(column[i].path, want));
      }
    }
  }
  return saveTask(ref, slug, { status, ...(order !== undefined ? { order } : {}) }, opts);
}

async function rewriteOrder(dir: string, order: number): Promise<void> {
  const file = path.join(dir, TASK_FILE);
  const raw = await fs.readFile(file, "utf8");
  const { fm, body } = splitFrontmatter(raw);
  const data = fmData(fm);
  data.order = order;
  await fs.writeFile(file, toFile(data, body));
}

/** Give the task to an agent, or back to the humans (`to` = null: unassigned and into the review column). */
export async function assignTask(ref: BoardRef, idOrNumber: string, to: string | null, opts: WriteOpts = {}): Promise<TaskDetail> {
  const board = await requireBoard(ref);
  if (to === null || to === "" || to === "human") {
    const review = reviewColumn(board.columns);
    return saveTask(ref, idOrNumber, { assignee: null, ...(review ? { status: review.slug } : {}) }, opts);
  }
  return saveTask(ref, idOrNumber, { assignee: to }, opts);
}

/**
 * An agent takes the next task: the first unassigned (or its own) task in
 * the pick column, in the column's order (due date as tie-break), becomes
 * its and moves to the first work column after it. Exclusive: under the
 * task's lock the file is read again, so two agents never take the same one.
 */
export async function pickTask(ref: BoardRef, agent: string, opts: { column?: string; actor?: string } = {}): Promise<TaskDetail | null> {
  const board = await requireBoard(ref);
  const from = opts.column ? board.columns.find((c) => c.slug === opts.column) : pickColumn(board.columns);
  if (!from) throw new Error(`board "${boardKey(ref)}" has no column to pick from`);
  const toCol = board.columns.slice(board.columns.indexOf(from) + 1).find((c) => isWorkColumn(c, board.columns)) ?? from;
  const slugAgent = cleanAgentSlug(agent);
  if (!slugAgent) throw new Error("agent is required");
  const candidates = board.items.filter((t) => !t.configError && t.status === from.slug && (!t.assignee || t.assignee === slugAgent)).sort((a, b) => a.order - b.order || (a.due ?? "9").localeCompare(b.due ?? "9") || a.number - b.number);
  for (const c of candidates) {
    const won = await withTaskLock(c.path, async () => {
      const fresh = await readTask(ref, board, c.slug);
      if (!fresh || fresh.summary.status !== from.slug || (fresh.summary.assignee && fresh.summary.assignee !== slugAgent)) return false;
      const { ref: _r, path: _p, updatedAt: _u, configError: _c, files: _f, lastLog: _l, stale: _s, ...def } = fresh.summary;
      const next: TaskDef = { ...def, assignee: slugAgent, status: toCol.slug, order: nextOrder(board.items, toCol.slug) };
      await fs.writeFile(path.join(c.path, TASK_FILE), taskToFile(next, fresh.notes));
      await writeLogLine(c.path, next.title, `Picked up (${from.label} → ${toCol.label})`, cleanActor(opts.actor ?? slugAgent));
      return true;
    });
    if (won) {
      changed();
      return (await getTask(ref, c.slug))!;
    }
  }
  return null;
}

/** Move the task folder, files and log included, to the trash. */
export async function deleteTask(ref: BoardRef, idOrNumber: string): Promise<void> {
  const t = await getTask(ref, idOrNumber);
  if (!t) throw new Error(`no task "${idOrNumber}" on board "${boardKey(ref)}"`);
  await moveToTrash("tasks", taskRef(ref, t.slug), t.path);
  changed();
}

/** Called by the files API after a file was added to or removed from a task folder. */
export async function noteTaskFile(reference: string, what: "added" | "removed", file: string, actor?: string): Promise<void> {
  const t = await findTask(reference);
  if (!t) return;
  await withTaskLock(t.path, () => writeLogLine(t.path, t.title, `File ${what}: ${file}`, cleanActor(actor)));
  changed();
}

/* ---------- agent context ---------- */

const cliBoard = (ref: BoardRef): string => (ref.project ? `--project ${ref.project} --board ${ref.board}` : `--board ${ref.board}`);

/** One line per task for a context block. */
const taskLine = (t: TaskSummary): string =>
  `- ${t.number} ${t.title} [${t.status}${t.assignee ? `, ${t.assignee}` : ""}${t.due ? `, due ${t.due}` : ""}${t.files ? `, ${t.files} file${t.files === 1 ? "" : "s"}` : ""}]${t.lastLog ? ` — ${t.lastLog}` : ""}`;

/**
 * The "## Board: …" blocks of a project chat (or of an agent for the
 * boards it has tasks on): the board's rules, its columns with counts, the
 * open tasks, and the CLI. `agent` narrows the task list to that agent's
 * and the unassigned ones in the pick column.
 */
export async function boardsContext(project: string | undefined, actor: string, agent?: string): Promise<string> {
  const view = await listBoards(project).catch(() => ({ enabled: false, boards: [] as BoardSummary[] }));
  if (!view.enabled || view.boards.length === 0) return "";
  const blocks: string[] = [];
  for (const b of view.boards) {
    const detail = await getBoard(b).catch(() => null);
    if (!detail) continue;
    const pick = pickColumn(detail.columns);
    const open = detail.items.filter((t) => {
      const col = detail.columns.find((c) => c.slug === t.status);
      if (!col || col.done) return false;
      if (!agent) return true;
      return t.assignee === agent || (!t.assignee && col.slug === pick?.slug);
    });
    const cols = detail.columns.map((c) => `${c.label} (${detail.counts[c.slug] ?? 0})${c.review ? " — waits for a human" : c.done ? " — finished, humans only" : ""}`).join(", ");
    blocks.push(
      `## Board: ${detail.title}${project ? "" : " (workspace)"}\n` +
        (detail.notes.trim() ? `${detail.notes.trim()}\n` : "") +
        `Columns: ${cols}.\n` +
        (open.length ? `${agent ? "Your tasks and the unassigned ones in " + (pick?.label ?? "the pick column") : "Open tasks"}:\n${open.map(taskLine).join("\n")}\n` : "No open tasks.\n") +
        `Work the board through the CLI, never by editing task.md by hand (${cliBoard(b)} on every command; the number alone names a task):\n` +
        `- \`npx kraftwerk tasks list ${cliBoard(b)} --json\`, \`tasks show <n> ${cliBoard(b)}\` (prints the folder path, the files and the log)\n` +
        `- \`npx kraftwerk tasks create "<title>" ${cliBoard(b)} --status ${pick?.slug ?? "todo"} --assign <agent> --file $KRAFTWERK_TEMP/task.md\` (the file is the task's markdown: what, done-when checklist, notes) — assigning an agent wakes it\n` +
        `- \`npx kraftwerk tasks pick ${cliBoard(b)} --as <agent>\` takes the next task in ${pick?.label ?? "the pick column"}; \`tasks move <n> <column> -m "<why>"\`; \`tasks assign <n> <agent> -m "<hand-over note>"\` (or \`--to human\` to give it back); \`tasks log <n> "<what you did>"\`\n` +
        `- Put the task's files into its folder (\`tasks show\` prints it), scratch into $KRAFTWERK_TEMP. Log progress as you go: the humans read the log, not your chat.\n` +
        `- Never move a task into a finished column; hand it to Review and a human decides. Actor on your lines: ${actor}.`,
    );
  }
  return blocks.join("\n\n");
}

/** The block a session gets when it was opened for one task: the task, its files and its whole log. */
export async function taskContext(reference: string): Promise<string> {
  const t = await findTask(reference);
  if (!t) return `You were opened for task ${reference}, but it does not exist any more (removed, or its board is gone). Tell the user.`;
  const ref: BoardRef = { ...(t.project ? { project: t.project } : {}), board: t.board };
  const board = await getBoard(ref).catch(() => null);
  const cols = board ? board.columns.map((c) => c.slug).join(", ") : "";
  return (
    `## Your task: ${t.number} ${t.title}\n` +
    `Board ${boardKey(ref)}${board ? ` (columns: ${cols})` : ""}; status ${t.status}${t.assignee ? `, assigned to ${t.assignee}` : ""}${t.due ? `, due ${t.due}` : ""}. Folder: ${t.path}\n` +
    (board?.notes.trim() ? `Board rules: ${board.notes.trim()}\n` : "") +
    `\n### task.md\n${t.notes.trim() || "(no description — ask the user what done looks like and write it with `tasks set <n> --notes-file`)"}\n` +
    `\n### Files\n${t.fileList.length ? t.fileList.map((f) => `- ${f}`).join("\n") : "(none yet)"}\n` +
    `\n### Log (newest first)\n${t.log.trim() || "(empty)"}\n\n` +
    `Work it through the CLI (${cliBoard(ref)}, the number ${t.number} names the task): \`npx kraftwerk tasks move ${t.number} progress ${cliBoard(ref)}\` when you start, ` +
    `\`tasks log ${t.number} "<what you did>" ${cliBoard(ref)}\` as you go, files into the folder above (scratch into $KRAFTWERK_TEMP), ` +
    `\`tasks assign ${t.number} <agent> -m "<note>" ${cliBoard(ref)}\` to hand it over, \`tasks move ${t.number} review -m "<summary>" ${cliBoard(ref)}\` when done. Never move it to a finished column.`
  );
}
