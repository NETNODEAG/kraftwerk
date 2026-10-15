import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStubCloud, type StubCloud } from "../helpers/cloud.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import { startTestRelay, type TestRelay } from "../helpers/relay.js";
import { connectTunnel, fromBase64Url, type Tunnel } from "../../src/client/relay.js";
import type { Hub } from "../../src/server/server.js";
import type { RelayLink, RelaySettings } from "../../src/server/relay.js";
import type { ChatMeta, StoredChatEvent } from "../../src/core/chat/types.js";

/**
 * Remote members (phase 4): a member token from the cloud opens a relay
 * channel scoped to ONE workspace. The daemon verifies it with the cloud
 * once and caches the answer (the stub cloud keeps the cloud's rules): the
 * session reaches its workspace and is refused everywhere else, a revoked
 * token ends it once the cache is due, a cloud outage keeps the cached
 * answer. Chats and messages carry their author; a private routine's runs
 * are hidden from remote callers (members, devices over the relay) and
 * visible here; the heartbeat reports routines only once claimed. The agent
 * is the scripted fake (KRAFTWERK_ACP_ADAPTER) — no coding agent runs.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

describe("members: a remote member reaches one workspace through the relay", { timeout: 90_000 }, () => {
  let a: Fixture;
  let b: Fixture;
  let cloud: StubCloud;
  let hub: Hub;
  let relay: TestRelay;
  let link: RelayLink;
  let settings: RelaySettings;
  let cloudMod: typeof import("../../src/server/cloud.js");
  let members: typeof import("../../src/server/members.js");
  const tunnels: Tunnel[] = [];
  const prevEnv = { HOME: process.env.HOME, KRAFTWERK_CLOUD_URL: process.env.KRAFTWERK_CLOUD_URL, KRAFTWERK_ACP_ADAPTER: process.env.KRAFTWERK_ACP_ADAPTER };
  let miaToken = "";
  let mia: Tunnel;
  let privateChat = "";
  let publicChat = "";

  const waitFor = async (ok: () => boolean | Promise<boolean>, ms = 10_000) => {
    const until = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > until) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const local = (p: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${hub.port}${p}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const open = (member?: { token: string; workspaceId: string }) =>
    connectTunnel({ relayUrl: `${relay.url.replace(/^http/, "ws")}/api/relay/client`, publicKey: fromBase64Url(settings.publicKey), ...(member ? { member } : {}) }).then((t) => {
      tunnels.push(t);
      return t;
    });
  const machineId = async () => {
    const { relayId } = await import("../../src/client/relay.js");
    return relayId(fromBase64Url(settings.publicKey));
  };

  before(async () => {
    process.env.KRAFTWERK_ACP_ADAPTER = path.join(here, "../helpers/fake-acp-agent.mjs");
    cloud = await startStubCloud({ interval: 1 });
    process.env.KRAFTWERK_CLOUD_URL = cloud.url;
    a = await makeProject("id: ws_alpha00001\nname: Alpha\nslug: alpha\ngit:\n  interval: 0\n");
    b = await makeProject("id: ws_beta000001\nname: Beta\nslug: beta\ngit:\n  interval: 0\n");
    process.env.HOME = a.home;
    await mkdir(path.join(a.home, ".kraftwerk"), { recursive: true });
    await writeFile(path.join(a.home, ".kraftwerk", "identity.json"), JSON.stringify({ handle: "alice", machine: "studio", previous: [] }));
    const { startHub } = await import("../../src/server/server.js");
    hub = await startHub({ port: 0, staticDir: a.root, daemon: true });
    await hub.open(a.root);
    await hub.open(b.root);
    cloudMod = await import("../../src/server/cloud.js");
    members = await import("../../src/server/members.js");
    assert.equal((await cloudMod.startMachineCloud({ version: "test", workspaces: () => hub.list(), owner: hub })).state, "connected");
    relay = await startTestRelay();
    const { setRelay, startRelay } = await import("../../src/server/relay.js");
    settings = await setRelay(true, relay.url);
    link = await startRelay({ port: hub.port, settings, version: "test" });
    await waitFor(() => link.status().state === "connected");
    miaToken = cloud.addMember("ws_alpha00001", { email: "mia@example.com", handle: "mia", role: "member" });
  });

  after(async () => {
    members?.setMemberCacheTtl();
    for (const t of tunnels) t.close();
    const { disposeAllBackends } = await import("../../src/core/chat/sessions.js");
    disposeAllBackends();
    // The fake agents' turns end with the backends: let them settle while their workspace is still open.
    await sleep(500);
    link?.stop();
    await relay?.close();
    await hub?.stop();
    await cloud?.close();
    for (const [k, v] of Object.entries(prevEnv)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    for (const f of [a, b]) await f?.cleanup();
  });

  it("a member's hello opens a session on that workspace: allowed there, refused everywhere else", async () => {
    mia = await open({ token: miaToken, workspaceId: "ws_alpha00001" });
    assert.deepEqual(mia.member, {
      member: { email: "mia@example.com", handle: "mia", role: "member" },
      workspace: { id: "ws_alpha00001", slug: "alpha", name: "Alpha" },
    });
    const verify = cloud.verifies()[0].body;
    assert.equal(verify.token, miaToken);
    assert.equal(verify.workspaceId, "ws_alpha00001");
    assert.equal(verify.id, await machineId(), "verified with the machine's credentials");
    assert.equal(verify.secret, settings.secret);

    const self = await mia.fetch("/w/alpha/api/devices/self");
    assert.equal(self.status, 200);
    const who = (await self.json()) as { trust: string; member: { handle: string }; workspace: { slug: string } };
    assert.equal(who.trust, "member");
    assert.equal(who.member.handle, "mia");
    assert.equal(who.workspace.slug, "alpha");
    const meta = await mia.fetch("/w/alpha/api/meta");
    assert.equal(meta.status, 200, "its workspace answers");
    const metaBody = (await meta.json()) as { workspaceRoot: string; workspaceRootLabel: string; switcher: unknown[] };
    assert.equal(metaBody.workspaceRoot, "", "no host paths for a member");
    assert.equal(metaBody.workspaceRootLabel, "");
    assert.deepEqual(metaBody.switcher, [], "no other workspaces for a member");
    assert.equal((await mia.fetch("/w/alpha/api/chats")).status, 200);

    // Everything else: another workspace, the machine's own routes, the hub page, settings.
    for (const p of ["/w/beta/api/meta", "/w/beta/api/chats", "/api/hub", "/api/devices/self", "/api/cloud", "/", "/w/alpha/api/devices", "/w/alpha/api/settings", "/w/alpha/api/hub", "/w/alpha/api/cloud", "/w/alpha/api/workspaces", "/w/alpha/api/identity"]) {
      const r = await mia.fetch(p);
      assert.equal(r.status, 403, `${p} must be refused, got ${r.status}`);
      const body = (await r.json()) as { error: string };
      assert.match(body.error, /member/, p);
    }
    const restart = await mia.fetch("/w/alpha/api/restart", { method: "POST" });
    assert.equal(restart.status, 403);
    const code = await mia.fetch("/w/alpha/api/devices/code", { method: "POST" });
    assert.equal(code.status, 403, "no pairing codes for a member");
    // A token riding along does not widen the scope.
    const { createPairCode, redeemPairCode } = await import("../../src/core/devices.js");
    const { token } = await redeemPairCode((await createPairCode()).code, "sneaky");
    assert.equal((await mia.fetch("/w/beta/api/meta", { headers: { authorization: `Bearer ${token}` } })).status, 403);
    assert.equal(cloud.verifies().length, 1, "the cached answer serves every request within the TTL");
  });

  it("a forged member tag counts for nothing", async () => {
    const dev = await open();
    const r = await dev.fetch("/w/alpha/api/meta", { headers: { "x-kraftwerk-member": "made-up" } });
    assert.equal(r.status, 401, "the relay drops the client's own x-kraftwerk-* headers");
    const direct = await fetch(`http://127.0.0.1:${hub.port}/w/alpha/api/meta`, { headers: { "x-kraftwerk-member": "made-up" } });
    assert.equal(direct.status, 401, "an unknown tag is nobody, even from this machine");
  });

  it("an unknown token, or another workspace's, gets no session", async () => {
    await assert.rejects(open({ token: "kwm_nope", workspaceId: "ws_alpha00001" }), /unknown or revoked/);
    const ben = cloud.addMember("ws_beta000001", { email: "ben@example.com", handle: "ben", role: "owner" });
    await assert.rejects(open({ token: ben, workspaceId: "ws_alpha00001" }), /unknown or revoked/);
    await assert.rejects(open({ token: miaToken, workspaceId: "ws_gamma00001" }), /does not host/);
    // Ben's own workspace works, and stays his only one.
    const t = await open({ token: ben, workspaceId: "ws_beta000001" });
    assert.equal(t.member?.workspace.slug, "beta");
    assert.equal((await t.fetch("/w/beta/api/meta")).status, 200);
    assert.equal((await t.fetch("/w/alpha/api/meta")).status, 403);
  });

  it("chats and messages carry their author: this machine's handle locally, the member's over the relay", async () => {
    const mine = (await (await local("/w/alpha/api/chats", { method: "POST", body: JSON.stringify({ agent: "claude" }) })).json()) as ChatMeta;
    assert.deepEqual(mine.author, { handle: "alice" });
    const hers = (await (await mia.fetch("/w/alpha/api/chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: "claude" }) })).json()) as ChatMeta;
    assert.deepEqual(hers.author, { handle: "mia", email: "mia@example.com" });

    assert.equal((await mia.fetch(`/w/alpha/api/chats/${hers.id}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello from afar" }) })).status, 200);
    assert.equal((await local(`/w/alpha/api/chats/${mine.id}/message`, { method: "POST", body: JSON.stringify({ text: "hello from here" }) })).status, 200);
    const events = async (id: string) => ((await (await local(`/w/alpha/api/chats/${id}`)).json()) as { events: StoredChatEvent[] }).events;
    const said = (evs: StoredChatEvent[]) => evs.find((e) => e.type === "user_message") as Extract<StoredChatEvent, { type: "user_message" }>;
    assert.deepEqual(said(await events(hers.id)).by, { handle: "mia", email: "mia@example.com" });
    assert.deepEqual(said(await events(mine.id)).by, { handle: "alice" });
    const listed = ((await (await mia.fetch("/w/alpha/api/chats")).json()) as { chats: ChatMeta[] }).chats;
    assert.deepEqual(listed.find((c) => c.id === hers.id)?.author, { handle: "mia", email: "mia@example.com" }, "the listing shows the author");
  });

  it("a private routine's run is hidden from remote callers and visible here", async () => {
    assert.equal((await local("/w/alpha/api/agents/lisa", { method: "PUT", body: JSON.stringify({ name: "Lisa", emoji: "🦊", harness: "claude" }) })).status, 200);
    for (const [name, priv] of [["Secret digest", true], ["Daily digest", false]] as const) {
      const r = await local("/w/alpha/api/agents/lisa/routines", { method: "POST", body: JSON.stringify({ name, schedule: "0 9 * * *", prompt: "digest", private: priv }) });
      assert.equal(r.status, 200, await r.clone().text());
    }
    const run = async (id: string) => ((await (await local(`/w/alpha/api/agents/lisa/routines/${id}/run`, { method: "POST" })).json()) as { chatId: string }).chatId;
    privateChat = await run("secret-digest");
    publicChat = await run("daily-digest");

    const ids = async (t: Tunnel | null, headers: Record<string, string> = {}) =>
      ((await (await (t ? t.fetch("/w/alpha/api/chats", { headers }) : local("/w/alpha/api/chats"))).json()) as { chats: ChatMeta[] }).chats.map((c) => c.id);
    const here_ = await ids(null);
    assert.ok(here_.includes(privateChat) && here_.includes(publicChat), "this machine sees both");
    const meta = ((await (await local(`/w/alpha/api/chats/${privateChat}`)).json()) as { meta: ChatMeta }).meta;
    assert.equal(meta.private, true, "marked at creation");
    assert.deepEqual(meta.author, { handle: "alice" }, "a routine's run is this machine's");

    const member = await ids(mia);
    assert.ok(member.includes(publicChat));
    assert.ok(!member.includes(privateChat), "a member does not see the private run");
    assert.equal((await mia.fetch(`/w/alpha/api/chats/${privateChat}`)).status, 404);
    assert.equal((await mia.fetch(`/w/alpha/api/chats/${privateChat}/events`)).status, 404);

    // A paired device over the relay is a remote caller too.
    const dev = await open();
    const { createPairCode } = await import("../../src/core/devices.js");
    const paired = await dev.fetch("/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: (await createPairCode()).code, name: "phone" }) });
    const { token } = (await paired.json()) as { token: string };
    const device = await ids(dev, { authorization: `Bearer ${token}` });
    assert.ok(device.includes(publicChat) && !device.includes(privateChat));
    const self = (await (await dev.fetch("/api/devices/self", { headers: { authorization: `Bearer ${token}` } })).json()) as { trust: string; relay?: boolean };
    assert.deepEqual([self.trust, self.relay], ["device", true]);
  });

  it("the heartbeat reports the routines that ran here only once the machine is claimed", async () => {
    const since = Date.now();
    await waitFor(() => cloud.calls("heartbeat").filter((h) => h.at > since).length >= 2);
    assert.ok(cloud.calls("heartbeat").every((h) => h.body.routines === undefined), "nothing while unclaimed");

    cloud.claim(await machineId(), "alice@example.com");
    await waitFor(() => cloud.calls("heartbeat").some((h) => Array.isArray(h.body.routines)));
    const routines = cloud.calls("heartbeat").find((h) => Array.isArray(h.body.routines))!.body.routines as Array<Record<string, unknown>>;
    assert.equal(routines.length, 1, "the private routine is left out");
    const [r] = routines;
    assert.equal(r.workspaceId, "ws_alpha00001");
    assert.equal(r.routineId, "lisa/daily-digest");
    assert.equal(r.name, "Daily digest");
    assert.equal(r.ok, true);
    assert.match(String(r.lastRunAt), /^\d{4}-\d\d-\d\dT/);
    // Unchanged: not sent again.
    const after_ = Date.now();
    await waitFor(() => cloud.calls("heartbeat").filter((h) => h.at > after_).length >= 2);
    assert.ok(cloud.calls("heartbeat").filter((h) => h.at > after_).every((h) => h.body.routines === undefined));
  });

  it("past the TTL a live session re-verifies; a cloud outage keeps the cached answer", async () => {
    members.setMemberCacheTtl(150);
    await sleep(200);
    const n = cloud.verifies().length;
    assert.equal((await mia.fetch("/w/alpha/api/meta")).status, 200);
    assert.equal(cloud.verifies().length, n + 1, "re-verified lazily");

    cloud.down = true;
    try {
      await sleep(200);
      assert.equal((await mia.fetch("/w/alpha/api/meta")).status, 200, "the cloud unreachable: the cached answer holds");
      assert.equal((await mia.fetch("/w/beta/api/meta")).status, 403, "and so does the scope");
    } finally {
      cloud.down = false;
    }
  });

  it("a revoked token ends the session at its next verification", async () => {
    cloud.revokeMember(miaToken);
    await sleep(200);
    await assert.rejects(mia.fetch("/w/alpha/api/meta"), /unknown or revoked/);
    const why = await mia.closed;
    assert.match(why, /unknown or revoked/);
    await assert.rejects(open({ token: miaToken, workspaceId: "ws_alpha00001" }), /unknown or revoked/, "and no new one opens");
    members.setMemberCacheTtl();
    assert.ok(privateChat && publicChat);
  });
});
