import * as z from "zod";
import {
  appendTaskLog,
  assignTask,
  createBoard,
  createTask,
  deleteBoard,
  deleteTask,
  ensureDefaultBoard,
  getBoard,
  getTask,
  listAllBoards,
  listBoards,
  moveTask,
  openBoards,
  pickTask,
  saveBoard,
  saveTask,
  type BoardRef,
  type SaveBoardInput,
  type TaskInput,
} from "../../core/boards.js";
import { taskSessions } from "../../core/board-wake.js";
import { fail, reply, route, statusByMessage, type Ctx } from "./router.js";

/**
 * Boards and tasks over the API. A board is addressed by its slug and, for
 * a project's board, `?project=<slug>`; a task by its folder name or its
 * bare number. Writes that change a task's column or assignee are logged
 * on the task and may wake the assignee (core/board-wake.ts).
 */
export const boardErrors = statusByMessage(/^no (board|task|project)/);

const Columns = z.array(z.union([z.string(), z.object({ slug: z.string(), label: z.string().optional(), limit: z.number().optional(), done: z.boolean().optional(), review: z.boolean().optional() })]));

const BoardFields = z.object({
  title: z.string().optional(),
  columns: Columns.optional(),
  agent: z.string().nullable().optional(),
  staleAfter: z.string().nullable().optional(),
  notes: z.string().optional(),
});

const TaskFields = z.object({
  title: z.string().optional(),
  status: z.string().optional(),
  order: z.number().optional(),
  assignee: z.string().nullable().optional(),
  due: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  refs: z.array(z.string()).optional(),
  notes: z.string().optional(),
  /** Who writes (human:user by default) and a line for the log. */
  actor: z.string().optional(),
  message: z.string().optional(),
});

const refOf = (c: Ctx<any>): BoardRef => {
  const project = c.query.get("project");
  return { ...(project ? { project } : {}), board: c.params.board };
};

const requireOn = async (): Promise<void> => {
  if ((await openBoards()).off) fail(409, "boards are off");
};

