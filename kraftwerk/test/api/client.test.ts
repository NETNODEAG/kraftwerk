import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import { ApiRequestError, createClient, createLive, type Client } from "../../src/client/index.js";
import { clientRoutesSource } from "../../scripts/gen-client-routes.js";

async function waitFor(ok: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * The kraftwerk client (src/client) against the real server: routes by
 * name with path parameters, query and JSON or raw bodies; `call` throws
 * the server's error, `request` hands back status and body; `url` builds
 * links; `createLive` keeps watched results current over the socket, or
 * by polling without one. Its route table is generated and must match the
 * server's.
 */
describe("client", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let api: Client;

  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
    api = createClient({ baseUrl: srv.url });
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("src/client/routes.ts is generated from the current routes (npm run gen:client)", async () => {
    assert.equal(await readFile(new URL("../../src/client/routes.ts", import.meta.url), "utf8"), clientRoutesSource());
  });

  it("calls a route by name and returns its result", async () => {
    const meta = await api.call("meta.get", { query: { probe: true } });
    assert.equal(meta.workspaceRoot, fx.root);
    const created = await api.call("knowledge.create", { body: { name: "client-made" } });
    assert.ok(created);
    assert.match(JSON.stringify(await api.call("knowledge.list")), /client-made/);
  });

  it("fills and encodes path parameters", async () => {
    await assert.rejects(api.call("knowledge.get", { bundle: "no such/bundle" }), (err: ApiRequestError) => err.status === 404 || err.status === 400);
    assert.equal(api.url("chats.attachment", { id: "c 1", name: "a&b.png" }), `${srv.url}/api/chats/c%201/attachments/a%26b.png`);
    assert.equal(api.url("files.raw", { query: { scope: "workspace", path: "a b.txt", download: true, skip: undefined } }), `${srv.url}/api/files/raw?scope=workspace&path=a+b.txt&download=1`);
    assert.throws(() => api.url("projects.get", { slug: "" }), /missing path parameter slug/);
  });

  it("call throws the server's error; request returns it", async () => {
    await assert.rejects(api.call("chats.get", { id: "nope" }), (err: ApiRequestError) => err instanceof ApiRequestError && err.status === 404 && err.message === "not found");
    const r = await api.request("chats.get", { id: "nope" });
    assert.deepEqual([r.ok, r.status, r.data], [false, 404, { error: "not found" }]);
  });

  it("live: a watch gets the current result, then the change, over the socket", async () => {
    const live = createLive({ client: api });
    try {
      const seen: string[] = [];
      const stop = live.watch("knowledge.list", undefined, { interval: 60_000 }, (d) => seen.push(JSON.stringify(d)));
      await waitFor(() => seen.length > 0 && live.connected);
      await api.call("knowledge.create", { body: { name: "live-made" } });
      await waitFor(() => seen.some((x) => x.includes("live-made")));
      stop();
    } finally {
      live.close();
    }
  });

  it("live: without a socket a watch polls over HTTP", async () => {
    // A runtime whose socket cannot connect at all.
    const none = createLive({ client: api, WebSocket: class { constructor() { throw new Error("no socket here"); } } as never });
    try {
      let n = 0;
      const stop = none.watch("meta.get", { query: { probe: true } }, { interval: 50 }, () => n++);
      await waitFor(() => n >= 2);
      assert.equal(none.connected, false);
      stop();
      // Polling slowly, a change this client makes still shows at once.
      const seen: string[] = [];
      const stopList = none.watch("knowledge.list", undefined, { interval: 60_000 }, (d) => seen.push(JSON.stringify(d)));
      await waitFor(() => seen.length > 0);
      await api.call("knowledge.create", { body: { name: "polled-made" } });
      await waitFor(() => seen.some((x) => x.includes("polled-made")), 2000);
      stopList();
    } finally {
      none.close();
    }
  });

  it("sends a Blob as the raw body (uploads)", async () => {
    const up = await api.call("files.upload", { query: { scope: "workspace", path: "" }, body: new Blob(["hello"]), headers: { "x-file-name": "hello.txt" } });
    assert.ok(up);
    const res = await fetch(api.url("files.raw", { query: { scope: "workspace", path: "hello.txt" } }));
    assert.equal(await res.text(), "hello");
  });
});
