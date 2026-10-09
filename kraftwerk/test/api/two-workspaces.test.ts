import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * Two workspaces served from one process: each server runs its requests
 * in its own Workspace, so roots, files and in-memory state (chat
 * sessions) never cross. This is what lets one daemon serve every
 * workspace later; today it proves no module keeps a workspace in a global.
 */
const PUBLIC = "a.example.com";

describe("two workspaces in one process", () => {
  let a: Fixture;
  let b: Fixture;
  let srvA: RunningServer;
  let srvB: RunningServer;
  const post = (srv: RunningServer, p: string, body: unknown) =>
    fetch(srv.url + p, { method: "POST", headers: { "content-type": "application/json", origin: new URL(srv.url).origin }, body: JSON.stringify(body) });
  const get = async <T>(srv: RunningServer, p: string): Promise<T> => (await (await fetch(srv.url + p)).json()) as T;

  before(async () => {
    // A is reachable through a tunnel and guarded by Cloudflare Access; B is local only.
    a = await makeProject(`name: a\ngit:\n  interval: 0\npublic: https://${PUBLIC}\ntunnel:\n  name: kraftwerk\n  access:\n    team: acme\n    aud: ${"a".repeat(64)}\n`);
    b = await makeProject();
    srvA = await startServer(a);
    srvB = await startServer(b);
  });
  after(async () => {
    await srvA.close();
    await srvB.close();
    await a.cleanup();
    await b.cleanup();
  });

  it("each server answers for its own root", async () => {
    assert.equal((await get<{ workspaceRoot: string }>(srvA, "/api/meta")).workspaceRoot, a.root);
    assert.equal((await get<{ workspaceRoot: string }>(srvB, "/api/meta")).workspaceRoot, b.root);
  });

  it("each server keeps its own gate: B starting does not lift A's Access check", async () => {
    // fetch will not send another Host; a tunnel delivers the public name as Host.
    const viaTunnel = (srv: RunningServer) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const u = new URL(srv.url + "/api/meta");
        const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: PUBLIC } }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        req.end();
      });
    const refused = await viaTunnel(srvA);
    assert.equal(refused.status, 401);
    assert.match(refused.body, /Access token missing/);
    // B has no public hostname: the name is not one it serves at all.
    assert.equal((await viaTunnel(srvB)).status, 421);
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
