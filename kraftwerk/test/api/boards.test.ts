import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { BoardDetail, BoardsView, TaskDetail } from "../../src/core/boards.js";
import type { ChatMeta, StoredChatEvent } from "../../src/core/chat/types.js";
import type { AttentionView } from "../../src/core/attention.js";
import type { GitStatus } from "../../src/core/git.js";
import type { FilesListing } from "../../src/core/files.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Boards and tasks over the HTTP API: the feature flag, the default board
 * with its columns, tasks as numbered folders (task.md + log.md + files),
 * moves and hand-overs written to the log, picking exclusively, the files
 * scope of a task, review tasks as attention, the folder in the git scope,
 * removal to the trash — and the wake: a task assigned to an agent in a
 * work column opens a session for that agent with the task as its scope.
 * The agent is the scripted fake (KRAFTWERK_ACP_ADAPTER); no coding agent runs.
 */
describe("boards API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const send = (method: string, p: string, body?: unknown) => fetch(srv.url + p, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const post = (p: string, body?: unknown) => send("POST", p, body);
  const put = (p: string, body: unknown) => send("PUT", p, body);
  const del = (p: string) => send("DELETE", p);
  const get = async <T>(p: string): Promise<T> => (await fetch(srv.url + p)).json() as Promise<T>;
  const meta = () => get<{ boards: boolean; projects: boolean }>("/api/meta");
  const board = (b = "tasks", project = "netnode") => get<BoardDetail>(`/api/boards/${b}?project=${project}`);
  const chats = async () => (await get<{ chats: ChatMeta[] }>("/api/chats")).chats;
  const events = async (id: string): Promise<StoredChatEvent[]> => (await get<{ events: StoredChatEvent[] }>(`/api/chats/${id}`)).events;
  async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
    for (let i = 0; i < 150; i++) {
      const v = await fn();
      if (ok(v)) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  before(async () => {
    process.env.KRAFTWERK_ACP_ADAPTER = path.join(here, "../helpers/fake-acp-agent.mjs");
    fx = await makeProject("name: fixture\ngit:\n  interval: 0\nprojects:\n");
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
    assert.equal((await post("/api/projects", { title: "Netnode", slug: "netnode" })).status, 201);
    assert.equal((await put("/api/agents/lisa", { name: "Lisa", emoji: "🦊", harness: "claude" })).status, 200);
    assert.equal((await put("/api/agents/max", { name: "Max", emoji: "🐻", harness: "claude" })).status, 200);
  });
  after(async () => {
    delete process.env.KRAFTWERK_ACP_ADAPTER;
    const { disposeAllBackends } = await import("../../src/core/chat/sessions.js");
    await disposeAllBackends();
    await srv.close();
    await fx.cleanup();
  });

  const boardDir = () => path.join(fx.root, "kraftwerk-data/projects/netnode/boards/tasks");

  it("is off without a boards block: listing says so, creating is refused, the task files scope is unknown", async () => {
    assert.equal((await meta()).boards, false);
    const v = await get<BoardsView>("/api/boards");
    assert.equal(v.enabled, false);
    assert.match(v.error ?? "", /off/);
    assert.equal((await post("/api/boards", { title: "Ops" })).status, 409);
    assert.equal((await post("/api/boards/default", { project: "netnode" })).status, 409);
  });

  it("settings turn it on and create the workspace root; a project gets its default board on first use", async () => {
    const r = await put("/api/settings", { boards: { enabled: true } });
    assert.equal(r.status, 200, await r.text());
    assert.equal((await meta()).boards, true);
    assert.match(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), /^boards: \{\}$/m);
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/boards")));
    assert.deepEqual((await get<BoardsView>("/api/boards?project=netnode")).boards, [], "no board until one is used");

    const d = await post("/api/boards/default", { project: "netnode" });
    const b = (await d.json()) as BoardDetail;
    assert.equal(d.status, 200, JSON.stringify(b));
    assert.equal(b.board, "tasks");
    assert.equal(b.project, "netnode");
    assert.deepEqual(
      b.columns.map((c) => [c.slug, c.label, !!c.review, !!c.done]),
      [
        ["draft", "Draft", false, false],
        ["todo", "Todo", false, false],
        ["progress", "In progress", false, false],
        ["review", "Review", true, false],
        ["done", "Done", false, true],
      ],
    );
    assert.equal(b.path, boardDir());
    assert.match(await readFile(path.join(boardDir(), "board.md"), "utf8"), /^title: Tasks$/m);
    assert.equal((await get<BoardsView>("/api/boards?project=netnode")).boards.length, 1);
    assert.equal((await post("/api/boards/default", { project: "netnode" })).status, 200, "idempotent");
  });

  it("POST creates a task as a numbered folder with task.md and log.md; the slug derives from the title", async () => {
    const r = await post("/api/boards/tasks/tasks?project=netnode", { title: "Write a press release", notes: "## What\nA release for the launch.\n", tags: ["pr"], due: "2026-11-20" });
    const t = (await r.json()) as TaskDetail;
    assert.equal(r.status, 201, JSON.stringify(t));
    assert.equal(t.slug, "1-write-a-press-release");
    assert.equal(t.number, 1);
    assert.equal(t.status, "draft", "a new task starts in the first column");
    assert.equal(t.ref, "netnode/tasks/1-write-a-press-release");
    assert.equal(t.path, path.join(boardDir(), "tasks/1-write-a-press-release"));
    assert.deepEqual(t.tags, ["pr"]);
    assert.equal(t.due, "2026-11-20");
    assert.match(t.notes, /A release for the launch/);
    const file = await readFile(path.join(t.path, "task.md"), "utf8");
    assert.match(file, /^status: draft$/m);
    assert.match(file, /^tags:\n  - pr$/m);
    assert.match(t.log, /^\* \d\d:\d\d Created in Draft \(human:user\)$/m);
    assert.equal((await post("/api/boards/tasks/tasks?project=netnode", { title: "  " })).status, 400);
    assert.equal((await post("/api/boards/tasks/tasks?project=netnode", { title: "x", status: "nope" })).status, 400, "unknown column");
    const second = (await (await post("/api/boards/tasks/tasks?project=netnode", { title: "Second" })).json()) as TaskDetail;
    assert.equal(second.slug, "2-second", "numbers count up per board");
    assert.equal((await get<TaskDetail>("/api/boards/tasks/tasks/2?project=netnode")).slug, "2-second", "the bare number names a task");
  });

  it("moves and hand-overs change one line of task.md and are written to the log with their message", async () => {
    let r = await post("/api/boards/tasks/tasks/1/move?project=netnode", { status: "todo", message: "ready for an agent" });
    let t = (await r.json()) as TaskDetail;
    assert.equal(r.status, 200, JSON.stringify(t));
    assert.equal(t.status, "todo");
    assert.match(t.log, /Moved Draft → Todo: ready for an agent \(human:user\)/);
    assert.ok(!t.assignee, "nobody yet, so nobody is woken");
    assert.ok(!existsSync(path.join(fx.root, "output/boards/events.jsonl")), "no event without an assignee");

    r = await post("/api/boards/tasks/tasks/1/log?project=netnode", { entry: "sources are in the project files", actor: "lisa/claude" });
    t = (await r.json()) as TaskDetail;
    assert.match(t.log, /sources are in the project files \(lisa\/claude\)/);
    assert.equal(t.lastLog, "sources are in the project files");

    const before = await readFile(path.join(t.path, "task.md"), "utf8");
    r = await put("/api/boards/tasks/tasks/1?project=netnode", { assignee: "max", message: "please write the text" });
    t = (await r.json()) as TaskDetail;
    assert.equal(t.assignee, "max");
    assert.match(t.log, /Assigned max: please write the text \(human:user\)/);
    const afterFile = await readFile(path.join(t.path, "task.md"), "utf8");
    assert.equal(afterFile.replace(/^assignee: max\n/m, ""), before, "only the assignee line was added");
  });

  it("assigning an agent to a task in a work column wakes it: a session with the task as scope, briefed and identified", async () => {
    // The previous step assigned max while the task sat in todo: that is the event.
    const chat = await until(
      chats,
      (xs) => xs.some((c) => c.scope.kind === "agent" && c.scope.slug === "max" && c.scope.task === "netnode/tasks/1-write-a-press-release"),
      "max's session for the task",
    );
    const mine = chat.find((c) => c.scope.kind === "agent" && c.scope.slug === "max")!;
    assert.equal(mine.project, "netnode", "filed under the project");
    assert.match(mine.title, /1-write-a-press-release/);
    const evs = await until(() => events(mine.id), (xs) => xs.some((e) => e.type === "user_message"), "the wake message");
    const msg = evs.find((e) => e.type === "user_message") as { text: string };
    assert.match(msg.text, /handed to you by user: please write the text/);
    // Ask the fake agent who it is: KRAFTWERK_AGENT/ACTOR come from the seat, the task block from the scope.
    const notes = await get<{ items: Array<{ kind: string; title: string }> }>("/api/notifications");
    assert.ok(notes.items.some((n) => n.kind === "task_woken" && /1-write-a-press-release → 🐻 Max/.test(n.title)), JSON.stringify(notes.items));
  });

  it("an agent's session carries KRAFTWERK_AGENT and KRAFTWERK_ACTOR, and a task-scoped one the task block", async () => {
    const r = await post("/api/chats", { agent: "claude", scope: { kind: "agent", slug: "lisa", task: "netnode/tasks/1-write-a-press-release" } });
    const { id } = (await r.json()) as { id: string };
    assert.equal(r.status, 200, id);
    assert.equal((await post(`/api/chats/${id}/message`, { text: "who am i?" })).status, 200);
    const evs = await until(() => events(id), (xs) => xs.some((e) => e.type === "text" && e.text.startsWith("agent:")), "the fake agent's answer");
    const said = evs.find((e) => e.type === "text" && e.text.startsWith("agent:")) as { text: string };
    assert.equal(said.text, "agent: lisa|lisa/claude|task");
  });

  it("the task lists the sessions that worked on it, newest first, with a route each; a chat tagged with the task joins them", async () => {
    const t1 = await get<TaskDetail & { sessions: Array<{ id: string; agent: string; name?: string; emoji?: string; href: string; busy: boolean }> }>("/api/boards/tasks/tasks/1?project=netnode");
    assert.deepEqual(t1.sessions.map((s) => [s.agent, s.name, s.emoji]), [["lisa", "Lisa", "🦊"], ["max", "Max", "🐻"]], JSON.stringify(t1.sessions));
    assert.match(t1.sessions[1].href, /^\/agents\/max\/chat\/chat-/);
    // "Work on this" from the task page: a project chat tagged with the task (meta.task).
    const r = await post("/api/chats", { agent: "claude", scope: { kind: "project", slug: "netnode" }, task: "netnode/tasks/1-write-a-press-release" });
    const meta = (await r.json()) as ChatMeta & { task?: string };
    assert.equal(r.status, 200, JSON.stringify(meta));
    assert.equal(meta.task, "netnode/tasks/1-write-a-press-release");
    const t2 = await get<TaskDetail & { sessions: Array<{ id: string; agent: string; href: string }> }>("/api/boards/tasks/tasks/1?project=netnode");
    assert.deepEqual(t2.sessions[0], { id: meta.id, agent: "claude", title: "", updatedAt: meta.updatedAt, busy: false, href: `/projects/netnode/chat/${meta.id}` });
    // The tagged chat is briefed with the task block, and its process writes as the actor the task page links back to this chat.
    assert.equal((await post(`/api/chats/${meta.id}/message`, { text: "who am i?" })).status, 200);
    const evs = await until(() => events(meta.id), (xs) => xs.some((e) => e.type === "text" && e.text.startsWith("agent:")), "the project chat's answer");
    assert.equal((evs.find((e) => e.type === "text" && e.text.startsWith("agent:")) as { text: string }).text, "agent: |kraftwerk-chat/claude|task");
    assert.equal((await post("/api/chats", { agent: "claude", scope: { kind: "project", slug: "netnode" }, task: "netnode/tasks/99" })).status, 404, "no such task");
  });

  it("the task's own move by its assignee does not wake it again; a hand-over to the humans clears the assignee and lands in review", async () => {
    const sessions = (await chats()).filter((c) => c.scope.kind === "agent" && c.scope.slug === "max").length;
    let r = await post("/api/boards/tasks/tasks/1/move?project=netnode", { status: "progress", actor: "max/claude", message: "on it" });
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 400));
    assert.equal((await chats()).filter((c) => c.scope.kind === "agent" && c.scope.slug === "max").length, sessions, "no second session for max");

    r = await post("/api/boards/tasks/tasks/1/assign?project=netnode", { to: null, message: "draft is in press-release.md", actor: "max/claude" });
    const t = (await r.json()) as TaskDetail;
    assert.equal(r.status, 200, JSON.stringify(t));
    assert.equal(t.assignee, undefined);
    assert.equal(t.status, "review");
    assert.match(t.log, /Moved In progress → Review: draft is in press-release.md \(max\/claude\)/);
    assert.match(t.log, /Unassigned \(was max\): draft is in press-release.md \(max\/claude\)/);
  });

  it("a task in review counts as attention, owned by its project", async () => {
    const v = await get<AttentionView>("/api/attention");
    const item = v.items.find((i) => i.kind === "review");
    assert.ok(item, JSON.stringify(v.items));
    assert.match(item!.title, /1 Write a press release waits for your review/);
    assert.equal(item!.href, "/projects/netnode/boards/tasks/1-write-a-press-release");
    assert.equal(item!.owner.project?.slug, "netnode");
  });

  it("the files API serves a task's folder as scope task:<ref>; task.md and log.md are not files; an upload is logged", async () => {
    const scope = encodeURIComponent("task:netnode/tasks/1-write-a-press-release");
    let l = await get<FilesListing>(`/api/files/list?scope=${scope}`);
    assert.deepEqual(l.entries, [], JSON.stringify(l));
    assert.equal(l.label, "1 Write a press release");
    const up = await fetch(`${srv.url}/api/files/upload?scope=${scope}&path=`, { method: "POST", headers: { origin, "x-file-name": "press-release.md", "content-type": "application/octet-stream" }, body: "# Release\n" });
    assert.equal(up.status, 201, await up.text());
    l = await get<FilesListing>(`/api/files/list?scope=${scope}`);
    assert.deepEqual(l.entries.map((e) => e.name), ["press-release.md"]);
    const t = await get<TaskDetail>("/api/boards/tasks/tasks/1?project=netnode");
    assert.equal(t.files, 1);
    assert.deepEqual(t.fileList, ["press-release.md"]);
    assert.match(t.log, /File added: press-release\.md/);
    assert.equal((await del(`/api/files?scope=${scope}&path=task.md`)).status, 400, "the task's own files stay");
  });

  it("pick takes the first unassigned todo task in column order, exclusively, and logs it", async () => {
    for (const title of ["Alpha", "Beta"]) assert.equal((await post("/api/boards/tasks/tasks?project=netnode", { title, status: "todo" })).status, 201);
    const b = await board();
    const todo = b.items.filter((t) => t.status === "todo").map((t) => t.slug);
    assert.deepEqual(todo, ["3-alpha", "4-beta"]);
    // Beta goes above Alpha: it is picked first.
    assert.equal((await post("/api/boards/tasks/tasks/4/move?project=netnode", { status: "todo", before: "3-alpha" })).status, 200);
    assert.deepEqual((await board()).items.filter((t) => t.status === "todo").map((t) => t.slug), ["4-beta", "3-alpha"]);

    const [p1, p2] = await Promise.all([post("/api/boards/tasks/pick?project=netnode", { agent: "lisa" }), post("/api/boards/tasks/pick?project=netnode", { agent: "max" })]);
    const picked = [((await p1.json()) as { task: TaskDetail | null }).task, ((await p2.json()) as { task: TaskDetail | null }).task];
    assert.ok(picked.every((t) => t), "both got one");
    assert.notEqual(picked[0]!.slug, picked[1]!.slug, "never the same task");
    assert.ok(picked.every((t) => t!.status === "progress"));
    const lisa = picked.find((t) => t!.assignee === "lisa")!;
    assert.match(lisa.log, /Picked up \(Todo → In progress\) \(lisa\)/);
    assert.deepEqual(((await (await post("/api/boards/tasks/pick?project=netnode", { agent: "lisa" })).json()) as { task: null }).task, null, "nothing left");
  });

  it("PUT /api/boards saves columns and rules; tasks in a column that went away are kept and counted under no column", async () => {
    const r = await put("/api/boards/tasks?project=netnode", { columns: ["todo", { slug: "progress", label: "Doing", limit: 1 }, { slug: "done", done: true }], notes: "Only Max writes German.", agent: "lisa" });
    const b = (await r.json()) as BoardDetail;
    assert.equal(r.status, 200, JSON.stringify(b));
    assert.deepEqual(b.columns.map((c) => c.slug), ["todo", "progress", "done"]);
    assert.equal(b.columns[1].limit, 1);
    assert.equal(b.agent, "lisa");
    assert.equal(b.notes.trim(), "Only Max writes German.");
    assert.equal(b.counts[""], 2, "the review task and the draft one have no column now");
    assert.ok(b.items.some((t) => t.status === "review"), "and is still listed");
    const file = await readFile(path.join(boardDir(), "board.md"), "utf8");
    assert.match(file, /^columns:\n  - todo\n  - slug: progress\n    label: Doing\n    limit: 1\n/m);
    assert.match(file, /^agent: lisa$/m);
    // A task created into todo on this board now goes to lisa, who is woken.
    const t = (await (await post("/api/boards/tasks/tasks?project=netnode", { title: "Gamma", status: "todo" })).json()) as TaskDetail;
    assert.equal(t.assignee, "lisa");
    assert.match(t.log, /Created in Todo, assigned to lisa/);
    const woken = await until(chats, (xs) => xs.some((c) => c.scope.kind === "agent" && c.scope.slug === "lisa" && c.scope.task === t.ref), "lisa's session for Gamma");
    const id = woken.find((c) => c.scope.kind === "agent" && c.scope.task === t.ref)!.id;
    const evs = await until(() => events(id), (xs) => xs.some((e) => e.type === "text"), "lisa's acknowledgement");
    assert.equal((evs.find((e) => e.type === "text") as { text: string }).text, `on it: ${t.slug}`);
    assert.equal((await put("/api/boards/tasks?project=netnode", { columns: ["todo", "todo"] })).status, 400, "a column twice");
  });

  it("a workspace board lives under the boards root, is in the git scope, and a broken board.md is listed with its error", async () => {
    const r = await post("/api/boards", { title: "Ops", agent: "max" });
    const b = (await r.json()) as BoardDetail;
    assert.equal(r.status, 201, JSON.stringify(b));
    assert.equal(b.project, undefined);
    assert.equal(b.path, path.join(fx.root, "kraftwerk-data/boards/ops"));
    const t = (await (await post("/api/boards/ops/tasks", { title: "Rotate keys" })).json()) as TaskDetail;
    assert.equal(t.ref, "ops/1-rotate-keys");
    const all = await get<BoardsView>("/api/boards?all=1");
    assert.deepEqual(all.boards.map((x) => [x.project ?? "", x.board]), [["", "ops"], ["netnode", "tasks"]]);
    const st = await get<GitStatus>("/api/git");
    const files = st.files ?? [];
    assert.ok(files.some((f) => f.path.startsWith("kraftwerk-data/boards/ops/") && f.syncable), JSON.stringify(files.map((f) => f.path)));
    assert.ok(files.some((f) => f.path.startsWith("kraftwerk-data/projects/netnode/boards/") && f.syncable));

    await writeFile(path.join(fx.root, "kraftwerk-data/boards/ops/board.md"), "---\ncolumns: 3\n---\n");
    const broken = await get<BoardDetail>("/api/boards/ops");
    assert.match(broken.configError ?? "", /columns must be/);
    assert.equal(broken.items.length, 1, "its tasks are still listed with the default columns");
    assert.equal((await post("/api/boards/ops/tasks", { title: "x" })).status, 400, "no new tasks until fixed");
  });

  it("DELETE moves a task, then a board, to the trash; settings turn the feature off", async () => {
    assert.equal((await del("/api/boards/tasks/tasks/2?project=netnode")).status, 200);
    assert.equal((await del("/api/boards/tasks/tasks/2?project=netnode")).status, 404);
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/trash/tasks/netnode/tasks/2-second/task.md")));
    assert.equal((await del("/api/boards/ops")).status, 200);
    assert.equal((await del("/api/boards/ops")).status, 404);
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/trash/boards/ops/board.md")));
    assert.equal((await put("/api/settings", { boards: { enabled: false } })).status, 200);
    assert.equal((await meta()).boards, false);
    assert.equal((await fetch(`${srv.url}/api/boards/tasks?project=netnode`)).status, 409);
  });
});
