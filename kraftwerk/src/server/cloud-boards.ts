import type { RemoteBoardSummary, RemotePerson, RemoteTaskDetail, RemoteTaskSummary } from "./api/remote-boards.js";
import { ApiError } from "./api/router.js";
import type { BoardDetail, BoardSummary, Column, ListedTask, TaskDetail, TaskSummary } from "../core/boards.js";
import { inLocalMode, remoteCall, requireCloudMode } from "./remote-boards.js";
import type { Trust } from "./trust.js";

/**
 * Cloud boards in the shape of local boards. The boards API (api/boards.ts)
 * serves a cloud board wherever it serves a local one, so every view —
 * home, the boards page, a board, a task beside its chat, the context
 * column — shows and edits it the same way. A cloud board's slug is its
 * cloud slug behind "@" (`@launch-plan`), which no local board can have
 * (SLUG_RE); a task is addressed by its number; refs read `@launch-plan/3`.
 *
 * What a cloud board has not: files in a task folder, a default agent,
 * rules (board.md's body), links to projects, waking an assigned agent.
 * Its "done" and "review" columns are the columns with those slugs.
 */

export const CLOUD_PREFIX = "@";
export const isCloudBoard = (board: string | undefined): boolean => !!board && board.startsWith(CLOUD_PREFIX);
const slugOf = (board: string): string => encodeURIComponent(board.slice(CLOUD_PREFIX.length));
const boardOf = (slug: string): string => `${CLOUD_PREFIX}${slug}`;
const iso = (ms: number): string => new Date(ms).toISOString();

/** The number in "3", "3-book-the-venue". */
function numberOf(task: string): string {
  const m = /^(\d+)/.exec(task);
  if (!m) throw new ApiError(404, `no task "${task}"`);
  return m[1];
}

const taskSlug = (t: { number: number; title: string }): string => {
  const s = t.title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s ? `${t.number}-${s}` : String(t.number);
};

const columnsOf = (b: RemoteBoardSummary): Column[] =>
  b.columns.map((c) => ({ slug: c.slug, label: c.title, ...(c.slug === "done" ? { done: true } : {}), ...(c.slug === "review" ? { review: true } : {}) }));

export interface CloudMark {
  /** Kept in kraftwerk cloud, shared with everyone on the workspace. */
  cloud?: true;
}

function summary(b: RemoteBoardSummary): BoardSummary & CloudMark {
  return {
    board: boardOf(b.slug),
    title: b.title,
    columns: columnsOf(b),
    path: "",
    updatedAt: iso(b.updatedAt),
    counts: b.counts,
    tasks: b.taskCount,
    review: b.counts.review ?? 0,
    cloud: true,
  };
}

function task(board: string, t: RemoteTaskSummary): TaskSummary & CloudMark {
  return {
    slug: taskSlug(t),
    number: t.number,
    title: t.title,
    status: t.status,
    order: t.position,
    ...(t.assignee ? { assignee: t.assignee } : {}),
    ...(t.due ? { due: t.due } : {}),
    created: iso(t.createdAt).slice(0, 10),
    tags: t.tags,
    refs: [],
    ref: `${board}/${t.number}`,
    path: "",
    updatedAt: iso(t.updatedAt),
    files: 0,
    ...(t.last ? { lastLog: t.last } : {}),
    cloud: true,
  };
}

/** The log as log.md writes it: newest day first, "* HH:MM entry (actor)". */
function logMd(title: string, log: RemoteTaskDetail["log"]): string {
  const lines = [`# ${title} — log`, ""];
  let day = "";
  for (const l of [...log].reverse()) {
    const d = new Date(l.at);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (date !== day) {
      if (day) lines.push("");
      lines.push(`## ${date}`);
      day = date;
    }
    lines.push(`* ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${l.entry.replace(/\n/g, " ")} (${l.actor})`);
  }
  return `${lines.join("\n")}\n`;
}

function detail(board: string, t: RemoteTaskDetail): TaskDetail & CloudMark {
  return { ...task(board, t), notes: t.notes, log: logMd(t.title, t.log), fileList: [], board };
}

/* ---------- reads ---------- */

export interface CloudList {
  boards: (BoardSummary & CloudMark)[];
  /** Why there are none to show: offline (the cloud off or not answering), or not set up for this workspace. */
  error?: string;
  offline?: boolean;
  /** The workspace is in local mode: no cloud boards until it is switched to cloud. */
  local?: boolean;
  /** This workspace in the cloud's web app. */
  url?: string | null;
}

