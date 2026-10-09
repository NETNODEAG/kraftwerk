import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * Paired devices. Two servers on one workspace: `local` trusts this
 * machine as usual (where codes are made and devices managed); `remote`
 * trusts nobody without a token — what a phone on the network sees. An
 * unpaired caller gets the web UI's shell, the protocol and pairing, and
 * nothing else; a paired one gets the API by header, cookie or socket, but
 * cannot manage devices; revoking ends a token at once; guessing codes is
 * rate-limited.
 */
describe("devices", () => {
  let fx: Fixture;
  let local: RunningServer;
  let remote: RunningServer;
  let token = "";

  const code = async (): Promise<string> =>
    ((await (await fetch(local.url + "/api/devices/code", { method: "POST" })).json()) as { code: string }).code;
  const pair = (body: unknown) => fetch(remote.url + "/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const asDevice = (p: string, init: RequestInit = {}) => fetch(remote.url + p, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });

  before(async () => {
    fx = await makeProject();
    local = await startServer(fx);
    remote = await startServer(fx, { trustLoopback: false });
  });
  after(async () => {
    await local.close();
    await remote.close();
    await fx.cleanup();
  });

  it("an unpaired caller gets the shell, the protocol and pairing — nothing else", async () => {
    const meta = await fetch(remote.url + "/api/meta");
    assert.equal(meta.status, 401);
    assert.deepEqual(await meta.json(), { error: "pair this device first", pair: true });
    assert.equal((await fetch(remote.url + "/api/no-such-route")).status, 401, "no hint which routes exist");
    assert.equal((await fetch(remote.url + "/api/protocol")).status, 200);
    assert.equal((await fetch(remote.url + "/vibeables/app/")).status, 401, "app previews are workspace data");
    assert.notEqual((await fetch(remote.url + "/")).status, 401, "the shell shows the pairing screen");
  });

  it("a code made on this machine pairs a device once; the token works as header and cookie", async () => {
    assert.equal((await pair({ code: "WRONG-CODE", name: "phone" })).status, 400);
    const c = await code();
    assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const r = await pair({ code: c.toLowerCase(), name: "Lukas' phone" });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { token: string; device: { name: string } };
    token = body.token;
    assert.equal(body.device.name, "Lukas' phone");
    assert.match(r.headers.get("set-cookie") ?? "", /^kw_device=kwd_[^;]+; HttpOnly; SameSite=Strict; Path=\//);
    assert.equal((await pair({ code: c, name: "again" })).status, 400, "a code works once");

    assert.equal((await asDevice("/api/meta")).status, 200);
    assert.equal((await fetch(remote.url + "/api/meta", { headers: { cookie: `kw_device=${encodeURIComponent(token)}` } })).status, 200);
    const self = (await (await asDevice("/api/devices/self")).json()) as { trust: string; device: { name: string; lastSeenAt?: string } };
    assert.deepEqual([self.trust, self.device.name, typeof self.device.lastSeenAt], ["device", "Lukas' phone", "string"]);
    // The store keeps a hash, never the token.
    const store = await readFile(path.join(fx.home, ".kraftwerk", "devices.json"), "utf8");
    assert.ok(!store.includes(token));
  });

  it("a paired device cannot manage devices; this machine can", async () => {
    assert.equal((await asDevice("/api/devices")).status, 403);
    assert.equal((await asDevice("/api/devices/code", { method: "POST" })).status, 403);
    const list = (await (await fetch(local.url + "/api/devices")).json()) as { devices: Array<{ name: string }> };
    assert.deepEqual(list.devices.map((d) => d.name), ["Lukas' phone"]);
  });

  it("the socket takes the token in its query; a device cannot watch what only this machine may see", async () => {
    const wsUrl = remote.url.replace(/^http/, "ws") + "/api/ws";
    await assert.rejects(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("refused"));
      }),
      /refused/,
    );
    const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
    const messages: Array<Record<string, unknown>> = [];
    ws.onmessage = (m) => messages.push(JSON.parse(String(m.data)));
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ watch: "d", name: "devices.list" }));
    // A watched result that depends on who asks is not shared with this machine's watchers.
    const localWs = new WebSocket(local.url.replace(/^http/, "ws") + "/api/ws");
    await new Promise((r) => (localWs.onopen = r));
    localWs.send(JSON.stringify({ watch: "s", name: "devices.self" }));
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ watch: "s", name: "devices.self" }));
    ws.send(JSON.stringify({ id: 1, call: "meta.get", input: { query: { probe: true } } }));
    const until = Date.now() + 3000;
    while (Date.now() < until && !(messages.some((m) => m.watch === "d") && messages.some((m) => m.id === 1) && messages.some((m) => m.watch === "s"))) await new Promise((r) => setTimeout(r, 20));
    ws.close();
    localWs.close();
    assert.equal((messages.find((m) => m.watch === "s")?.data as { trust: string }).trust, "device");
    assert.match(String(messages.find((m) => m.watch === "d")?.error), /only on the machine/);
    assert.equal(messages.find((m) => m.id === 1)?.status, 200);
  });

  it("revoking a device ends its token at once — and its open socket", async () => {
    const ws = new WebSocket(`${remote.url.replace(/^http/, "ws")}/api/ws?token=${encodeURIComponent(token)}`);
    const replies: Array<Record<string, unknown>> = [];
    ws.onmessage = (m) => replies.push(JSON.parse(String(m.data)));
    const closed = new Promise<number>((r) => (ws.onclose = (e) => r(e.code)));
    await new Promise((r) => (ws.onopen = r));

    const { devices } = (await (await fetch(local.url + "/api/devices")).json()) as { devices: Array<{ id: string }> };
    assert.equal((await fetch(`${local.url}/api/devices/${devices[0].id}`, { method: "DELETE" })).status, 200);
    assert.equal((await asDevice("/api/meta")).status, 401);

    // The socket opened before the revoke: its next call is not answered, the connection ends.
    ws.send(JSON.stringify({ id: 7, call: "meta.get" }));
    assert.equal(await closed, 4401);
    assert.ok(!replies.some((m) => m.id === 7), "a revoked device's call ran");
  });

  it("guessing codes is rate-limited", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await pair({ code: `GUESS-${i}`, name: "x" })).status;
    assert.equal(last, 429);
  });
});
