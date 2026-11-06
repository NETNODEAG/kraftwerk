import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { BoardDetail, BoardsView, TaskDetail } from "../../src/core/boards.js";

/**
 * `kraftwerk boards` and `kraftwerk tasks` through the real bin: the flag,
 * boards per project and workspace, tasks as numbered folders, move /
 * assign / log with their log lines, the agent identity from the session
 * env (KRAFTWERK_AGENT, KRAFTWERK_ACTOR), pick, the event file for the
 * server, and removal to the trash.
 */
describe("kraftwerk boards / tasks", () => {
  let fx: Fixture;
  const run = (args: string[], env?: Record<string, string>) => cli(fx.root, fx.home, args, env ? { env } : {});
  const taskDir = (slug: string) => path.join(fx.root, "kraftwerk-data/projects/netnode/boards/tasks/tasks", slug);

  before(async () => {
    fx = await makeProject("name: fixture\ngit:\n  interval: 0\nprojects:\n");
    const r = await run(["projects", "create", "Netnode", "--slug", "netnode"]);
    assert.equal(r.code, 0, r.all);
  });
  after(() => fx.cleanup());

  it("is off without a boards block", async () => {
    const r = await run(["boards"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /boards are off/);
    await fx.write("kraftwerk.yml", "name: fixture\ngit:\n  interval: 0\nprojects:\nboards:\n");
  });

  it("the first task of a project creates its default board; the folder is numbered and holds task.md and log.md", async () => {
    let r = await run(["tasks", "create", "Write a press release", "--project", "netnode", "--notes", "## What\nA release.\n", "--json"]);
    assert.equal(r.code, 0, r.all);
    const t = json<TaskDetail>(r);
    assert.equal(t.slug, "1-write-a-press-release");
    assert.equal(t.status, "draft");
    assert.ok(existsSync(path.join(taskDir(t.slug), "task.md")));
    assert.ok(existsSync(path.join(taskDir(t.slug), "log.md")));
    assert.match(await readFile(path.join(taskDir(t.slug), "task.md"), "utf8"), /^title: Write a press release\nstatus: draft\norder: 10\ncreated: \d{4}-\d{2}-\d{2}\n---\n\n## What\nA release\.$/m);
    r = await run(["boards", "--project", "netnode", "--json"]);
    const v = json<BoardsView>(r);
    assert.deepEqual(v.boards.map((b) => [b.board, b.title, b.tasks]), [["tasks", "Tasks", 1]]);
    r = await run(["boards", "show", "tasks", "--project", "netnode"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /Draft \(1\)/);
    assert.match(r.stdout, /1  Write a press release/);
  });

  it("move, assign and log write stamped lines; the actor comes from the session env", async () => {
    let r = await run(["tasks", "move", "1", "todo", "--project", "netnode", "-m", "ready"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /1 Write a press release → todo/);
    r = await run(["tasks", "assign", "1", "lisa", "--project", "netnode", "-m", "first draft please"]);
    assert.equal(r.code, 0, r.all);
    r = await run(["tasks", "log", "1", "sources collected", "--project", "netnode"], { KRAFTWERK_ACTOR: "lisa/claude" });
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /logged on 1 \(lisa\/claude\)/);
    const log = await readFile(path.join(taskDir("1-write-a-press-release"), "log.md"), "utf8");
    assert.match(log, /^# Write a press release — log\n\n## \d{4}-\d{2}-\d{2}\n\* \d\d:\d\d sources collected \(lisa\/claude\)\n\* \d\d:\d\d Assigned lisa: first draft please \(human:user\)\n\* \d\d:\d\d Moved Draft → Todo: ready \(human:user\)\n\* \d\d:\d\d Created in Draft \(human:user\)\n$/);
    r = await run(["tasks", "show", "1", "--project", "netnode"]);
    assert.match(r.stdout, /todo · lisa/);
    assert.match(r.stdout, /folder: .*1-write-a-press-release/);
    r = await run(["tasks", "log", "1", "--tail", "1", "--project", "netnode"]);
    assert.match(r.stdout, /sources collected/);
    assert.doesNotMatch(r.stdout, /Created in Draft/);
  });

  it("the assignment left an event for the server on this machine, in the output folder (never in git)", async () => {
    const file = path.join(fx.root, "output/boards/events.jsonl");
    const lines = (await readFile(file, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { task: string; agent: string; reason: string; status: string; message?: string });
    assert.deepEqual(lines.map((e) => [e.task, e.agent, e.reason, e.status, e.message]), [["1-write-a-press-release", "lisa", "assigned", "todo", "first draft please"]]);
    assert.doesNotMatch(fx.git("status", "--porcelain", "--untracked-files=all", "kraftwerk-data"), /events\.jsonl/);
  });

  it("pick takes the next unassigned todo task for the agent of the session and moves it to progress", async () => {
    for (const title of ["Alpha", "Beta"]) assert.equal((await run(["tasks", "create", title, "--project", "netnode", "--status", "todo"])).code, 0);
    let r = await run(["tasks", "pick", "--project", "netnode"]);
    assert.equal(r.code, 1, "no agent known");
    assert.match(r.stderr, /who picks/);
    r = await run(["tasks", "pick", "--project", "netnode", "--json"], { KRAFTWERK_AGENT: "max", KRAFTWERK_ACTOR: "max/claude" });
    assert.equal(r.code, 0, r.all);
    const t = json<TaskDetail>(r);
    assert.equal(t.slug, "2-alpha");
    assert.equal(t.status, "progress");
    assert.equal(t.assignee, "max");
    assert.match(t.log, /Picked up \(Todo → In progress\) \(max\/claude\)/);
    r = await run(["tasks", "list", "--project", "netnode", "--mine", "--json"], { KRAFTWERK_AGENT: "max" });
    assert.deepEqual(json<{ items: TaskDetail[] }>(r).items.map((x) => x.slug), ["2-alpha"]);
    r = await run(["tasks", "pick", "--project", "netnode", "--as", "max"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /picked 3 Beta/);
    r = await run(["tasks", "pick", "--project", "netnode", "--as", "max"]);
    assert.equal(r.code, 3, "nothing left");
  });

  it("boards create / set / remove and a workspace board; tasks remove goes to the trash", async () => {
    let r = await run(["boards", "create", "Ops", "--agent", "max", "--columns", "todo,doing,done"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /ops → .*kraftwerk-data\/boards\/ops \(columns: todo, doing, done\)/);
    r = await run(["tasks", "create", "Rotate keys", "--board", "ops", "--status", "todo", "--json"]);
    assert.equal(r.code, 0, r.all);
    assert.equal(json<TaskDetail>(r).assignee, "max", "the board's default agent");
    assert.equal(json<TaskDetail>(r).ref, "ops/1-rotate-keys");
    await writeFile(path.join(fx.root, "rules.md"), "Keys rotate on Mondays.\n");
    r = await run(["boards", "set", "ops", "--notes-file", path.join(fx.root, "rules.md"), "--stale-after", "12h", "--json"]);
    assert.equal(r.code, 0, r.all);
    const b = json<BoardDetail>(r);
    assert.equal(b.notes.trim(), "Keys rotate on Mondays.");
    assert.equal(b.staleAfter, "12h");
    assert.match(await readFile(path.join(fx.root, "kraftwerk-data/boards/ops/board.md"), "utf8"), /^stale_after: 12h$/m);
    r = await run(["boards", "set", "ops", "--stale-after", "soon"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /stale_after must be like/);
    r = await run(["boards", "--all", "--json"]);
    assert.deepEqual(json<BoardsView>(r).boards.map((x) => `${x.project ?? ""}/${x.board}`), ["/ops", "netnode/tasks"]);

    r = await run(["tasks", "remove", "1", "--project", "netnode"]);
    assert.equal(r.code, 0, r.all);
    assert.ok(!existsSync(taskDir("1-write-a-press-release")));
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/trash/tasks/netnode/tasks/1-write-a-press-release/log.md")));
    r = await run(["boards", "remove", "ops"]);
    assert.equal(r.code, 0, r.all);
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/trash/boards/ops/tasks/1-rotate-keys/task.md")));
    r = await run(["ref", "task:2-alpha"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /Alpha · netnode\/tasks \(progress\)/);
  });
});