/** The cloud boards beside the local ones; never throws — offline is reported, not raised. */
export async function listCloudBoards(trust: Trust): Promise<CloudList> {
  try {
    const r = await remoteCall<{ boards: RemoteBoardSummary[] }>(trust, { method: "GET", path: "boards" });
    // In local mode the ones made before stay; `local` tells the UI to offer cloud mode for new ones.
    return { boards: r.boards.map(summary), ...((await inLocalMode()) ? { local: true } : {}) };
  } catch (err) {
    const e = err as ApiError;
    const body = (e.body ?? {}) as { offline?: boolean; local?: boolean };
    if (body.local) return { boards: [], local: true };
    return { boards: [], error: e.message, ...(body.offline ? { offline: true } : {}) };
  }
}

/** Every task of every cloud board, as tasks.list lists them; [] while offline. */
export async function listCloudTasks(trust: Trust, boards?: CloudList): Promise<ListedTask[]> {
  const list = boards ?? (await listCloudBoards(trust));
  const out: ListedTask[] = [];
  await Promise.all(
    list.boards.map(async (b) => {
      const d = await getCloudBoard(trust, b.board).catch(() => null);
      for (const t of d?.items ?? []) {
        const column = b.columns.find((c) => c.slug === t.status)?.label;
        out.push({ ...t, board: b.board, boardTitle: b.title, ...(column ? { column } : {}) });
      }
    }),
  );
  return out;
}

export async function getCloudBoard(trust: Trust, board: string): Promise<BoardDetail & CloudMark & { people: RemotePerson[]; actor: string }> {
  const r = await remoteCall<{ board: RemoteBoardSummary; tasks: RemoteTaskSummary[]; people: RemotePerson[]; actor: string }>(trust, { method: "GET", path: `boards/${slugOf(board)}` });
  return { ...summary(r.board), notes: "", items: r.tasks.map((t) => task(board, t)), people: r.people, actor: r.actor };
}

export async function getCloudTask(trust: Trust, board: string, t: string): Promise<TaskDetail & CloudMark> {
  const r = await remoteCall<{ task: RemoteTaskDetail }>(trust, { method: "GET", path: `boards/${slugOf(board)}/tasks/${numberOf(t)}` });
  return detail(board, r.task);
}

/* ---------- writes ---------- */

export async function createCloudBoard(trust: Trust, input: { title: string; slug?: string; columns?: unknown }): Promise<BoardSummary & CloudMark> {
  await requireCloudMode();
  const columns = Array.isArray(input.columns) ? input.columns.map((c) => (typeof c === "string" ? { title: c } : { slug: (c as Column).slug, title: (c as Column).label ?? (c as Column).slug })) : undefined;
  const r = await remoteCall<{ board: RemoteBoardSummary }>(trust, { method: "POST", path: "boards", body: { title: input.title, ...(input.slug ? { slug: input.slug } : {}), ...(columns ? { columns } : {}) } });
  return summary(r.board);
}

export async function saveCloudBoard(trust: Trust, board: string, input: { title?: string; columns?: unknown }): Promise<BoardSummary & CloudMark> {
  const columns = Array.isArray(input.columns)
    ? input.columns.map((c) => (typeof c === "string" ? { slug: c, title: c } : { slug: (c as Column).slug, title: (c as Column).label ?? (c as Column).slug }))
    : undefined;
  const r = await remoteCall<{ board: RemoteBoardSummary }>(trust, { method: "PUT", path: `boards/${slugOf(board)}`, body: { ...(input.title !== undefined ? { title: input.title } : {}), ...(columns ? { columns } : {}) } });
  return summary(r.board);
}

export async function deleteCloudBoard(trust: Trust, board: string): Promise<void> {
  await remoteCall(trust, { method: "DELETE", path: `boards/${slugOf(board)}` });
}

export interface CloudTaskInput {
  title?: string;
  status?: string;
  order?: number;
  assignee?: string | null;
  due?: string | null;
  tags?: unknown;
  notes?: string;
  actor?: string;
  message?: string;
}

const fieldsOf = (i: CloudTaskInput) => ({
  ...(i.title !== undefined ? { title: i.title } : {}),
  ...(i.status !== undefined ? { status: i.status } : {}),
  ...(i.order !== undefined ? { position: i.order } : {}),
  ...(i.assignee !== undefined ? { assignee: i.assignee } : {}),
  ...(i.due !== undefined ? { due: i.due } : {}),
  ...(i.tags !== undefined ? { tags: i.tags } : {}),
  ...(i.notes !== undefined ? { notes: i.notes } : {}),
});

