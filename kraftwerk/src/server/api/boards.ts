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
  listAllTasks,
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
import * as cloud from "../cloud-boards.js";

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
  projects: z.array(z.string()).nullable().optional(),
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
  /** Who writes (an agent or process naming itself; a person is whoever asks) and a line for the log. */
  actor: z.string().optional(),
  message: z.string().optional(),
});

const refOf = (c: Ctx<any>): BoardRef => {
  const project = c.query.get("project");
  return { ...(project ? { project } : {}), board: c.params.board };
};

/** A cloud board (`@<slug>`, server/cloud-boards.ts) — only ever at the workspace level. */
const onCloud = (c: Ctx<any>): boolean => cloud.isCloudBoard(c.params.board) && !c.query.get("project");

const requireOn = async (): Promise<void> => {
  if ((await openBoards()).off) fail(409, "boards are off");
};

export const boardRoutes = [
  route({ name: "boards.list", method: "GET", path: "/api/boards", summary: "the boards: a project's with ?project=, every board with ?all=1, else the workspace's" }, async (c) => {
    // The workspace's cloud boards follow its local ones (none in a project's list); how the cloud is doing rides along.
    const project = c.query.get("project") ?? undefined;
    const all = c.query.get("all") === "1";
    const [local, remote] = await Promise.all([
      all
        ? openBoards().then(async (opened) => ({ enabled: !opened.off && !!opened.root, ...(opened.root ? { root: opened.root } : {}), boards: await listAllBoards(), ...(opened.error ? { error: opened.error } : {}) }))
        : listBoards(project),
      project && !all ? null : cloud.listCloudBoards(c.trust),
    ]);
    if (!remote) return local;
    return { ...local, boards: [...local.boards, ...remote.boards], cloud: { ...(remote.offline ? { offline: true } : {}), ...(remote.error ? { error: remote.error } : {}) } };
  }),
  route(
    {
      name: "boards.create",
      method: "POST",
      path: "/api/boards",
      summary: "create a board {title, slug?, project?, columns?, agent?, notes?}",
      errors: boardErrors,
      body: z.object({ title: z.string(), slug: z.string().optional(), project: z.string().optional(), columns: Columns.optional(), agent: z.string().optional(), notes: z.string().optional(), cloud: z.boolean().optional() }),
    },
    async (c) => {
      const { cloud: inCloud, ...input } = await c.body();
      // In kraftwerk cloud: shared with everyone on the workspace, at the workspace level.
      if (inCloud) return reply(201, await cloud.createCloudBoard(c.trust, input));
      await requireOn();
      return reply(201, await createBoard(input));
    },
  ),
  route({ name: "boards.get", method: "GET", path: "/api/boards/:board", summary: "columns, rules, counts and every task (?project=)", errors: boardErrors }, async (c) => {
    if (onCloud(c)) return cloud.getCloudBoard(c.trust, c.params.board);
    await requireOn();
    const ref = refOf(c);
    return (await getBoard(ref)) ?? fail(404, `no board "${ref.board}"`);
  }),
  route({ name: "boards.save", method: "PUT", path: "/api/boards/:board", summary: "save title, columns, default agent, stale_after, rules", errors: boardErrors, body: BoardFields }, async (c) => {
    if (onCloud(c)) return cloud.saveCloudBoard(c.trust, c.params.board, await c.body());
    await requireOn();
    return saveBoard(refOf(c), (await c.body()) as SaveBoardInput);
  }),
  route({ name: "boards.delete", method: "DELETE", path: "/api/boards/:board", summary: "move the board, tasks and all, to the trash", errors: boardErrors }, async (c) => {
    if (onCloud(c)) await cloud.deleteCloudBoard(c.trust, c.params.board);
    else {
      await requireOn();
      await deleteBoard(refOf(c));
    }
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
      if (onCloud(c)) return reply(201, await cloud.createCloudTask(c.trust, c.params.board, await c.body()));
      await requireOn();
      return reply(201, await createTask(refOf(c), (await c.body()) as TaskInput & { actor?: string; message?: string }));
    },
  ),
  route({ name: "tasks.list", method: "GET", path: "/api/tasks", summary: "every task of every board, the workspace's, the projects' and the cloud's, each with its board and column" }, async (c) => {
    const [local, remote] = await Promise.all([openBoards().then(async (o) => (o.off ? [] : await listAllTasks())), cloud.listCloudTasks(c.trust)]);
    return { tasks: [...local, ...remote] };
  }),
  route({ name: "tasks.get", method: "GET", path: "/api/boards/:board/tasks/:task", summary: "the task: fields, markdown, files, log and the sessions that worked on it (:task = folder name or number)", errors: boardErrors }, async (c) => {
    if (onCloud(c)) {
      const t = await cloud.getCloudTask(c.trust, c.params.board, c.params.task);
      return { ...t, sessions: await taskSessions(t.ref) };
    }
    await requireOn();
    const task = (await getTask(refOf(c), c.params.task)) ?? fail(404, `no task "${c.params.task}"`);
    return { ...task, sessions: await taskSessions(task.ref) };
  }),
  route({ name: "tasks.save", method: "PUT", path: "/api/boards/:board/tasks/:task", summary: "save fields and markdown; a status or assignee change is logged (message?) and wakes an agent assigned in a work column (unless wake: false)", errors: boardErrors, body: TaskFields.extend({ wake: z.boolean().optional() }) }, async (c) => {
    const { actor, message, wake, ...fields } = await c.body();
    if (onCloud(c)) return cloud.saveCloudTask(c.trust, c.params.board, c.params.task, { ...fields, actor, message });
    await requireOn();
    return saveTask(refOf(c), c.params.task, fields as TaskInput, { actor, message, quiet: wake === false });
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
      const { status, ...opts } = await c.body();
      if (onCloud(c)) return cloud.moveCloudTask(c.trust, c.params.board, c.params.task, status, opts);
      await requireOn();
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
      const { to, ...opts } = await c.body();
      if (onCloud(c)) return cloud.assignCloudTask(c.trust, c.params.board, c.params.task, to, opts);
      await requireOn();
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
      const { entry, actor } = await c.body();
      if (onCloud(c)) return cloud.logCloudTask(c.trust, c.params.board, c.params.task, entry, actor);
      await requireOn();
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
      const { agent, column } = await c.body();
      if (onCloud(c)) return { task: await cloud.pickCloudTask(c.trust, c.params.board, agent, column) };
      await requireOn();
      return { task: await pickTask(refOf(c), agent, { column }) };
    },
  ),
  route({ name: "tasks.delete", method: "DELETE", path: "/api/boards/:board/tasks/:task", summary: "move the task folder to the trash", errors: boardErrors }, async (c) => {
    if (onCloud(c)) await cloud.deleteCloudTask(c.trust, c.params.board, c.params.task);
    else {
      await requireOn();
      await deleteTask(refOf(c), c.params.task);
    }
    return { ok: true };
  }),
];
