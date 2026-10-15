import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { startStubCloud, type StubCloud } from "../helpers/cloud.js";
import { makeProject, startServer, type Fixture } from "../helpers/project.js";
import type { Hub } from "../../src/server/server.js";

/**
 * The machine client (src/server/cloud.ts): the daemon registers THIS
 * MACHINE once — its relay id and secret — with every open workspace as a
 * child entry; heartbeats carry workspace changes and bring a claim made in
 * the cloud; an unclaimed machine sends no folder paths; a kraftwerk.yml
 * veto leaves a workspace out; cloud.json `enabled: false` turns it all
 * off; a standalone server (what every fixture is) never talks to the
 * cloud. A local stub stands in for the cloud and keeps its rules.
 */

interface Ws {
  id?: string;
  name: string;
  slug: string;
  root?: string;
}

describe("cloud: the daemon registers the machine", () => {
  let a: Fixture;
  let b: Fixture;
  let c: Fixture;
  let cloud: StubCloud;
  let hub: Hub;
  let cloudMod: typeof import("../../src/server/cloud.js");
  const prevEnv = { HOME: process.env.HOME, KRAFTWERK_CLOUD_URL: process.env.KRAFTWERK_CLOUD_URL };
  let version = "";

  const waitFor = async (pred: () => boolean | Promise<boolean>, ms = 8000): Promise<void> => {
    const until = Date.now() + ms;
    while (!(await pred())) {
      if (Date.now() > until) throw new Error("timed out waiting");
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const base = () => `http://127.0.0.1:${hub.port}`;
  const api = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(base() + p, { method, headers: body ? { "content-type": "application/json" } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const relay = async () => JSON.parse(await readFile(path.join(a.home, ".kraftwerk", "relay.json"), "utf8")) as { enabled: boolean; publicKey: string; secret: string };
  const machineId = async () => {
    const { relayId, fromBase64Url } = await import("../../src/client/relay.js");
    return relayId(fromBase64Url((await relay()).publicKey));
  };
  /** The workspaces of the last heartbeat that carried any, after `since`. */
  const reported = async (since: number, pred: (ws: Ws[]) => boolean): Promise<Ws[]> => {
    let found: Ws[] | undefined;
    await waitFor(() => {
      const hb = cloud.calls("heartbeat").filter((h) => h.at > since && Array.isArray(h.body.workspaces));
      const last = hb.at(-1)?.body.workspaces as Ws[] | undefined;
      if (last && pred(last)) found = last;
      return !!found;
    });
    return found!;
  };

  before(async () => {
    cloud = await startStubCloud({ interval: 1 });
    process.env.KRAFTWERK_CLOUD_URL = cloud.url;
    a = await makeProject("id: ws_alpha00001\nname: Alpha\nslug: alpha\ngit:\n  interval: 0\n");
    b = await makeProject("name: Beta\nslug: beta\ngit:\n  interval: 0\n");
    c = await makeProject("name: Secret\nslug: secret\ngit:\n  interval: 0\ncloud:\n  enabled: false\n");
    process.env.HOME = a.home;
    // The per-workspace identities of before: the machine's first start retires them.
    await mkdir(path.join(a.home, ".kraftwerk", "cloud"), { recursive: true });
    await writeFile(path.join(a.home, ".kraftwerk", "cloud", "0123456789abcdef.json"), JSON.stringify({ id: "inst-1", secret: "s" }));
    await writeFile(path.join(a.home, ".kraftwerk", "identity.json"), JSON.stringify({ handle: "alice", machine: "studio", previous: [] }));
    cloudMod = await import("../../src/server/cloud.js");
    version = await (await import("../../src/server/version.js")).getPkgVersion();
  });
  after(async () => {
    await hub?.stop();
    await cloud.close();
    for (const [k, v] of Object.entries(prevEnv)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    for (const f of [a, b, c]) await f?.cleanup();
  });

  it("a standalone server (every fixture) never talks to the cloud, even with a cloud URL set", async () => {
    const srv = await startServer(a);
    try {
      const meta = (await (await fetch(srv.url + "/api/meta")).json()) as { cloud: Record<string, unknown> };
      assert.equal(meta.cloud.state, "off");
      assert.match(String(meta.cloud.reason), /only the daemon registers/);
      await sleep(1200);
      assert.equal(cloud.hits.length, 0);
      assert.equal(existsSync(path.join(a.home, ".kraftwerk", "relay.json")), false, "no machine key from a standalone server");
    } finally {
      await srv.close();
    }
  });

  it("registers once for all open workspaces: relay id and secret, identity, no roots while unclaimed, the veto left out", async () => {
    const { startHub } = await import("../../src/server/server.js");
    hub = await startHub({ port: 0, staticDir: a.root, daemon: true });
    for (const f of [a, b, c]) await hub.open(f.root);
    const st = await cloudMod.startMachineCloud({ version, workspaces: () => hub.list(), owner: hub });
    assert.equal(st.state, "connected");

    const regs = cloud.calls("register");
    assert.equal(regs.length, 1, "one machine record, not one per workspace");
    const reg = regs[0].body;
    const r = await relay();
    assert.equal(r.enabled, false, "the machine key exists now; the relay stays off");
    assert.equal(reg.id, await machineId());
    assert.equal(reg.key, r.publicKey);
    assert.equal(reg.secret, r.secret);
    assert.equal(reg.name, "studio");
    assert.equal(reg.handle, "alice");
    assert.equal(reg.version, version);
    assert.ok(typeof reg.hostname === "string" && reg.hostname.length > 0);
    assert.match(String(reg.platform), /^(darwin|linux|win32)-/);
    assert.deepEqual(reg.workspaces, [
      { id: "ws_alpha00001", name: "Alpha", slug: "alpha" },
      { name: "Beta", slug: "beta" },
    ]);
    assert.equal(cloud.hits.some((h) => h.path.startsWith("/api/instances/")), false, "the per-instance API is gone");
    assert.equal(existsSync(path.join(a.home, ".kraftwerk", "cloud")), false, "the retired per-workspace identities are deleted");
  });

  it("reports the machine's record in /api/cloud and in each workspace's /api/meta", async () => {
    const { body } = await api("GET", "/api/cloud");
    assert.equal(body.daemon, true);
    assert.equal(body.state, "connected");
    assert.equal(body.url, cloud.url);
    assert.equal(body.id, await machineId());
    assert.equal(body.machine, "alice@studio");
    assert.equal(body.account, null);
    assert.match(String(body.claimCode), /^CODE-/);
    assert.equal(body.claimUrl, `${cloud.url}/claim/${body.claimCode}`);
    assert.equal(body.workspaces, 2);
    const meta = await api("GET", "/w/alpha/api/meta?probe=1");
    assert.equal((meta.body.cloud as { id: string }).id, body.id);
    assert.equal((meta.body.cloud as { included: boolean }).included, true);
    assert.equal(((await api("GET", "/w/secret/api/meta?probe=1")).body.cloud as { included: boolean }).included, false);
  });

  it("a claim made in the cloud arrives with a heartbeat; from then on the roots go along", async () => {
    const since = Date.now();
    cloud.claim(await machineId(), "alice@example.com");
    const ws = await reported(since, (l) => l.every((w) => typeof w.root === "string"));
    assert.deepEqual(ws.map((w) => [w.slug, w.root]), [["alpha", a.root], ["beta", b.root]]);
    const { body } = await api("GET", "/api/cloud");
    assert.equal(body.account, "alice@example.com");
    assert.equal(body.claimCode, null);
    assert.equal(body.claimUrl, null);
  });

  it("a workspace closed (or opened) changes the next heartbeat; an unchanged list is not sent again", async () => {
    let since = Date.now();
    await hub.close(b.root);
    let ws = await reported(since, (l) => l.length === 1);
    assert.deepEqual(ws.map((w) => w.slug), ["alpha"]);
    since = Date.now();
    await waitFor(() => cloud.calls("heartbeat").some((h) => h.at > since));
    await waitFor(() => cloud.calls("heartbeat").filter((h) => h.at > since).length >= 1);
    assert.equal(cloud.calls("heartbeat").filter((h) => h.at > since).at(-1)!.body.workspaces, undefined, "no list when nothing changed");
    since = Date.now();
    await hub.open(b.root);
    ws = await reported(since, (l) => l.length === 2);
    assert.deepEqual(ws.map((w) => w.slug), ["alpha", "beta"]);
  });

  it("logout (unlink through the daemon) hands out a fresh code, and the roots stop", async () => {
    const { status, body } = await api("POST", "/api/cloud/unlink");
    assert.equal(status, 200);
    assert.equal(body.account, null);
    assert.match(String(body.claimCode), /^CODE-/);
    assert.equal(cloud.calls("unlink").length, 1);
    assert.equal(cloud.calls("unlink")[0].body.secret, (await relay()).secret);
    const ws = await reported(Date.now() - 1, (l) => l.every((w) => w.root === undefined));
    assert.equal(ws.length, 2);
  });

  it("a cloud that lost the machine gets a fresh registration", async () => {
    const before = cloud.calls("register").length;
    cloud.forget(await machineId());
    await waitFor(() => cloud.calls("register").length > before);
    await waitFor(async () => (await api("GET", "/api/cloud")).body.state === "connected");
    assert.ok(cloud.machines.has(await machineId()));
  });

  it("cloud off (cloud.json) says goodbye and stops; on registers again", async () => {
    const off = await api("POST", "/api/cloud", { enabled: false });
    assert.equal(off.body.state, "off");
    assert.equal(cloud.calls("goodbye").length, 1);
    assert.deepEqual(JSON.parse(await readFile(path.join(a.home, ".kraftwerk", "cloud.json"), "utf8")), { enabled: false });
    const n = cloud.hits.length;
    await sleep(1500);
    assert.equal(cloud.hits.length, n, "nothing while off");
    // The sync `kraftwerk login` uses does not sneak past the switch.
    assert.equal((await api("POST", "/api/cloud/sync")).body.state, "off");

    const before = cloud.calls("register").length;
    const on = await api("POST", "/api/cloud", { enabled: true });
    assert.equal(on.body.state, "connected");
    assert.equal(cloud.calls("register").length, before + 1);
  });

  it("says goodbye when the daemon's hub stops; started with cloud.json off it registers nothing", async () => {
    await hub.stop();
    assert.equal(cloud.calls("goodbye").length, 2);
    assert.equal(cloudMod.cloudStatus().state, "off");

    await writeFile(path.join(a.home, ".kraftwerk", "cloud.json"), JSON.stringify({ enabled: false }));
    const { startHub } = await import("../../src/server/server.js");
    hub = await startHub({ port: 0, staticDir: a.root, daemon: true });
    await hub.open(a.root);
    const n = cloud.hits.length;
    const st = await cloudMod.startMachineCloud({ version, workspaces: () => hub.list(), owner: hub });
    assert.equal(st.state, "off");
    assert.match(String(st.reason), /turned off for this machine/);
    await sleep(1200);
    assert.equal(cloud.hits.length, n);
  });
});