/** A line the caller asked for beside its change (`message`), signed like the change. */
async function withMessage(trust: Trust, board: string, n: number, message: string | undefined, actor: string | undefined): Promise<void> {
  if (message?.trim()) await remoteCall(trust, { method: "POST", path: `boards/${slugOf(board)}/tasks/${n}/log`, body: { entry: message.trim() }, actor });
}

export async function createCloudTask(trust: Trust, board: string, input: CloudTaskInput & { title: string }): Promise<TaskDetail & CloudMark> {
  const r = await remoteCall<{ task: RemoteTaskDetail }>(trust, { method: "POST", path: `boards/${slugOf(board)}/tasks`, body: fieldsOf(input), actor: input.actor });
  if (input.message?.trim()) return logCloudTask(trust, board, String(r.task.number), input.message, input.actor);
  return detail(board, r.task);
}

export async function saveCloudTask(trust: Trust, board: string, t: string, input: CloudTaskInput): Promise<TaskDetail & CloudMark> {
  const n = numberOf(t);
  const r = await remoteCall<{ task: RemoteTaskDetail }>(trust, { method: "PUT", path: `boards/${slugOf(board)}/tasks/${n}`, body: fieldsOf(input), actor: input.actor });
  if (input.message?.trim()) {
    await withMessage(trust, board, r.task.number, input.message, input.actor);
    return getCloudTask(trust, board, n);
  }
  return detail(board, r.task);
}

/** Into a column, above `before` (a task's number or slug) or at `order`; at the end otherwise. */
export async function moveCloudTask(trust: Trust, board: string, t: string, status: string, opts: { before?: string; order?: number; message?: string; actor?: string }): Promise<TaskDetail & CloudMark> {
  let order = opts.order;
  if (order === undefined && opts.before) {
    const b = await getCloudBoard(trust, board);
    const lane = b.items.filter((x) => x.status === status).sort((x, y) => x.order - y.order);
    const i = lane.findIndex((x) => String(x.number) === numberOf(opts.before!));
    if (i >= 0) order = i === 0 ? lane[0].order - 1 : (lane[i - 1].order + lane[i].order) / 2;
  }
  return saveCloudTask(trust, board, t, { status, ...(order !== undefined ? { order } : {}), message: opts.message, actor: opts.actor });
}

/** Give the task to an agent or a person; null or "human" hands it back to the review column, as on a local board. */
export async function assignCloudTask(trust: Trust, board: string, t: string, to: string | null, opts: { message?: string; actor?: string }): Promise<TaskDetail & CloudMark> {
  if (to === null || to === "human") {
    const b = await getCloudBoard(trust, board);
    const review = b.columns.find((c) => c.review);
    return saveCloudTask(trust, board, t, { assignee: null, ...(review ? { status: review.slug } : {}), ...opts });
  }
  return saveCloudTask(trust, board, t, { assignee: to, ...opts });
}

export async function logCloudTask(trust: Trust, board: string, t: string, entry: string, actor?: string): Promise<TaskDetail & CloudMark> {
  const r = await remoteCall<{ task: RemoteTaskDetail }>(trust, { method: "POST", path: `boards/${slugOf(board)}/tasks/${numberOf(t)}/log`, body: { entry }, actor });
  return detail(board, r.task);
}

export async function deleteCloudTask(trust: Trust, board: string, t: string): Promise<void> {
  await remoteCall(trust, { method: "DELETE", path: `boards/${slugOf(board)}/tasks/${numberOf(t)}` });
}

/** An agent takes the next unassigned task of the pick column (todo, else the second), as on a local board. */
export async function pickCloudTask(trust: Trust, board: string, agent: string, column?: string): Promise<(TaskDetail & CloudMark) | null> {
  const b = await getCloudBoard(trust, board);
  const col = column ?? (b.columns.find((c) => c.slug === "todo") ?? b.columns[1] ?? b.columns[0])?.slug;
  const next = b.items.filter((x) => x.status === col && !x.assignee).sort((x, y) => x.order - y.order || x.number - y.number)[0];
  if (!next) return null;
  const work = b.columns.find((c) => c.slug === "doing" || c.slug === "progress");
  return saveCloudTask(trust, board, String(next.number), { assignee: agent, ...(work ? { status: work.slug } : {}), actor: agent });
}
