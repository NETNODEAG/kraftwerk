import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import { ApiRequestError, createClient, type ApiResult } from "../../src/client/index.js";

/**
 * A workspace is addressed by its slug — the path form `/w/<slug>/…`, the
 * host form `<slug>.localhost`, or `ws` on a socket message — and a server
 * answers for its own slug only (one serving them all comes later). The
 * fixture's root folder is project/, so its slug is "project".
 */
describe("workspace addresses", () => {
  let fx: Fixture;
  let srv: RunningServer;

  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  /** A GET with a Host of our choosing (fetch will not send one). */
  const viaHost = (host: string, p: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const u = new URL(srv.url);
      http
        .get({ host: u.hostname, port: u.port, path: p, headers: { host: `${host}:${u.port}` } }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        })
        .on("error", reject);
    });

  it("the path form: /w/<slug>/api/… is the workspace's API; another slug is not here", async () => {
    const meta = (await (await fetch(srv.url + "/w/project/api/meta?probe=1")).json()) as ApiResult<"meta.get">;
    assert.equal(meta.workspaceSlug, "project");
    const other = await fetch(srv.url + "/w/other/api/meta");
    assert.equal(other.status, 404);
    assert.deepEqual(await other.json(), { error: 'no workspace "other" here' });
  });

  it("the host form: <slug>.localhost", async () => {
    const own = await viaHost("project.localhost", "/api/meta?probe=1");
    assert.equal(own.status, 200);
    assert.equal((JSON.parse(own.body) as { workspaceSlug: string }).workspaceSlug, "project");
    assert.equal((await viaHost("other.localhost", "/api/meta")).status, 404);
    assert.equal((await viaHost("localhost", "/api/meta")).status, 200, "no slug: the server's own");
  });

  it("the client's workspace option, and the socket under the prefix", async () => {
    const api = createClient({ baseUrl: srv.url, workspace: "project" });
    assert.equal(api.baseUrl, `${srv.url}/w/project`);
    assert.equal((await api.call("meta.get", { query: { probe: true } })).workspaceSlug, "project");
    await assert.rejects(createClient({ baseUrl: srv.url, workspace: "nope" }).call("meta.get"), (e: ApiRequestError) => e.status === 404);

    const ws = new WebSocket(`${srv.url.replace(/^http/, "ws")}/w/project/api/ws`);
    const msgs: Array<Record<string, unknown>> = [];
    ws.onmessage = (m) => msgs.push(JSON.parse(String(m.data)));
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ id: 1, ws: "project", call: "meta.get", input: { query: { probe: true } } }));
    ws.send(JSON.stringify({ id: 2, ws: "other", call: "meta.get" }));
    const until = Date.now() + 3000;
    while (Date.now() < until && !(msgs.some((m) => m.id === 1) && msgs.some((m) => m.id === 2))) await new Promise((r) => setTimeout(r, 20));
    ws.close();
    assert.equal(msgs.find((m) => m.id === 1)?.status, 200);
    assert.equal(msgs.find((m) => m.id === 2)?.status, 404);
  });
});
