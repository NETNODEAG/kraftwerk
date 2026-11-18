import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { BoardDetail, BoardsView } from "../../src/core/boards.js";

/**
 * A workspace board linked to projects (`projects:` in its board.md): it
 * stays a workspace board, and each linked project lists it after its own.
 */
describe("boards linked to projects", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const send = (method: string, p: string, body?: unknown) =>
    fetch(srv.url + p, { method, headers: { "content-type": "application/json", origin }, body: body === undefined ? undefined : JSON.stringify(body) });
  const get = async <T>(p: string): Promise<T> => (await fetch(srv.url + p)).json() as Promise<T>;
  const boardFile = () => readFile(path.join(fx.root, "kraftwerk-data/boards/ops/board.md"), "utf8");

  before(async () => {
    fx = await makeProject("name: fixture\ngit:\n  interval: 0\nprojects:\nboards:\n");
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
    for (const [title, slug] of [["Netnode", "netnode"], ["Relaunch", "relaunch"]]) assert.equal((await send("POST", "/api/projects", { title, slug })).status, 201);
    assert.equal((await send("POST", "/api/boards", { title: "Ops", slug: "ops" })).status, 201);
    assert.equal((await send("POST", "/api/boards", { title: "Tasks", slug: "tasks", project: "netnode" })).status, 201);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("links a workspace board: board.md says so, the project lists it after its own, addressed as a workspace board", async () => {
    const r = await send("PUT", "/api/boards/ops", { projects: ["netnode"] });
    const b = (await r.json()) as BoardDetail;
    assert.equal(r.status, 200, JSON.stringify(b));
    assert.deepEqual(b.projects, ["netnode"]);
    assert.match(await boardFile(), /^projects:\n  - netnode$/m);

    const v = await get<BoardsView>("/api/boards?project=netnode");
    assert.deepEqual(v.boards.map((x) => [x.project ?? null, x.board]), [["netnode", "tasks"], [null, "ops"]]);
    assert.deepEqual((await get<BoardsView>("/api/boards?project=relaunch")).boards, [], "an unlinked project does not see it");
    assert.deepEqual((await get<BoardsView>("/api/boards")).boards.map((x) => x.board), ["ops"], "it stays in the workspace list");
  });

  it("every board appears once in the list of all boards", async () => {
    const all = await get<BoardsView>("/api/boards?all=1");
    assert.deepEqual(all.boards.map((x) => [x.project ?? null, x.board]), [[null, "ops"], ["netnode", "tasks"]]);
  });

  it("refuses an unknown project, and links on a project's own board", async () => {
    let r = await send("PUT", "/api/boards/ops", { projects: ["nope"] });
    assert.equal(r.status, 404, await r.text());
    r = await send("PUT", "/api/boards/tasks?project=netnode", { projects: ["relaunch"] });
    assert.equal(r.status, 400, await r.text());
    assert.deepEqual(((await get<BoardDetail>("/api/boards/ops")).projects), ["netnode"], "a refused save changes nothing");
  });

  it("other edits keep the links; an empty list unlinks", async () => {
    let r = await send("PUT", "/api/boards/ops", { title: "Operations" });
    assert.deepEqual(((await r.json()) as BoardDetail).projects, ["netnode"]);
    r = await send("PUT", "/api/boards/ops", { projects: [] });
    assert.equal(((await r.json()) as BoardDetail).projects, undefined);
    assert.doesNotMatch(await boardFile(), /projects:/);
    assert.deepEqual((await get<BoardsView>("/api/boards?project=netnode")).boards.map((x) => x.board), ["tasks"]);
  });
});