export const boardRoutes = [
  route({ name: "boards.list", method: "GET", path: "/api/boards", summary: "the boards: a project's with ?project=, every board with ?all=1, else the workspace's" }, async (c) => {
    if (c.query.get("all") === "1") {
      const opened = await openBoards();
      return { enabled: !opened.off && !!opened.root, ...(opened.root ? { root: opened.root } : {}), boards: await listAllBoards(), ...(opened.error ? { error: opened.error } : {}) };
    }
    return listBoards(c.query.get("project") ?? undefined);
  }),
  route(
    {
      name: "boards.create",
      method: "POST",
      path: "/api/boards",
      summary: "create a board {title, slug?, project?, columns?, agent?, notes?}",
      errors: boardErrors,
      body: z.object({ title: z.string(), slug: z.string().optional(), project: z.string().optional(), columns: Columns.optional(), agent: z.string().optional(), notes: z.string().optional() }),
    },
    async (c) => {
      await requireOn();
      return reply(201, await createBoard(await c.body()));
    },
  ),
  route({ name: "boards.get", method: "GET", path: "/api/boards/:board", summary: "columns, rules, counts and every task (?project=)", errors: boardErrors }, async (c) => {
    await requireOn();
    const ref = refOf(c);
    return (await getBoard(ref)) ?? fail(404, `no board "${ref.board}"`);
  }),
  route({ name: "boards.save", method: "PUT", path: "/api/boards/:board", summary: "save title, columns, default agent, stale_after, rules", errors: boardErrors, body: BoardFields }, async (c) => {
    await requireOn();
    return saveBoard(refOf(c), (await c.body()) as SaveBoardInput);
  }),
  route({ name: "boards.delete", method: "DELETE", path: "/api/boards/:board", summary: "move the board, tasks and all, to the trash", errors: boardErrors }, async (c) => {
    await requireOn();
    await deleteBoard(refOf(c));
    return { ok: true };
  }),
  route(
    {
      name: "boards.ensure",
      method: "POST",
      path: "/api/boards/default",
      summary: "the project's (or workspace's) default board `tasks`, created on first use {project?}",
      errors: boardErrors,
      body: z.object({ project: z.string().optional() }),
    },
    async (c) => {
      await requireOn();
      const ref = await ensureDefaultBoard((await c.body()).project);
      return (await getBoard(ref))!;
    },
  ),
  route(
    {
      name: "tasks.create",
      method: "POST",
      path: "/api/boards/:board/tasks",
      summary: "create a task {title, status?, assignee?, due?, tags?, refs?, notes?, actor?, message?} (an assigned agent in a work column is woken)",
      errors: boardErrors,
      body: TaskFields.extend({ title: z.string() }),
    },
    async (c) => {
      await requireOn();
      return reply(201, await createTask(refOf(c), (await c.body()) as TaskInput & { actor?: string; message?: string }));
    },
  ),
  route({ name: "tasks.get", method: "GET", path: "/api/boards/:board/tasks/:task", summary: "the task: fields, markdown, files, log and the sessions that worked on it (:task = folder name or number)", errors: boardErrors }, async (c) => {
    await requireOn();
    const task = (await getTask(refOf(c), c.params.task)) ?? fail(404, `no task "${c.params.task}"`);
    return { ...task, sessions: await taskSessions(task.ref) };
  }),
  route({ name: "tasks.save", method: "PUT", path: "/api/boards/:board/tasks/:task", summary: "save fields and markdown; a status or assignee change is logged (message?)", errors: boardErrors, body: TaskFields }, async (c) => {
    await requireOn();
    const { actor, message, ...fields } = await c.body();
    return saveTask(refOf(c), c.params.task, fields as TaskInput, { actor, message });
  }),
  route(
    {
      name: "tasks.move",
      method: "POST",
      path: "/api/boards/:board/tasks/:task/move",
      summary: "put the task into a column {status, before?, order?, message?, actor?}",
      errors: boardErrors,
      body: z.object({ status: z.string(), before: z.string().optional(), order: z.number().optional(), message: z.string().optional(), actor: z.string().optional() }),
    },
    async (c) => {
      await requireOn();
      const { status, ...opts } = await c.body();
      return moveTask(refOf(c), c.params.task, status, opts);
    },
  ),
  route(
    {
      name: "tasks.assign",
      method: "POST",
      path: "/api/boards/:board/tasks/:task/assign",
      summary: 'give the task to an agent {to, message?, actor?}; to = null or "human" hands it back to the review column',
      errors: boardErrors,
      body: z.object({ to: z.string().nullable(), message: z.string().optional(), actor: z.string().optional() }),
    },
    async (c) => {
      await requireOn();
      const { to, ...opts } = await c.body();
      return assignTask(refOf(c), c.params.task, to, opts);
    },
  ),
  route(
    {
      name: "tasks.log",
      method: "POST",
      path: "/api/boards/:board/tasks/:task/log",
      summary: "append a stamped line {entry, actor?} to the task's log",
      errors: boardErrors,
      body: z.object({ entry: z.string(), actor: z.string().optional() }),
    },
    async (c) => {
      await requireOn();
      const { entry, actor } = await c.body();
      return appendTaskLog(refOf(c), c.params.task, entry, actor);
    },
  ),
  route(
    {
      name: "tasks.pick",
      method: "POST",
      path: "/api/boards/:board/pick",
      summary: "an agent takes the next task of the pick column {agent, column?}; null when there is none",
      errors: boardErrors,
      body: z.object({ agent: z.string(), column: z.string().optional() }),
    },
    async (c) => {
      await requireOn();
      const { agent, column } = await c.body();
      return { task: await pickTask(refOf(c), agent, { column }) };
    },
  ),
  route({ name: "tasks.delete", method: "DELETE", path: "/api/boards/:board/tasks/:task", summary: "move the task folder to the trash", errors: boardErrors }, async (c) => {
    await requireOn();
    await deleteTask(refOf(c), c.params.task);
    return { ok: true };
  }),
];
