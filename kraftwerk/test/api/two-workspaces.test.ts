import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * Two workspaces served from one process: each server runs its requests
 * in its own Workspace, so roots, files and in-memory state (chat
 * sessions) never cross. This is what lets one daemon serve every
 * workspace later; today it proves no module keeps a workspace in a global.
 */
describe("two workspaces in one process", () => {
  let a: Fixture;
  let b: Fixture;
  let srvA: RunningServer;
  let srvB: RunningServer;
  let c: Fixture;
  let srvC: RunningServer;
  const post = (srv: RunningServer, p: string, body: unknown) =>
    fetch(srv.url + p, { method: "POST", headers: { "content-type": "application/json", origin: new URL(srv.url).origin }, body: JSON.stringify(body) });
  const get = async <T>(srv: RunningServer, p: string): Promise<T> => (await (await fetch(srv.url + p)).json()) as T;

  before(async () => {
    a = await makeProject(`name: a\ngit:\n  interval: 0\n`);
    b = await makeProject();
    // C starts last and hardened: even this machine has to pair.
    c = await makeProject();
    srvA = await startServer(a);
    srvB = await startServer(b);
    srvC = await startServer(c, { trustLoopback: false });
  });
  after(async () => {
    await srvA.close();
    await srvB.close();
    await srvC.close();
    await a.cleanup();
    await b.cleanup();
    await c.cleanup();
  });

  it("each server answers for its own root", async () => {
    assert.equal((await get<{ workspaceRoot: string }>(srvA, "/api/meta")).workspaceRoot, a.root);
    assert.equal((await get<{ workspaceRoot: string }>(srvB, "/api/meta")).workspaceRoot, b.root);
  });

  it("each server keeps its own trust: C refusing unpaired callers does not make A or B refuse this machine", async () => {
    const refused = await fetch(srvC.url + "/api/chats");
    assert.equal(refused.status, 401);
    assert.equal(((await refused.json()) as { pair?: boolean }).pair, true);
    for (const srv of [srvA, srvB]) assert.equal((await fetch(srv.url + "/api/chats")).status, 200);
  });

  it("a chat started in one workspace is not a chat of the other", async () => {
    const chat = (await (await post(srvA, "/api/chats", { agent: "claude", scope: { kind: "general" } })).json()) as { id: string };
    const ids = async (srv: RunningServer) => (await get<{ chats: Array<{ id: string }> }>(srv, "/api/chats")).chats.map((c) => c.id);
    assert.ok((await ids(srvA)).includes(chat.id));
    assert.ok(!(await ids(srvB)).includes(chat.id));
    assert.equal((await fetch(`${srvB.url}/api/chats/${chat.id}`)).status, 404);
  });

  it("a knowledge bundle lands in its workspace only", async () => {
    assert.equal((await post(srvB, "/api/knowledge", { name: "only-b" })).status, 200);
    const names = async (srv: RunningServer) => JSON.stringify(await get(srv, "/api/knowledge"));
    assert.match(await names(srvB), /only-b/);
    assert.doesNotMatch(await names(srvA), /only-b/);
  });
});
