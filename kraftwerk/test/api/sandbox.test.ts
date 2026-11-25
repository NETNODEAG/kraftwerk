import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { startStubCloud, type StubCloud } from "../helpers/cloud.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { Hub } from "../../src/server/server.js";

/**
 * A daemon kraftwerk cloud launched for a workspace (server/sandbox.ts):
 * KRAFTWERK_PUBLIC_ORIGIN set, its UI reached through the cloud with that
 * origin's Host. Whoever comes in there signs in with their cloud account —
 * a `users: local` workspace too, a script too — and the sign-in comes back
 * to the public origin, starting at the cloud as the browser knows it
 * (KRAFTWERK_PUBLIC_CLOUD_URL). Loopback without that Host is the sandbox's
 * own shell, as on any machine. No agent runs.
 */
describe("sandbox — a daemon the cloud runs, reached through it", { timeout: 60_000 }, () => {
  let a: Fixture;
  let cloud: StubCloud;
  let hub: Hub;
  const prev = { ...process.env };
  const ORIGIN = "http://abc1234567.run.localhost:19911";
  const WS = "ws_sbx0000001";

  /** Through the cloud: the public Host, as the browser sent it (fetch would not let a Host through). */
  const outside = (p: string, init: { browser?: boolean; cookie?: string } = {}) =>
    new Promise<Response>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: hub.port,
          path: p,
          headers: { host: new URL(ORIGIN).host, ...(init.browser ? { "sec-fetch-mode": "navigate", "sec-fetch-site": "none" } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const h = new Headers();
            for (const [k, v] of Object.entries(res.headers)) for (const x of [v ?? []].flat()) h.append(k, String(x));
            resolve(new Response(res.statusCode === 302 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: h }));
          });
        },
      );
      req.on("error", reject);
      req.end();
    });

  before(async () => {
    cloud = await startStubCloud({ interval: 60 });
    process.env.KRAFTWERK_CLOUD_URL = cloud.url;
    process.env.KRAFTWERK_PUBLIC_ORIGIN = ORIGIN;
    process.env.KRAFTWERK_PUBLIC_CLOUD_URL = "http://localhost:19911";
    // users: local on purpose — a sandbox signs people in anyway.
    a = await makeProject(`id: ${WS}\nname: Sandbox\nslug: sandbox\nboards: {}\ngit:\n  interval: 0\n`);
    process.env.HOME = a.home;
    await mkdir(path.join(a.home, ".kraftwerk"), { recursive: true });
    await writeFile(path.join(a.home, ".kraftwerk", "identity.json"), JSON.stringify({ handle: "sandbox", machine: "sandbox", previous: [] }));
    const { startHub } = await import("../../src/server/server.js");
    hub = await startHub({ port: 0, staticDir: a.root, daemon: true });
    await hub.open(a.root);
    const cloudMod = await import("../../src/server/cloud.js");
    assert.equal((await cloudMod.startMachineCloud({ version: "test", workspaces: () => hub.list(), owner: hub })).state, "connected");
    cloud.claim(cloudMod.machineLink()!.creds.id, "lukas@example.com");
    await cloudMod.syncMachineCloud();
    cloud.people.set(`${WS} lukas@example.com`, "owner");
  });

  after(async () => {
    await hub?.stop();
    await cloud?.close();
    for (const k of ["HOME", "KRAFTWERK_CLOUD_URL", "KRAFTWERK_PUBLIC_ORIGIN", "KRAFTWERK_PUBLIC_CLOUD_URL"]) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    await a?.cleanup();
  });

  it("the public origin reaches the one workspace; its API wants a sign-in — a script's request as well", async () => {
    const api = await outside("/api/meta");
    assert.equal(api.status, 401);
    assert.deepEqual(await api.json(), { error: "sign in first", signin: "/auth/signin" });
    const page = await outside("/projects", { browser: true });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), `/auth/signin?next=${encodeURIComponent("/projects")}`);
  });

  it("signing in goes to the cloud as the browser reaches it and comes back to the public origin", async () => {
    const r = await outside("/auth/signin", { browser: true });
    assert.equal(r.status, 302);
    const to = new URL(r.headers.get("location")!);
    assert.equal(to.origin, "http://localhost:19911");
    assert.equal(to.searchParams.get("workspace"), WS);
    assert.equal(to.searchParams.get("redirect"), `${ORIGIN}/auth/callback`);
  });

  it("the whole round signs the person in on the public origin", async () => {
    const start = await outside("/auth/signin", { browser: true });
    const state = start.headers.getSetCookie().find((c) => c.startsWith("kw_signin="))!.split(";")[0];
    const q = Object.fromEntries(new URL(start.headers.get("location")!).searchParams) as { workspace: string; machine: string; redirect: string; state: string };
    const back = new URL(cloud.authorize("lukas@example.com", q));
    assert.equal(back.origin, ORIGIN);
    const done = await outside(back.pathname + back.search, { browser: true, cookie: state });
    assert.equal(done.status, 302, await done.clone().text());
    const session = done.headers.getSetCookie().find((c) => c.startsWith("kw_user="))!.split(";")[0];
    const me = await outside("/api/me", { cookie: session });
    assert.equal(me.status, 200);
    const who = (await me.json()) as { email?: string; runsIn?: string };
    assert.equal(who.email, "lukas@example.com");
    // The UI says so in its top bar: this workspace runs in the cloud, not on a machine.
    assert.equal(who.runsIn, "cloud");
  });

  it("inside the sandbox, loopback is its own shell (its agents' CLI)", async () => {
    const r = await fetch(`http://127.0.0.1:${hub.port}/w/sandbox/api/meta`);
    assert.equal(r.status, 200);
  });
});
