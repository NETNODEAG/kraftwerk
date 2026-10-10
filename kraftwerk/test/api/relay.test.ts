import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { makeProject, type Fixture } from "../helpers/project.js";
import { startTestRelay, type TestRelay } from "../helpers/relay.js";
import {
  clientHandshake,
  connectTunnel,
  daemonHandshake,
  fromBase64Url,
  generateKeyPair,
  relayId,
  type Ready,
  type Tunnel,
} from "../../src/client/relay.js";
import { createClient } from "../../src/client/index.js";
import type { Hub } from "../../src/server/server.js";
import type { RelayLink, RelaySettings } from "../../src/server/relay.js";

/**
 * The relay (phase 7): a client reaches the daemon through a relay that
 * only pipes. The handshake proves the machine's key and makes fresh keys
 * per connection; a tunnelled request is a network device's request — it
 * needs pairing like on the LAN, never counts as this machine; bodies
 * stream in chunks; the daemon reconnects when the relay drops it, and the
 * relay keeps a machine's id for the secret that first claimed it.
 */
describe("relay: the handshake", { timeout: 30_000 }, () => {
  it("both ends derive the same channel; the client checks the machine's key", async () => {
    const daemon = await generateKeyPair();
    const hs = await clientHandshake(daemon.publicKey);
    const { ready, channel: d } = await daemonHandshake(daemon, hs.hello);
    const c = await hs.finish(ready);
    assert.equal(await d.open(await c.seal("to the daemon")), "to the daemon");
    assert.equal(await c.open(await d.seal("to the client")), "to the client");

    const impostor = await generateKeyPair();
    const hs2 = await clientHandshake(daemon.publicKey);
    const fake = await daemonHandshake(impostor, hs2.hello);
    await assert.rejects(hs2.finish(fake.ready), /did not prove its key/);
  });

  it("a replayed, reordered or altered message breaks the channel", async () => {
    const daemon = await generateKeyPair();
    const hs = await clientHandshake(daemon.publicKey);
    const { ready, channel: d } = await daemonHandshake(daemon, hs.hello);
    const c = await hs.finish(ready);
    const one = await c.seal("one");
    const two = await c.seal("two");
    await assert.rejects(d.open(two), /decrypt/, "out of order");

    const hs2 = await clientHandshake(daemon.publicKey);
    const r2 = await daemonHandshake(daemon, hs2.hello);
    const c2 = await hs2.finish(r2.ready);
    const sealed = await c2.seal("x");
    const flipped = Buffer.from(sealed, "base64");
    flipped[3] ^= 1;
    await assert.rejects(r2.channel.open(flipped.toString("base64")), /decrypt/, "altered");

    // The same hello answered twice gives different keys: a recorded session does not replay.
    const again = await daemonHandshake(daemon, hs.hello);
    await assert.rejects(again.channel.open(one), /decrypt/, "replayed into a new connection");
  });

  it("refuses another protocol version", async () => {
    const daemon = await generateKeyPair();
    const hs = await clientHandshake(daemon.publicKey);
    await assert.rejects(daemonHandshake(daemon, { ...hs.hello, v: 99 }), /protocol 99/);
  });
});

