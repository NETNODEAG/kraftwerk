import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { Hub, OpenWorkspace } from "../../src/server/server.js";

/**
 * One kraftwerk serving several workspaces (the daemon's hub), in-process:
 * each open workspace is reached by its slug only, keeps its data, `.env`,
 * background jobs, live updates, cloud registration and registry entry to
 * itself, and closing one leaves the others running. Opening, closing,
 * starting and stopping go through the hub (and the daemon file), never by
 * killing the process.
 */
const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

describe("hub: one kraftwerk, several workspaces", () => {
  let a: Fixture;
  let b: Fixture;
  let g: Fixture;
  let clash: Fixture;
  let hub: Hub;
  let alpha: OpenWorkspace;
  let beta: OpenWorkspace;
  let aliasPort = 0;
  let cloud: http.Server;
  const registered: Array<Record<string, unknown>> = [];
  const prevEnv = { HOME: process.env.HOME, KRAFTWERK_CLOUD_URL: process.env.KRAFTWERK_CLOUD_URL, SHELL_WINS: process.env.SHELL_WINS };

  const base = () => `http://127.0.0.1:${hub.port}`;
  const get = async (p: string) => {
    const r = await fetch(base() + p);
    return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> };
  };
  const post = (p: string, body: unknown) => fetch(base() + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const viaHost = (host: string, p: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port: hub.port, path: p, headers: { host: `${host}:${hub.port}` } }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        })
        .on("error", reject);
    });
  const waitFor = async (ok: () => boolean | Promise<boolean>, ms = 5000) => {
    const until = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > until) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  before(async () => {
    cloud = http.createServer((req, res) => {
      let text = "";
      req.on("data", (c) => (text += c));
      req.on("end", () => {
        const body = JSON.parse(text || "{}") as Record<string, unknown>;
        if (req.url === "/api/instances/register") registered.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(req.url === "/api/instances/register" ? { id: `id-${String(body.root).length}-${registered.length}`, secret: "s", interval: 60, account: null } : { ok: true, interval: 60 }));
      });
    });
    await new Promise<void>((r) => cloud.listen(0, "127.0.0.1", r));
    process.env.KRAFTWERK_CLOUD_URL = `http://127.0.0.1:${(cloud.address() as AddressInfo).port}`;

    aliasPort = await freePort();
    a = await makeProject("name: Alpha\nslug: alpha\ngit:\n  interval: 0\n");
    b = await makeProject("name: Beta\nslug: beta\ngit:\n  interval: 0\n");
    g = await makeProject(`name: Gamma\nslug: gamma\nport: ${aliasPort}\ngit:\n  interval: 0\n`);
    clash = await makeProject("name: Not Alpha\nslug: alpha\ngit:\n  interval: 0\n");
    await a.write(".env", "TEAM=alpha\nSHELL_WINS=from-file\n");
    await b.write(".env", "TEAM=beta\n");
    process.env.SHELL_WINS = "from-shell";
    process.env.HOME = a.home;

    const { startHub } = await import("../../src/server/server.js");
    hub = await startHub({ port: 0, staticDir: a.root, daemon: true });
    alpha = await hub.open(a.root);
    beta = await hub.open(b.root);
  });
  after(async () => {
    await hub?.stop();
    await new Promise<void>((r) => cloud.close(() => r()));
    for (const [k, v] of Object.entries(prevEnv)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    for (const f of [a, b, g, clash]) await f?.cleanup();
  });

  it("lists what it serves; its own address names no workspace", async () => {
    const list = await get("/api/hub");
    assert.equal(list.status, 200);
    const ws = (list.body as { daemon: boolean; workspaces: Array<{ slug: string; url: string; root: string }> }).workspaces;
    assert.deepEqual(ws.map((w) => [w.slug, w.url, w.root]), [
      ["alpha", `http://alpha.localhost:${hub.port}`, a.root],
      ["beta", `http://beta.localhost:${hub.port}`, b.root],
    ]);
    const page = await fetch(base() + "/");
    assert.match(await page.text(), /href="http:\/\/alpha\.localhost:\d+\/">Alpha<\/a>[\s\S]*Beta/);
    const meta = await get("/api/meta");
    assert.equal(meta.status, 404, "an API call at the daemon's address must name a workspace");
    assert.deepEqual((meta.body as { workspaces: string[] }).workspaces, ["alpha", "beta"]);
    assert.equal((await get("/api/protocol")).status, 200, "the machine's routes need none");
  });

  it("routes by slug — path and host form — and refuses a slug it does not serve", async () => {
    assert.equal((await get("/w/alpha/api/meta?probe=1")).body.workspaceSlug, "alpha");
    assert.equal(JSON.parse((await viaHost("beta.localhost", "/api/meta?probe=1")).body).workspaceSlug, "beta");
    assert.equal((await get("/w/nope/api/meta")).status, 404);
    assert.equal((await viaHost("nope.localhost", "/api/meta")).status, 404);
  });

  it("keeps each workspace's data to itself", async () => {
    assert.equal((await post("/w/alpha/api/knowledge", { name: "only-alpha" })).status, 200);
    const inAlpha = JSON.stringify((await get("/w/alpha/api/knowledge")).body);
    const inBeta = JSON.stringify((await get("/w/beta/api/knowledge")).body);
    assert.match(inAlpha, /only-alpha/);
    assert.doesNotMatch(inBeta, /only-alpha/);
    assert.ok(existsSync(path.join(a.root, "knowledge", "only-alpha")));
    assert.ok(!existsSync(path.join(b.root, "knowledge", "only-alpha")));
  });

  it("gives each workspace its own .env; a value set in the shell still wins", async () => {
    const { workspaceEnv } = await import("../../src/core/env.js");
    assert.equal(alpha.ws.run(() => workspaceEnv().TEAM), "alpha");
    assert.equal(beta.ws.run(() => workspaceEnv().TEAM), "beta");
    assert.equal(alpha.ws.run(() => workspaceEnv().SHELL_WINS), "from-shell");
    assert.equal(process.env.TEAM, undefined, "the daemon's own environment stays clean");
  });

  it("runs each workspace's background jobs and registers each with the cloud under its own address", async () => {
    const { routineSchedulerRunning } = await import("../../src/core/routines.js");
    assert.equal(alpha.ws.run(routineSchedulerRunning), true);
    assert.equal(beta.ws.run(routineSchedulerRunning), true);
    await waitFor(() => registered.length >= 2);
    assert.deepEqual(registered.map((r) => [r.root, r.url]).sort(), [
      [a.root, `http://alpha.localhost:${hub.port}`],
      [b.root, `http://beta.localhost:${hub.port}`],
    ].sort());
    const cloudOf = async (slug: string) => ((await get(`/w/${slug}/api/meta?probe=1`)).body.cloud as { state: string }).state;
    assert.equal(await cloudOf("alpha"), "connected");
    assert.equal(await cloudOf("beta"), "connected");
  });

  it("one socket reaches every workspace by `ws`; a live update stays in its workspace", async () => {
    const ws = new WebSocket(`${base().replace(/^http/, "ws")}/api/ws`);
    const msgs: Array<Record<string, unknown>> = [];
    ws.onmessage = (m) => msgs.push(JSON.parse(String(m.data)));
    await new Promise((r) => (ws.onopen = r));
    const reply = async (id: number) => {
      await waitFor(() => msgs.some((m) => m.id === id));
      return msgs.find((m) => m.id === id)!;
    };
    ws.send(JSON.stringify({ id: 1, call: "hub.list" }));
    assert.equal((await reply(1)).status, 200, "the machine's routes need no workspace");
    ws.send(JSON.stringify({ id: 2, call: "meta.get" }));
    assert.equal((await reply(2)).status, 404, "a workspace route without `ws` at the daemon's address");
    ws.send(JSON.stringify({ id: 3, ws: "beta", call: "meta.get", input: { query: { probe: true } } }));
    assert.equal(((await reply(3)).data as { workspaceSlug: string }).workspaceSlug, "beta");
    ws.send(JSON.stringify({ id: 4, ws: "nope", call: "meta.get" }));
    assert.equal((await reply(4)).status, 404);

    ws.send(JSON.stringify({ ws: "alpha", watch: "k", name: "knowledge.list", interval: 60_000 }));
    await waitFor(() => msgs.some((m) => m.watch === "k"));
    const before = msgs.filter((m) => m.watch === "k").length;
    assert.equal((await post("/w/beta/api/knowledge", { name: "beta-only" })).status, 200);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(msgs.filter((m) => m.watch === "k").length, before, "a change in beta pushed nothing to alpha's watcher");
    assert.equal((await post("/w/alpha/api/knowledge", { name: "alpha-two" })).status, 200);
    await waitFor(() => msgs.some((m) => m.watch === "k" && JSON.stringify(m.data).includes("alpha-two")));
    ws.close();

    // A socket opened for one workspace still reaches another by naming it.
    const own = new WebSocket(`${base().replace(/^http/, "ws")}/w/alpha/api/ws`);
    const got: Array<Record<string, unknown>> = [];
    own.onmessage = (m) => got.push(JSON.parse(String(m.data)));
    await new Promise((r) => (own.onopen = r));
    own.send(JSON.stringify({ id: 1, call: "meta.get", input: { query: { probe: true } } }));
    own.send(JSON.stringify({ id: 2, ws: "beta", call: "meta.get", input: { query: { probe: true } } }));
    await waitFor(() => got.some((m) => m.id === 1) && got.some((m) => m.id === 2));
    own.close();
    assert.equal((got.find((m) => m.id === 1)!.data as { workspaceSlug: string }).workspaceSlug, "alpha", "no `ws`: the socket's own");
    assert.equal((got.find((m) => m.id === 2)!.data as { workspaceSlug: string }).workspaceSlug, "beta", "`ws` names another");
  });

  it("registers each workspace for discovery; a workspace sees the others, not itself", async () => {
    const files = await readdir(path.join(a.home, ".kraftwerk", "instances"));
    const recs = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(a.home, ".kraftwerk", "instances", f), "utf8")) as Record<string, unknown>));
    assert.deepEqual(recs.filter((r) => r.hub).map((r) => r.slug).sort(), ["alpha", "beta"]);
    const { discoverInstances } = await import("../../src/core/instances.js");
    const fromBeta = await beta.ws.run(() => discoverInstances({ fresh: true }));
    assert.deepEqual(fromBeta.map((i) => [i.root, i.url, i.hub]), [[a.root, `http://alpha.localhost:${hub.port}`, true]]);
  });

  it("also listens on a workspace's own port, when it has one and it is free", async () => {
    const gamma = await hub.open(g.root);
    assert.equal(gamma.aliasPort, aliasPort);
    const r = await fetch(`http://127.0.0.1:${aliasPort}/api/meta?probe=1`);
    assert.equal(((await r.json()) as { workspaceSlug: string }).workspaceSlug, "gamma", "no slug needed on its own port");
    assert.equal(await hub.close(g.root), true);
    await assert.rejects(fetch(`http://127.0.0.1:${aliasPort}/api/meta`), "the alias closes with the workspace");
  });

  it("refuses a second workspace with a slug it already serves", async () => {
    await assert.rejects(hub.open(clash.root), /slug "alpha" is already served/);
    assert.equal(hub.list().length, 2);
  });

  it("stopping a workspace closes it in the daemon — the others and the process keep running — and starting reopens it", async () => {
    const { writeDaemonFile } = await import("../../src/core/daemon.js");
    await writeDaemonFile(hub.port, hub.list().map((o) => o.root));
    const { routineSchedulerTimer } = await import("../../src/core/routines.js");
    const { startWorkspace, stopWorkspace, listWorkspaceRecords } = await import("../../src/core/instances.js");
    // The timer itself: once the workspace closes its state is gone, so only the old handle can tell whether it was stopped.
    const timer = alpha.ws.run(routineSchedulerTimer) as (NodeJS.Timeout & { _destroyed?: boolean }) | null;
    assert.ok(timer && !timer._destroyed);

    const stopped = await beta.ws.run(() => stopWorkspace({ root: a.root }));
    assert.deepEqual(stopped, { ok: true });
    assert.equal((await get("/w/alpha/api/meta")).status, 404);
    assert.equal((await get("/w/beta/api/meta?probe=1")).status, 200);
    assert.equal(timer._destroyed, true, "alpha's routine timer was cleared: its routines no longer fire");
    const rec = (await listWorkspaceRecords()).find((r) => r.root === a.root);
    assert.ok(rec?.lastStopped && rec.lastStopped >= rec.lastStarted, "stamped as stopped");
    const files = await readdir(path.join(a.home, ".kraftwerk", "instances"));
    assert.ok(!(await Promise.all(files.map((f) => readFile(path.join(a.home, ".kraftwerk", "instances", f), "utf8")))).some((t) => t.includes('"slug":"alpha"')), "alpha's instance file is gone");

    const started = await beta.ws.run(() => startWorkspace(a.root));
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(started.url, `http://alpha.localhost:${hub.port}`);
    alpha = hub.list().find((o) => o.slug === "alpha")!;
    assert.equal((await get("/w/alpha/api/meta?probe=1")).body.workspaceSlug, "alpha");
    assert.match(JSON.stringify((await get("/w/alpha/api/knowledge")).body), /only-alpha/, "its data is where it was");
  });

  it("opening and closing are this machine's; closing what is not open is a 404", async () => {
    const { startHub } = await import("../../src/server/server.js");
    const locked = await startHub({ port: 0, staticDir: a.root, daemon: false, trustLoopback: false });
    try {
      const r = await fetch(`http://127.0.0.1:${locked.port}/api/hub/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root: b.root }) });
      assert.equal(r.status, 401);
    } finally {
      await locked.stop();
    }
    assert.equal((await post("/api/hub/close", { root: "/no/such/root" })).status, 404);
    assert.equal((await post("/api/hub/open", {})).status, 400);
  });

  it("closing a workspace disconnects its sockets; its state cannot come back; nothing reaches it any more", async () => {
    const gamma = await hub.open(g.root);
    const gammaWs = gamma.ws;
    const own = new WebSocket(`${base().replace(/^http/, "ws")}/w/gamma/api/ws`);
    const closed = new Promise<number>((r) => (own.onclose = (e) => r(e.code)));
    await new Promise((r) => (own.onopen = r));
    const root = new WebSocket(`${base().replace(/^http/, "ws")}/api/ws`);
    const msgs: Array<Record<string, unknown>> = [];
    root.onmessage = (m) => msgs.push(JSON.parse(String(m.data)));
    await new Promise((r) => (root.onopen = r));

    assert.equal(await hub.close(g.root), true);
    const code = await Promise.race([closed, new Promise<string>((r) => setTimeout(() => r("still open"), 3000))]);
    assert.equal(code, 4404, "the socket opened for it closes with it");
    root.send(JSON.stringify({ id: 9, ws: "gamma", call: "meta.get" }));
    await waitFor(() => msgs.some((m) => m.id === 9));
    root.close();
    assert.equal(msgs.find((m) => m.id === 9)?.status, 404);

    // A late callback of the closed workspace (a fetch in flight, a heartbeat) cannot recreate its state.
    const { routineSchedulerTimer } = await import("../../src/core/routines.js");
    const { workspaceOpen } = await import("../../src/core/workspace.js");
    assert.equal(gammaWs.run(workspaceOpen), false);
    assert.throws(() => gammaWs.run(routineSchedulerTimer), /workspace closed/);
  });

  it("two opens of one folder at the same time make one workspace; a missing folder is refused", async () => {
    const [x, y] = await Promise.all([hub.open(g.root), hub.open(g.root)]);
    assert.equal(x, y);
    assert.deepEqual(hub.list().map((o) => o.slug).filter((s) => s === "gamma"), ["gamma"]);
    assert.equal(await hub.close(g.root), true);
    await assert.rejects(hub.open(path.join(g.root, "no-such-folder")), /no such folder/);
  });

  it("finds the daemon only where a daemon answers — not a standalone server on its old port", async () => {
    const { startHub } = await import("../../src/server/server.js");
    const { findDaemon, writeDaemonFile } = await import("../../src/core/daemon.js");
    const standalone = await startHub({ port: 0, staticDir: a.root });
    try {
      await writeDaemonFile(standalone.port, []);
      assert.equal(await findDaemon(), null);
      await writeDaemonFile(hub.port, hub.list().map((o) => o.root));
      assert.equal((await findDaemon())?.port, hub.port);
    } finally {
      await standalone.stop();
    }
  });

  it("a workspace stays open, its jobs running, when noting it for the next start fails", async () => {
    const { startHub } = await import("../../src/server/server.js");
    const { routineSchedulerRunning } = await import("../../src/core/routines.js");
    const failing = await startHub({ port: 0, staticDir: a.root, daemon: true, onChange: () => { throw new Error("disk full"); } });
    const errors: string[] = [];
    const prev = console.error;
    console.error = (m: string) => errors.push(String(m));
    try {
      const o = await failing.open(g.root);
      assert.equal(o.ws.run(routineSchedulerRunning), true);
      assert.deepEqual(failing.list().map((x) => x.slug), ["gamma"]);
      assert.match(errors.join("\n"), /could not note the open workspaces: disk full/);
    } finally {
      console.error = prev;
      await failing.stop();
    }
  });

  it("stopping the hub closes every workspace and its registry entries", async () => {
    const { listWorkspaceRecords } = await import("../../src/core/instances.js");
    // A tab still connected must not hold the stop open.
    const tab = new WebSocket(`${base().replace(/^http/, "ws")}/w/beta/api/ws`);
    await new Promise((r) => (tab.onopen = r));
    const stopped = await Promise.race([hub.stop().then(() => "stopped"), new Promise<string>((r) => setTimeout(() => r("still waiting"), 5000))]);
    assert.equal(stopped, "stopped");
    await assert.rejects(fetch(base() + "/api/hub"));
    const files = await readdir(path.join(a.home, ".kraftwerk", "instances")).catch(() => [] as string[]);
    assert.deepEqual(files.filter((f) => f.startsWith(`${process.pid}-`)), []);
    for (const root of [a.root, b.root]) {
      const rec = (await listWorkspaceRecords()).find((r) => r.root === root);
      assert.ok(rec?.lastStopped && rec.lastStopped >= rec.lastStarted, `${root} stamped as stopped`);
    }
    hub = undefined as unknown as Hub;
  });
});
