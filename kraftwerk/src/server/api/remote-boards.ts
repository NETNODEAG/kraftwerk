import * as z from "zod";
import { remoteCall, remoteWorkspaceUrl, requireCloudMode } from "../remote-boards.js";
import { reply, route, type Ctx } from "./router.js";

/**
 * Remote boards over this machine's API (server/remote-boards.ts): the
 * workspace's boards in kraftwerk cloud, multiplayer, beside the local
 * boards (api/boards.ts). Every call goes to the cloud as the caller's
 * person; 503 `{offline: true}` while the cloud is off or unreachable.
 * Shapes are the cloud's (kraftwerk-cloud src/boards.ts).
 */

export interface RemoteColumn {
  slug: string;
  title: string;
}

export interface RemoteBoardSummary {
  slug: string;
  title: string;
  columns: RemoteColumn[];
  counts: Record<string, number>;
  taskCount: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteTaskSummary {
  number: number;
  title: string;
  status: string;
  position: number;
  /** human:<handle> or an agent slug. */
  assignee: string | null;
  assigneeId?: string;
  due: string | null;
  tags: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  last: string | null;
}

export interface RemoteTaskDetail extends RemoteTaskSummary {
  board: string;
  notes: string;
  log: { at: number; actor: string; entry: string }[];
}

export interface RemotePerson {
  id: string;
  handle: string;
  email: string;
  role: "owner" | "member";
}

const BoardFields = z.object({
  title: z.string().optional(),
  slug: z.string().optional(),
  columns: z.array(z.object({ slug: z.string().optional(), title: z.string() })).optional(),
});

const TaskFields = z.object({
  title: z.string().optional(),
  status: z.string().optional(),
  position: z.number().optional(),
  assignee: z.string().nullable().optional(),
  due: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  /** An agent or process naming itself; a person is whoever asks. */
  actor: z.string().optional(),
});

const board = (c: Ctx<any>): string => `boards/${encodeURIComponent(c.params.board)}`;
const task = (c: Ctx<any>): string => `${board(c)}/tasks/${encodeURIComponent(c.params.task)}`;
const actorOf = (c: Ctx<any>): string | undefined => c.query.get("actor") ?? undefined;
const withoutActor = <T extends { actor?: string }>(b: T): Omit<T, "actor"> => {
  const { actor: _a, ...rest } = b;
  return rest;
};

export const remoteBoardRoutes = [
  route({ name: "remoteBoards.list", method: "GET", path: "/api/remote-boards", summary: "the workspace's remote boards in kraftwerk cloud (503 offline: true while unreachable)" }, async (c) => {
    const r = await remoteCall<{ boards: RemoteBoardSummary[]; role: "owner" | "member"; actor: string }>(c.trust, { method: "GET", path: "boards", actor: actorOf(c) });
    return { ...r, cloudUrl: await remoteWorkspaceUrl() };
  }),
  route({ name: "remoteBoards.create", method: "POST", path: "/api/remote-boards", summary: "create a remote board {title, slug?, columns?}", body: BoardFields }, async (c) => {
    await requireCloudMode();
    return reply(201, await remoteCall<{ board: RemoteBoardSummary }>(c.trust, { method: "POST", path: "boards", body: await c.body() }));
  }),
  route({ name: "remoteBoards.people", method: "GET", path: "/api/remote-boards/people", summary: "the people of the workspace (assignable as human:<handle>) and who you are there" }, async (c) =>
    remoteCall<{ people: RemotePerson[]; actor: string; role: "owner" | "member" }>(c.trust, { method: "GET", path: "people", actor: actorOf(c) }),
  ),
  route({ name: "remoteBoards.get", method: "GET", path: "/api/remote-boards/:board", summary: "a remote board: columns, counts, every task, the people" }, async (c) =>
    remoteCall<{ board: RemoteBoardSummary; tasks: RemoteTaskSummary[]; people: RemotePerson[]; actor: string }>(c.trust, { method: "GET", path: board(c), actor: actorOf(c) }),
  ),
  route({ name: "remoteBoards.save", method: "PUT", path: "/api/remote-boards/:board", summary: "rename a remote board or change its columns", body: BoardFields }, async (c) =>
    remoteCall<{ board: RemoteBoardSummary }>(c.trust, { method: "PUT", path: board(c), body: await c.body() }),
  ),
  route({ name: "remoteBoards.delete", method: "DELETE", path: "/api/remote-boards/:board", summary: "delete a remote board with its tasks (owners only; no trash)" }, async (c) =>
    remoteCall<{ ok: true }>(c.trust, { method: "DELETE", path: board(c) }),
  ),
  route({ name: "remoteTasks.create", method: "POST", path: "/api/remote-boards/:board/tasks", summary: "create a task {title, status?, assignee?, due?, tags?, notes?, actor?}", body: TaskFields }, async (c) => {
    const b = await c.body();
    return reply(201, await remoteCall<{ task: RemoteTaskDetail }>(c.trust, { method: "POST", path: `${board(c)}/tasks`, body: withoutActor(b), actor: b.actor }));
  }),
  route({ name: "remoteTasks.get", method: "GET", path: "/api/remote-boards/:board/tasks/:task", summary: "a remote task with notes and its log (:task = number)" }, async (c) =>
    remoteCall<{ task: RemoteTaskDetail }>(c.trust, { method: "GET", path: task(c), actor: actorOf(c) }),
  ),
  route({ name: "remoteTasks.save", method: "PUT", path: "/api/remote-boards/:board/tasks/:task", summary: "change a remote task (status, assignee, …); every change is logged with its actor", body: TaskFields }, async (c) => {
    const b = await c.body();
    return remoteCall<{ task: RemoteTaskDetail }>(c.trust, { method: "PUT", path: task(c), body: withoutActor(b), actor: b.actor });
  }),
  route(
    { name: "remoteTasks.log", method: "POST", path: "/api/remote-boards/:board/tasks/:task/log", summary: "add a line to a remote task's log {entry, actor?}", body: z.object({ entry: z.string(), actor: z.string().optional() }) },
    async (c) => {
      const b = await c.body();
      return remoteCall<{ task: RemoteTaskDetail }>(c.trust, { method: "POST", path: `${task(c)}/log`, body: { entry: b.entry }, actor: b.actor });
    },
  ),
  route({ name: "remoteTasks.delete", method: "DELETE", path: "/api/remote-boards/:board/tasks/:task", summary: "delete a remote task (no trash)" }, async (c) =>
    remoteCall<{ ok: true }>(c.trust, { method: "DELETE", path: task(c) }),
  ),
];
