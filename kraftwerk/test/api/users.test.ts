import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { startStubCloud, type StubCloud } from "../helpers/cloud.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { Hub } from "../../src/server/server.js";

/**
 * kraftwerk.yml `users: cloud`: this machine's browser signs in with a cloud
 * account before the UI opens, and what it does is signed with that person
 * (`human:<handle>`, the uuid in chats). The stub cloud plays the cloud's
 * /signin page (`authorize`) and its exchange/verify endpoints. Scripts on
 * this machine (no Sec-Fetch-* headers) are its own shell: they act as the
 * account that claimed the machine. A `users: local` workspace beside it is
 * open as before and signed with the machine's handle. No agent runs.
 */
describe("users: cloud — signing in to a workspace's UI", { timeout: 60_000 }, () => {
  let a: Fixture;
  let b: Fixture;
  let cloud: StubCloud;
  let hub: Hub;
  let cloudMod: typeof import("../../src/server/cloud.js");
  let users: typeof import("../../src/server/users.js");
  const prevEnv = { HOME: process.env.HOME, KRAFTWERK_CLOUD_URL: process.env.KRAFTWERK_CLOUD_URL };
  const WS = "ws_team000001";
  let machineId = "";
  let session = "";

  /** A browser: says how it fetched, follows no redirects, carries the cookies given. */
  const browser = (p: string, init: { method?: string; cookie?: string; body?: unknown; origin?: boolean } = {}) =>
    fetch(`http://127.0.0.1:${hub.port}${p}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      redirect: "manual",
      headers: {
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.origin ? { origin: `http://127.0.0.1:${hub.port}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  /** A script on this machine (the CLI, curl). */
  const script = (p: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${hub.port}${p}`, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const cookieFrom = (r: Response, name: string): string => {
    const c = r.headers.getSetCookie().find((x) => x.startsWith(`${name}=`));
    return c ? c.split(";")[0] : "";
  };

  /** The whole round: /auth/signin → the cloud's page confirmed by `email` → /auth/callback. */
  const signIn = async (email: string, next = "/w/team/"): Promise<Response> => {
    const start = await browser(`/w/team/auth/signin?next=${encodeURIComponent(next)}`);
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get("location")!);
    const q = Object.fromEntries(to.searchParams) as { workspace: string; machine: string; redirect: string; state: string };
    const back = new URL(cloud.authorize(email, q));
    return browser(back.pathname + back.search, { cookie: cookieFrom(start, "kw_signin") });
  };

  before(async () => {
    cloud = await startStubCloud({ interval: 60 });
    process.env.KRAFTWERK_CLOUD_URL = cloud.url;
    a = await makeProject(`id: ${WS}\nname: Team\nslug: team\nboards: {}\nprojects: {}\nusers:\n  mode: cloud\ngit:\n  interval: 0\n`);
    b = await makeProject("id: ws_solo000001\nname: Solo\nslug: solo\nboards: {}\ngit:\n  interval: 0\n");
    process.env.HOME = a.home;
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(a.home, ".kraftwerk"), { recursive: true });
    await writeFile(path.join(a.home, ".kraftwerk", "identity.json"), JSON.stringify({ handle: "studio-owner", machine: "studio", previous: [] }));
    const { startHub } = await import("../../src/server/server.js");
    hub = await startHub({ port: 0, staticDir: a.root, daemon: true });
    await hub.open(a.root);
    await hub.open(b.root);
    cloudMod = await import("../../src/server/cloud.js");
    users = await import("../../src/server/users.js");
    assert.equal((await cloudMod.startMachineCloud({ version: "test", workspaces: () => hub.list(), owner: hub })).state, "connected");
    machineId = cloudMod.machineLink()!.creds.id;
    cloud.claim(machineId, "lukas@example.com");
    await cloudMod.syncMachineCloud();
    cloud.people.set(`${WS} mia@example.com`, "member");
    cloud.people.set(`${WS} lukas@example.com`, "owner");
  });

  after(async () => {
    users?.setUserRecheck();
    await hub?.stop();
    await cloud?.close();
    process.env.HOME = prevEnv.HOME;
    if (prevEnv.KRAFTWERK_CLOUD_URL === undefined) delete process.env.KRAFTWERK_CLOUD_URL;
    else process.env.KRAFTWERK_CLOUD_URL = prevEnv.KRAFTWERK_CLOUD_URL;
    await a?.cleanup();
    await b?.cleanup();
  });

  it("the claim names the account: account.json holds its uuid, email and handle", async () => {
    const acc = JSON.parse(await readFile(path.join(a.home, ".kraftwerk", "account.json"), "utf8"));
    assert.deepEqual([acc.email, acc.handle], ["lukas@example.com", "lukas"]);
    assert.match(acc.id, /^[0-9a-f-]{36}$/);
  });

  it("a browser that has not signed in is sent to sign in; the API answers 401 with the way there", async () => {
    const page = await browser("/w/team/projects?x=1");
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), `/w/team/auth/signin?next=${encodeURIComponent("/w/team/projects?x=1")}`);
    const api = await browser("/w/team/api/meta");
    assert.equal(api.status, 401);
    assert.deepEqual(await api.json(), { error: "sign in first", signin: "/w/team/auth/signin" });
  });

  it("this machine's scripts are its own shell: no sign-in, signed as the account that claimed the machine", async () => {
    const r = await script("/w/team/api/me");
    assert.equal(r.status, 200, await r.clone().text());
    const me = (await r.json()) as { mode: string; handle: string; signedIn: boolean; email?: string };
    assert.deepEqual([me.mode, me.handle, me.signedIn, me.email], ["cloud", "lukas", false, "lukas@example.com"]);
  });

  it("/auth/signin sends the browser to the cloud for this workspace and machine, back to this origin's /auth/callback", async () => {
    const r = await browser("/w/team/auth/signin");
    assert.equal(r.status, 302);
    const to = new URL(r.headers.get("location")!);
    assert.equal(to.origin + to.pathname, `${cloud.url}/signin`);
    assert.equal(to.searchParams.get("workspace"), WS);
    assert.equal(to.searchParams.get("machine"), machineId);
    assert.equal(to.searchParams.get("redirect"), `http://127.0.0.1:${hub.port}/w/team/auth/callback`);
    assert.match(to.searchParams.get("state")!, /^[A-Za-z0-9_-]{32}$/);
    assert.match(r.headers.getSetCookie().join(";"), /kw_signin=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
  });

  it("the callback redeems the code, opens a session and returns to where the browser was going", async () => {
    const back = await signIn("mia@example.com", "/w/team/boards");
    assert.equal(back.status, 302, await back.clone().text());
    assert.equal(back.headers.get("location"), "/w/team/boards");
    session = cookieFrom(back, "kw_user");
    assert.ok(session);
    const me = (await (await browser("/w/team/api/me", { cookie: session })).json()) as Record<string, unknown>;
    assert.deepEqual([me.mode, me.handle, me.email, me.signedIn, me.role, me.actor], ["cloud", "mia", "mia@example.com", true, "member", "human:mia"]);
    assert.match(String(me.id), /^[0-9a-f-]{36}$/);
    // The cookie is kept only as its hash.
    const stored = await readFile(path.join(a.home, ".kraftwerk", "user-sessions.json"), "utf8");
    assert.ok(!stored.includes(decodeURIComponent(session.split("=")[1])));
  });

  it("a callback that did not start in this browser, or comes twice, is refused", async () => {
    const start = await browser("/w/team/auth/signin");
    const q = Object.fromEntries(new URL(start.headers.get("location")!).searchParams) as { workspace: string; machine: string; redirect: string; state: string };
    const back = new URL(cloud.authorize("mia@example.com", q));
    assert.equal((await browser(back.pathname + back.search)).status, 400, "no kw_signin cookie");
    const ok = await browser(back.pathname + back.search, { cookie: cookieFrom(start, "kw_signin") });
    assert.equal(ok.status, 302);
    assert.equal((await browser(back.pathname + back.search, { cookie: cookieFrom(start, "kw_signin") })).status, 400, "used already");
  });

  it("what the signed-in person does is signed with their handle — a human actor in the body is not taken", async () => {
    assert.equal((await browser("/w/team/api/boards", { cookie: session, origin: true, body: { title: "Ops", slug: "ops" } })).status, 201);
    const t = await browser("/w/team/api/boards/ops/tasks", { cookie: session, origin: true, body: { title: "Book the venue", actor: "human:mallory" } });
    assert.equal(t.status, 201, await t.clone().text());
    const task = (await t.json()) as { log: string };
    assert.match(task.log, /Created in .* \(human:mia\)/);
    // An agent naming itself stands.
    const n = await browser("/w/team/api/boards/ops/tasks/1/log", { cookie: session, origin: true, body: { entry: "sources found", actor: "lisa/claude" } });
    assert.match(((await n.json()) as { log: string }).log, /sources found \(lisa\/claude\)/);
    // A chat carries the whole person.
    const c = await browser("/w/team/api/chats", { cookie: session, origin: true, body: { agent: "claude", scope: { kind: "general" } } });
    const meta = (await c.json()) as { author?: { handle: string; id?: string; email?: string } };
    assert.equal(meta.author?.handle, "mia");
    assert.match(String(meta.author?.id), /^[0-9a-f-]{36}$/);
  });

  it("a person removed in the cloud is out with the next check", async () => {
    users.setUserRecheck(0);
    cloud.people.delete(`${WS} mia@example.com`);
    assert.equal((await browser("/w/team/api/meta", { cookie: session })).status, 401);
    users.setUserRecheck();
    cloud.people.set(`${WS} mia@example.com`, "member");
  });

  it("signing out ends the session for this workspace", async () => {
    session = cookieFrom(await signIn("mia@example.com"), "kw_user");
    assert.equal((await browser("/w/team/api/meta", { cookie: session })).status, 200);
    const out = await browser("/w/team/auth/signout", { cookie: session, method: "POST", origin: true });
    assert.equal(out.status, 200);
    assert.match(out.headers.getSetCookie().join(";"), /kw_user=; .*Max-Age=0/);
    assert.equal((await browser("/w/team/api/meta", { cookie: session })).status, 401);
  });

  it("a users: local workspace beside it stays open, signed with this machine's handle", async () => {
    const me = (await (await browser("/w/solo/api/me")).json()) as { mode: string; handle: string; actor: string; signedIn: boolean };
    assert.deepEqual([me.mode, me.handle, me.actor, me.signedIn], ["local", "studio-owner", "human:studio-owner", false]);
    assert.notEqual((await browser("/w/solo/auth/signin")).status, 302, "nothing to sign in to here");
    assert.equal((await browser("/w/solo/api/boards", { origin: true, body: { title: "Ops", slug: "ops" } })).status, 201);
    const t = await browser("/w/solo/api/boards/ops/tasks", { origin: true, body: { title: "Plan" } });
    assert.match(((await t.json()) as { log: string }).log, /\(human:studio-owner\)/);
  });
});