describe("relay: a device reaches the daemon from anywhere", { timeout: 60_000 }, () => {
  let fx: Fixture;
  let hub: Hub;
  let relay: TestRelay;
  let link: RelayLink;
  let settings: RelaySettings;
  let tunnel: Tunnel;
  /** The device token paired through the tunnel. */
  let token_ = "";
  const prevEnv = { HOME: process.env.HOME, KRAFTWERK_CLOUD_URL: process.env.KRAFTWERK_CLOUD_URL };

  const waitFor = async (ok: () => boolean, ms = 8000) => {
    const until = Date.now() + ms;
    while (!ok()) {
      if (Date.now() > until) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  before(async () => {
    fx = await makeProject();
    process.env.HOME = fx.home;
    process.env.KRAFTWERK_CLOUD_URL = "off";
    const { startHub } = await import("../../src/server/server.js");
    hub = await startHub({ port: 0, staticDir: fx.root, daemon: true });
    await hub.open(fx.root);
    relay = await startTestRelay();
    const { setRelay, startRelay } = await import("../../src/server/relay.js");
    settings = await setRelay(true, relay.url);
    link = await startRelay({ port: hub.port, settings, version: "test" });
    await waitFor(() => link.status().state === "connected");
    tunnel = await connectTunnel({ relayUrl: `${relay.url.replace(/^http/, "ws")}/api/relay/client`, publicKey: fromBase64Url(settings.publicKey) });
  });

  after(async () => {
    tunnel?.close();
    link?.stop();
    await relay?.close();
    await hub?.stop();
    await fx?.cleanup();
    process.env.HOME = prevEnv.HOME;
    if (prevEnv.KRAFTWERK_CLOUD_URL === undefined) delete process.env.KRAFTWERK_CLOUD_URL;
    else process.env.KRAFTWERK_CLOUD_URL = prevEnv.KRAFTWERK_CLOUD_URL;
  });

  it("the daemon is known at the relay by its key's hash, and says so", async () => {
    const s = link.status();
    assert.equal(s.id, await relayId(fromBase64Url(settings.publicKey)));
    assert.equal(s.clients, 1);
  });

  it("a tunnelled request is a network device's, not this machine's: unpaired, it is refused", async () => {
    const self = await tunnel.fetch("/api/devices/self");
    assert.equal(self.status, 401);
    assert.equal(((await self.json()) as { pair?: boolean }).pair, true, "the client is told to pair");
    const slug = hub.list()[0].slug;
    const r = await tunnel.fetch(`/w/${slug}/api/meta`);
    assert.equal(r.status, 401);
    const devices = await tunnel.fetch("/api/devices");
    assert.ok(devices.status === 401 || devices.status === 403, `device list must stay local, got ${devices.status}`);
    // Forging the headers that would make it local does not help: the daemon sets them itself.
    const forged = await tunnel.fetch("/api/devices/self", { headers: { "x-forwarded-for": "127.0.0.1", host: "localhost" } });
    assert.equal(forged.status, 401);
  });

  it("pairs with a code through the tunnel, then calls the workspace with its token", async () => {
    const { createPairCode } = await import("../../src/core/devices.js");
    const { code } = await createPairCode();
    const paired = await tunnel.fetch("/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "phone abroad" }) });
    assert.equal(paired.status, 200);
    assert.equal(paired.headers.get("set-cookie"), null, "a cookie is no use to the client and stays behind");
    const { token, device } = (await paired.json()) as { token: string; device: { name: string } };
    assert.equal(device.name, "phone abroad");

    const api = createClient({ fetch: tunnel.fetch, token, workspace: hub.list()[0].slug });
    const self = await api.call("devices.self");
    assert.equal(self.trust, "device");
    const meta = (await api.call("meta.get")) as { workspaceRoot?: string };
    assert.equal(meta.workspaceRoot, fx.root, "the workspace answers");
    token_ = token;
  });

  it("streams large bodies in pieces and keeps concurrent requests apart", async () => {
    const big = Buffer.alloc(700_000);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    await writeFile(path.join(fx.root, "big.bin"), big);
    const auth = { headers: { authorization: `Bearer ${token_}` } };
    const [a, b] = await Promise.all([tunnel.fetch("/big.bin", auth), tunnel.fetch("/api/devices/self", auth)]);
    assert.equal(a.status, 200);
    assert.deepEqual(Buffer.from(await a.arrayBuffer()), big);
    assert.equal(b.status, 200);
  });

  it("the relay carried nothing readable after the handshake", () => {
    const after = relay.seen.filter((m) => !m.startsWith("{"));
    assert.ok(after.length > 4, "traffic went through the relay");
    for (const m of relay.seen) {
      assert.doesNotMatch(m, /phone abroad|devices\/self|kwd_/, "a name, a path or a token in the clear");
    }
  });

  it("another daemon cannot take the machine's id; the daemon reconnects after the relay drops it", async () => {
    const { startRelay } = await import("../../src/server/relay.js");
    const thief = await startRelay({ port: hub.port, settings: { ...settings, secret: "guessed" }, version: "test" });
    await waitFor(() => thief.status().state === "error");
    assert.match(thief.status().error ?? "", /refused/);
    thief.stop();
    assert.equal(link.status().state, "connected", "the real one keeps its place");

    relay.kick(link.status().id!);
    await waitFor(() => link.status().state !== "connected");
    await waitFor(() => link.status().state === "connected", 10_000);
    const again = await connectTunnel({ relayUrl: `${relay.url.replace(/^http/, "ws")}/api/relay/client`, publicKey: fromBase64Url(settings.publicKey) });
    assert.equal((await again.fetch("/api/devices/self", { headers: { authorization: `Bearer ${token_}` } })).status, 200);
    again.close();
  });

  it("a client with the wrong machine key gets no channel; an unknown machine is reported as not connected", async () => {
    const other = await generateKeyPair();
    const relayUrl = `${relay.url.replace(/^http/, "ws")}/api/relay/client`;
    // The relay says 4404; should that frame ever be lost, its socket still closes within the close grace — never the 15 s timeout.
    const t0 = Date.now();
    await assert.rejects(connectTunnel({ relayUrl, publicKey: other.publicKey }), /not connected|closed the connection/);
    assert.ok(Date.now() - t0 < 10_000, "told at once, not after the handshake timeout");
    // Right id, wrong key: the daemon's answer does not open.
    const id = await relayId(fromBase64Url(settings.publicKey));
    const hs = await clientHandshake(other.publicKey);
    const ws = new WebSocket(`${relayUrl}?id=${id}`);
    const answer = await new Promise<string>((resolve) => {
      ws.addEventListener("open", () => ws.send(JSON.stringify(hs.hello)));
      ws.addEventListener("message", (ev) => resolve(String(ev.data)));
    });
    await assert.rejects(hs.finish(JSON.parse(answer) as Ready), /did not prove/);
    ws.close();
  });
});

describe("relay: a relay that hangs", { timeout: 30_000 }, () => {
  it("a connection the relay never answers is given up and tried again", async () => {
    // Accepts TCP and then says nothing — what a restarting relay behind a proxy can do.
    const sockets = new Set<net.Socket>();
    let attempts = 0;
    const hang = net.createServer((s) => {
      attempts++;
      sockets.add(s);
    });
    await new Promise<void>((r) => hang.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(hang.address() as net.AddressInfo).port}`;
    const { exportKeyPair } = await import("../../src/client/relay.js");
    const { startRelay } = await import("../../src/server/relay.js");
    const pair = await exportKeyPair(await generateKeyPair());
    const link = await startRelay({ port: 1, settings: { enabled: true, url, ...pair, secret: "s".repeat(43) }, version: "test", handshakeTimeoutMs: 200 });
    try {
      const until = Date.now() + 8000;
      while (attempts < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
      assert.ok(attempts >= 2, `tried again (${attempts} attempts)`);
      assert.equal(link.status().error, "the relay did not answer");
    } finally {
      link.stop();
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => hang.close(() => r()));
    }
  });
});
