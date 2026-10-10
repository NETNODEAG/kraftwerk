import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, randomBytes } from "node:crypto";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { Hub } from "../../src/server/server.js";
import type { PushContent, PushMessage } from "../../src/server/push.js";

/**
 * Push notifications for what needs you: a paired device registers its APNs
 * token and a key; when something new needs attention in a workspace, the
 * daemon hands the relay one sealed notification per device — openable only
 * with that device's key. What was there at start is not pushed; a device
 * that turns pushes off gets none; this machine itself registers nothing.
 */
describe("push notifications", () => {
  let fx: Fixture;
  let hub: Hub;
  let token = "";
  const key = randomBytes(32).toString("base64");
  const apns = "a1".repeat(32);
  const prevEnv = { HOME: process.env.HOME, KRAFTWERK_CLOUD_URL: process.env.KRAFTWERK_CLOUD_URL };

  const base = () => `http://127.0.0.1:${hub.port}`;
  const asDevice = (path: string, init: RequestInit = {}) =>
    fetch(base() + path, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });

  const open = (sealed: string): PushContent => {
    const raw = Buffer.from(sealed, "base64");
    const d = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(raw.length - 16));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString("utf8"));
  };

  before(async () => {
    fx = await makeProject();
    process.env.HOME = fx.home;
    process.env.KRAFTWERK_CLOUD_URL = "off";
    const { startHub } = await import("../../src/server/server.js");
    // trustLoopback off: these requests count as a paired device's, like the phone's through the relay.
    hub = await startHub({ port: 0, staticDir: fx.root, daemon: true, trustLoopback: false });
    await hub.open(fx.root);
    const { createPairCode, redeemPairCode } = await import("../../src/core/devices.js");
    token = (await redeemPairCode((await createPairCode()).code, "phone")).token;
  });

  after(async () => {
    await hub?.stop();
    await fx?.cleanup();
    process.env.HOME = prevEnv.HOME;
    if (prevEnv.KRAFTWERK_CLOUD_URL === undefined) delete process.env.KRAFTWERK_CLOUD_URL;
    else process.env.KRAFTWERK_CLOUD_URL = prevEnv.KRAFTWERK_CLOUD_URL;
  });

  it("a device registers where its pushes go; a malformed one is refused", async () => {
    const bad = await asDevice("/api/devices/push", { method: "POST", body: JSON.stringify({ token: "not-hex", environment: "sandbox", key }) });
    assert.equal(bad.status, 400);
    const ok = await asDevice("/api/devices/push", { method: "POST", body: JSON.stringify({ token: apns, environment: "sandbox", key }) });
    assert.equal(ok.status, 200, await ok.text());
    const self = (await (await asDevice("/api/devices/self")).json()) as { device: { push?: boolean } };
    assert.equal(self.device.push, true);
  });

  it("something new that needs you is pushed once, sealed for the device; what was there before is not", async () => {
    const { startPushWatcher } = await import("../../src/server/push.js");
    const sent: PushMessage[][] = [];
    const ws = hub.list()[0];
    const { pushNotification } = await import("../../src/core/notifications.js");
    await ws.ws.run(() => pushNotification({ kind: "run_failed", title: "old run failed", href: "/runs/x" }));
    const watcher = startPushWatcher(hub, (p) => (sent.push(p), true), 60_000);
    try {
      assert.equal(await watcher.scan(), 0, "the first look only learns what is there");
      await ws.ws.run(() => pushNotification({ kind: "run_failed", title: "nightly-report run failed", body: "step 2: exit 1", href: "/runs/y" }));
      assert.equal(await watcher.scan(), 1);
      assert.equal(await watcher.scan(), 0, "pushed once");
      const [push] = sent[0];
      assert.equal(push.token, apns);
      assert.equal(push.environment, "sandbox");
      assert.equal(push.badge, 2, "the badge counts everything that needs you");
      assert.equal(push.thread, ws.slug);
      assert.doesNotMatch(JSON.stringify(push), /nightly|exit 1/, "nothing readable outside the seal");
      const content = open(push.sealed);
      assert.equal(content.kind, "failed");
      assert.equal(content.ws, ws.slug);
      assert.match(content.title, /^Failed · /);
      assert.equal(content.body, "nightly-report run failed: step 2: exit 1");
      assert.throws(() => {
        const other = createDecipheriv("aes-256-gcm", randomBytes(32), Buffer.alloc(12));
        other.setAuthTag(Buffer.from(push.sealed, "base64").subarray(-16));
        other.update(Buffer.from(push.sealed, "base64").subarray(12, -16));
        other.final();
      }, "another key cannot open it");

      // Turned off: nothing more for this device.
      const off = await asDevice("/api/devices/push", { method: "DELETE" });
      assert.equal(off.status, 200, await off.text());
      const { listDevices } = await import("../../src/core/devices.js");
      assert.equal((await listDevices()).length, 1, "turning pushes off is not unpairing");
      await ws.ws.run(() => pushNotification({ kind: "routine_failed", title: "digest failed", href: "/agents/a" }));
      assert.equal(await watcher.scan(), 0);
    } finally {
      watcher.stop();
    }
  });

  it("a token Apple dropped is forgotten", async () => {
    await asDevice("/api/devices/push", { method: "POST", body: JSON.stringify({ token: apns, environment: "production", key }) });
    const { dropPushToken, pushTargets } = await import("../../src/core/devices.js");
    assert.equal((await pushTargets()).length, 1);
    await dropPushToken(apns);
    assert.equal((await pushTargets()).length, 0);
  });
});
