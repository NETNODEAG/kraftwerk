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
    a = await makeProject(`id: ${WS}\nname: Team\nslug: team\nboards: {}\nprojects: {}\nvibeables: {}\nusers:\n  mode: cloud\ngit:\n  interval: 0\n`);
    b = await makeProject("id: ws_solo000001\nname: Solo\nslug: solo\nboards: {}\ngit:\n  interval: 0\n");
    process.env.HOME = a.home;
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(a.home, ".kraftwerk"), { recursive: true });
    await writeFile(path.join(a.home, ".kraftwerk", "identity.json"), JSON.stringify({ handle: "studio-owner", machine: "studio", previous: [] }));
    const { startHub } = await import("../../src/server/server.js");
    await mkdir(path.join(a.root, "kraftwerk-data/vibeables/shop"), { recursive: true });
    await writeFile(path.join(a.root, "kraftwerk-data/vibeables/shop/index.html"), '<link rel="stylesheet" href="./style.css">');
    await writeFile(path.join(a.root, "kraftwerk-data/vibeables/shop/style.css"), "body{color:red}");
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

  it("an app's preview goes on under a pass: its sandboxed page loads its own files without the cookie", async () => {
    // Not signed in: the page waits like everything else.
    assert.match((await browser("/w/team/vibeables/shop/")).headers.get("location") ?? "", /^\/w\/team\/auth\/signin\?/);
    const to = await browser("/w/team/vibeables/shop/", { cookie: session });
    assert.equal(to.status, 302);
    const under = to.headers.get("location")!;
    assert.match(under, /^\/w\/team\/vibeables\/shop\/~\d+\.[\w-]{43}\/$/);
    // What the sandboxed page asks for: cross-site to the browser, so no cookie.
    const page = await browser(under);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") ?? "", /^sandbox /);
    const css = await browser(`${under}style.css`);
    assert.equal(css.status, 200);
    assert.equal(await css.text(), "body{color:red}");
    assert.equal((await browser(`${under}.env`)).status, 404);
    // A pass is for its app in its workspace, and cannot be made up.
    const pass = under.split("/")[5]!;
    assert.match((await browser(`/w/team/vibeables/other/${pass}/style.css`)).headers.get("location") ?? "", /\/auth\/signin\?/);
    assert.match((await browser(`/w/team/vibeables/shop/${pass.slice(0, -1)}${pass.endsWith("A") ? "B" : "A"}/style.css`)).headers.get("location") ?? "", /\/auth\/signin\?/);
    assert.match((await browser(`/w/team/vibeables/shop/~1.${"A".repeat(43)}/style.css`)).headers.get("location") ?? "", /\/auth\/signin\?/);
    // A script on this machine is its own shell: the files as before, no detour.
    assert.equal((await script("/w/team/vibeables/shop/style.css")).status, 200);
  });

  it("kraftwerk join's one-time link signs the browser in as the account, once", async () => {
    const accountId = cloudMod.cloudStatus().accountId!;
    assert.ok(accountId);
    const token = await users.issueHandoff(WS, accountId);
    assert.ok(token, "the cloud confirmed the account");
    const r = await browser(`/w/team/auth/handoff?t=${token}`);
    assert.equal(r.status, 302, await r.clone().text());
    assert.equal(r.headers.get("location"), "/w/team/");
    const me = (await (await browser("/w/team/api/me", { cookie: cookieFrom(r, "kw_user") })).json()) as Record<string, unknown>;
    assert.deepEqual([me.email, me.role, me.signedIn], ["lukas@example.com", "owner", true]);
    assert.equal((await browser(`/w/team/auth/handoff?t=${token}`)).status, 400, "used up");
    assert.equal((await browser("/w/team/auth/handoff?t=made-up")).status, 400);
    assert.equal(await users.issueHandoff(WS, "00000000-0000-0000-0000-000000000000"), null, "an account the cloud does not confirm gets none");
  });

  it("a cloud-board task handed to this machine's person: fetched on the heartbeat's count, in the bell, acknowledged; an agent not here is not claimed", async () => {
    cloud.events.push(
      { id: 41, workspaceId: WS, kind: "task_assigned", person: "lukas", board: "launch", boardTitle: "Launch", number: 3, title: "Ersatzteile bestellen", status: "todo", by: "human:mia", reason: "assigned", message: "bis Freitag", at: Date.now() },
      { id: 42, workspaceId: WS, kind: "agent_task", agent: "nobody-here", board: "launch", boardTitle: "Launch", number: 4, title: "Fotos", status: "todo", by: "human:mia", reason: "assigned", at: Date.now() },
    );
    await cloudMod.syncMachineCloud();
    const end = Date.now() + 5000;
    while (cloud.events.length && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.equal(cloud.events.length, 0, "both acknowledged");
    assert.deepEqual(cloud.acks.at(-1), { ack: [41, 42], claim: [] }, "an agent this workspace does not have is not claimed");
    const bell = (await (await script("/w/team/api/notifications")).json()) as { items: { kind: string; title: string; body?: string; href: string }[] };
    const n = bell.items.find((i) => i.kind === "task_assigned");
    assert.ok(n, JSON.stringify(bell.items));
    assert.equal(n.title, "📋 mia gave you “Ersatzteile bestellen”");
    assert.equal(n.body, "Launch · todo — bis Freitag");
    assert.equal(n.href, "/boards/@launch/3");
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

  it("remote boards go to the cloud as the caller: a signed-in browser as its person, the shell as the account, an agent as itself", async () => {
    const mia = cookieFrom(await signIn("mia@example.com"), "kw_user");
    const made = await browser("/w/team/api/remote-boards", { cookie: mia, origin: true, body: { title: "Launch" } });
    assert.equal(made.status, 201, await made.clone().text());
    assert.equal(((await made.json()) as { board: { createdBy: string } }).board.createdBy, "mia");
    const listed = (await (await script("/w/team/api/remote-boards")).json()) as { boards: unknown[]; actor: string; cloudUrl: string };
    assert.deepEqual([listed.boards.length, listed.actor, listed.cloudUrl], [1, "human:lukas", `${cloud.url}/w/${WS}`]);
    // An agent names itself; a human actor in a body is never passed on.
    await script("/w/team/api/remote-boards/launch/tasks/1/log", { entry: "draft ready", actor: "lisa/claude" });
    await browser("/w/team/api/remote-boards/launch/tasks/1/log", { cookie: mia, origin: true, body: { entry: "looks good", actor: "human:mallory" } });
    const calls = cloud.boardCalls.slice(-4).map((c) => `${c.method} ${c.user ? "mia" : "account"} ${c.actor}`);
    assert.deepEqual(calls, ["POST mia human:mia", "GET account human:lukas", "POST account lisa/claude", "POST mia human:mia"]);
    assert.equal(cloud.boardCalls.at(-4)!.user, cloud.accounts.get("mia@example.com")!.id);
  });

  it("cloud boards are boards: the boards API lists, shows and edits them as @<slug>, beside the local ones", async () => {
    const made = await script("/w/team/api/boards", { title: "Ops board", cloud: true });
    assert.equal(made.status, 201, await made.clone().text());
    assert.deepEqual(await made.json().then((b: { board: string; cloud?: boolean }) => [b.board, b.cloud]), ["@ops-board", true]);
    const list = (await (await script("/w/team/api/boards")).json()) as { boards: { board: string; cloud?: boolean; tasks: number }[]; cloud?: { offline?: boolean } };
    assert.deepEqual(list.boards.filter((b) => b.cloud).map((b) => b.board).sort(), ["@launch", "@ops-board"]);
    assert.ok(!list.cloud?.offline);

    const t = await script("/w/team/api/boards/@ops-board/tasks", { title: "Rotate the keys", status: "todo", actor: "lisa/claude" });
    assert.equal(t.status, 201, await t.clone().text());
    const task = (await t.json()) as { ref: string; number: number; slug: string; cloud?: boolean };
    assert.deepEqual([task.ref, task.number, task.slug, task.cloud], ["@ops-board/1", 1, "1-rotate-the-keys", true]);
    assert.equal(cloud.boardCalls.at(-1)!.actor, "lisa/claude");

    const moved = (await (await script("/w/team/api/boards/@ops-board/tasks/1-rotate-the-keys/move", { status: "doing" })).json()) as { status: string };
    assert.equal(moved.status, "doing");
    const back = (await (await script("/w/team/api/boards/@ops-board/tasks/1/assign", { to: null })).json()) as { status: string; assignee?: string };
    assert.deepEqual([back.status, back.assignee], ["review", undefined], "handed back to the humans: unassigned, into review");
    const shown = (await (await script("/w/team/api/boards/@ops-board/tasks/1")).json()) as { log: string; sessions: unknown[]; fileList: string[] };
    assert.match(shown.log, /^## \d{4}-\d{2}-\d{2}$/m);
    assert.match(shown.log, /^\* \d{2}:\d{2} Moved to doing \(human:lukas\)$/m);
    assert.deepEqual([shown.sessions, shown.fileList], [[], []]);
    const board = (await (await script("/w/team/api/boards/@ops-board")).json()) as { columns: { slug: string; review?: boolean; done?: boolean }[]; items: unknown[] };
    assert.deepEqual(board.columns.filter((c) => c.review || c.done).map((c) => c.slug), ["review", "done"]);
    const all = (await (await script("/w/team/api/tasks")).json()) as { tasks: { ref: string; boardTitle: string }[] };
    assert.ok(all.tasks.some((x) => x.ref === "@ops-board/1" && x.boardTitle === "Ops board"));
    assert.equal((await fetch(`http://127.0.0.1:${hub.port}/w/team/api/boards/@ops-board/tasks/1`, { method: "DELETE" })).status, 200);
    // A project never lists cloud boards: they are the workspace's.
    assert.equal((await script("/w/team/api/boards/@ops-board?project=x")).status !== 200, true);
  });

  it("offline is offline: remote boards answer 503 offline while the cloud does not", async () => {
    cloud.down = true;
    try {
      const r = await script("/w/team/api/remote-boards");
      assert.equal(r.status, 503);
      assert.equal(((await r.json()) as { offline: boolean }).offline, true);
      // The boards list still answers, its local boards in it, the cloud marked offline.
      const l = (await (await script("/w/team/api/boards")).json()) as { boards: { cloud?: boolean }[]; cloud?: { offline?: boolean } };
      assert.deepEqual([l.boards.some((b) => b.cloud), l.cloud?.offline], [false, true]);
    } finally {
      cloud.down = false;
      (await import("../../src/server/remote-boards.js")).resetRemoteDown();
    }
  });

  it("a users: local workspace beside it stays open, signed with this machine's handle", async () => {
    const me = (await (await browser("/w/solo/api/me")).json()) as { mode: string; handle: string; actor: string; signedIn: boolean };
    assert.deepEqual([me.mode, me.handle, me.actor, me.signedIn], ["local", "studio-owner", "human:studio-owner", false]);
    assert.notEqual((await browser("/w/solo/auth/signin")).status, 302, "nothing to sign in to here");
    assert.equal((await browser("/w/solo/api/boards", { origin: true, body: { title: "Ops", slug: "ops" } })).status, 201);
    const t = await browser("/w/solo/api/boards/ops/tasks", { origin: true, body: { title: "Plan" } });
    assert.match(((await t.json()) as { log: string }).log, /\(human:studio-owner\)/);
  });

  it("local or cloud is one switch: cloud does every step (id, sign-in), waits for a claim, and local goes back with the opt-out intact", async () => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const yml = path.join(b.root, "kraftwerk.yml");
    // A workspace without an id that left itself out of the cloud — what local mode looks like from the start.
    await writeFile(yml, "# the solo workspace\nname: Solo\nslug: solo\nboards: {}\ncloud:\n  enabled: false\ngit:\n  interval: 0\n");
    const before = (await (await script("/w/solo/api/workspace/cloud")).json()) as { mode: string; next: string | null; steps: Record<string, boolean> };
    assert.deepEqual([before.mode, before.steps], ["local", { machine: true, claim: true, workspace: false, signin: false }]);
    // Local is local: no cloud boards, and the boards list says why.
    assert.equal((await script("/w/solo/api/remote-boards")).status, 409);
    const listed = (await (await script("/w/solo/api/boards")).json()) as { cloud?: { local?: boolean } };
    assert.equal(listed.cloud?.local, true);

    const on = (await (await browser("/w/solo/api/workspace/cloud", { origin: true, body: { mode: "cloud" } })).json()) as { mode: string; next: string | null; steps: Record<string, boolean>; workspaceUrl: string };
    assert.deepEqual([on.mode, on.next, on.steps], ["cloud", null, { machine: true, claim: true, workspace: true, signin: true }]);
    const text = await readFile(yml, "utf8");
    const id = /^id: (ws_[a-z0-9]{10})/m.exec(text)?.[1];
    assert.ok(id, text);
    assert.match(text, /^# the solo workspace$/m, "the comments stay");
    assert.match(text, /^users:\n {2}mode: cloud$/m);
    // The opt-out of the usage report stays where it was: in cloud mode the workspace is reported anyway.
    assert.match(text, /^ {2}enabled: false$/m);
    assert.equal(on.workspaceUrl, `${cloud.url}/w/${id}`);
    const meta = (await (await script("/w/solo/api/meta")).json()) as { cloud: { included: boolean } };
    assert.equal(meta.cloud.included, true);
    // Cloud mode: this machine's browser signs in now.
    assert.equal((await browser("/w/solo/api/me")).status, 401);
    // A cloud board made in cloud mode …
    assert.equal((await script("/w/solo/api/boards", { title: "Kept", cloud: true })).status, 201);

    // Back to local: open again, the id kept.
    const off = (await (await script("/w/solo/api/workspace/cloud", { mode: "local" })).json()) as { mode: string };
    assert.equal(off.mode, "local");
    assert.match(await readFile(yml, "utf8"), /^users:\n {2}mode: local$/m);
    assert.equal((await browser("/w/solo/api/me")).status, 200);
    assert.match(await readFile(yml, "utf8"), /^ {2}enabled: false$/m, "the opt-out is still there");
    const metaLocal = (await (await script("/w/solo/api/meta")).json()) as { cloud: { included: boolean } };
    assert.equal(metaLocal.cloud.included, false, "and holds again in local mode");
    // … stays in local mode for a workspace with an id that is not opted out (as before cloud mode existed);
    // a new one needs cloud mode. (Opted out, the cloud does not know the workspace from here at all.)
    await writeFile(yml, (await readFile(yml, "utf8")).replace(/^cloud:\n {2}enabled: false\n/m, ""));
    await cloudMod.syncMachineCloud();
    const kept = (await (await script("/w/solo/api/boards")).json()) as { boards: { board: string }[]; cloud?: { local?: boolean } };
    assert.ok(kept.boards.some((x) => x.board === "@kept"));
    assert.equal(kept.cloud?.local, true);
    const refused = await script("/w/solo/api/boards", { title: "New", cloud: true });
    assert.equal(refused.status, 409);
    assert.equal(((await refused.json()) as { local?: boolean }).local, true);

    // An unclaimed machine: the switch does what it can and waits for the claim — the link to make it in the answer.
    await cloudMod.unlinkMachineCloud();
    try {
      const wait = (await (await script("/w/solo/api/workspace/cloud", { mode: "cloud" })).json()) as { mode: string; next: string; claimUrl: string; steps: Record<string, boolean> };
      assert.deepEqual([wait.mode, wait.next, wait.steps.claim, wait.steps.workspace], ["local", "claim", false, true]);
      assert.match(wait.claimUrl, /\/claim\//);
      cloud.claim(machineId, "lukas@example.com");
      const done = (await (await script("/w/solo/api/workspace/cloud", { mode: "cloud" })).json()) as { mode: string; account: string };
      assert.deepEqual([done.mode, done.account], ["cloud", "lukas@example.com"]);
    } finally {
      if (!cloud.machines.get(machineId)?.account) cloud.claim(machineId, "lukas@example.com");
      await cloudMod.syncMachineCloud();
      await script("/w/solo/api/workspace/cloud", { mode: "local" });
    }
  });

  it("deleted in the cloud: the workspace says so, and switching to cloud again gives it a fresh id", async () => {
    const { readFile: rf } = await import("node:fs/promises");
    const idOf = async () => (await rf(path.join(a.root, "kraftwerk.yml"), "utf8")).match(/^id: (\S+)/m)?.[1];
    const old = await idOf();
    assert.ok(old);
    cloud.deleted.add(old!);
    await cloudMod.syncMachineCloud();
    const st = (await (await script("/w/team/api/workspace/cloud")).json()) as { deleted?: boolean; problem?: string };
    assert.equal(st.deleted, true);
    assert.match(st.problem ?? "", /deleted in kraftwerk cloud/);
    await script("/w/team/api/workspace/cloud", { mode: "local" });
    await script("/w/team/api/workspace/cloud", { mode: "cloud" });
    const fresh = await idOf();
    assert.ok(fresh && fresh !== old, "a new id, the old one is gone for good");
    const after = (await (await script("/w/team/api/workspace/cloud")).json()) as { deleted?: boolean };
    assert.equal(after.deleted, undefined);
    cloud.deleted.clear();
  });

  it("two switches at once run one after the other: the workspace gets one id", async () => {
    const { readFile, writeFile } = await import("node:fs/promises");
    const yml = path.join(b.root, "kraftwerk.yml");
    await writeFile(yml, "name: Solo\nslug: solo\nboards: {}\ngit:\n  interval: 0\n");
    const [x, y] = await Promise.all([script("/w/solo/api/workspace/cloud", { mode: "cloud" }), script("/w/solo/api/workspace/cloud", { mode: "cloud" })]);
    assert.deepEqual([x.status, y.status], [200, 200]);
    const ids = (await readFile(yml, "utf8")).match(/^id: ws_[a-z0-9]{10}/gm) ?? [];
    assert.equal(ids.length, 1);
    await script("/w/solo/api/workspace/cloud", { mode: "local" });
  });

  it("a workspace the cloud has not heard of yet on this machine: the daemon tells it and asks again, instead of failing", async () => {
    const { writeFile } = await import("node:fs/promises");
    const yml = path.join(b.root, "kraftwerk.yml");
    // A fresh id the machine has never reported (as right after cloning and opening a workspace).
    await writeFile(yml, "id: ws_fresh00001\nname: Solo\nslug: solo\nboards: {}\nusers:\n  mode: cloud\ngit:\n  interval: 0\n");
    const r = await script("/w/solo/api/remote-boards");
    assert.equal(r.status, 200, await r.clone().text());
    await writeFile(yml, "name: Solo\nslug: solo\nboards: {}\ngit:\n  interval: 0\n");
    await cloudMod.syncMachineCloud();
  });
});
