import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * The device store under concurrent use: pairings redeemed at the same
 * moment all survive (every change is applied to a fresh read, one at a
 * time), and a device's "last seen" stamp never writes back a stale copy
 * that would lose a pairing made in between.
 */
describe("device store", () => {
  let home = "";
  const prevHome = process.env.HOME;
  const store = () => import("../../src/core/devices.js");

  before(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-"));
    process.env.HOME = home;
  });
  after(async () => {
    process.env.HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  });

  it("five pairings at once: five devices", async () => {
    const { createPairCode, redeemPairCode, listDevices } = await store();
    const codes = await Promise.all(Array.from({ length: 5 }, () => createPairCode()));
    const paired = await Promise.all(codes.map((c, i) => redeemPairCode(c.code, `device ${i}`)));
    assert.equal(new Set(paired.map((p) => p.token)).size, 5);
    assert.deepEqual((await listDevices()).map((d) => d.name).sort(), ["device 0", "device 1", "device 2", "device 3", "device 4"]);
  });

  it("a last-seen stamp does not drop a pairing made in between", async () => {
    const { createPairCode, redeemPairCode, deviceForToken, listDevices } = await store();
    const { token } = await redeemPairCode((await createPairCode()).code, "old phone");
    // Make it due for a new stamp, then stamp it while another device pairs.
    const file = path.join(home, ".kraftwerk", "devices.json");
    const data = JSON.parse(await readFile(file, "utf8")) as { devices: Array<{ name: string; lastSeenAt?: string }> };
    for (const d of data.devices) d.lastSeenAt = "2020-01-01T00:00:00.000Z";
    await writeFile(file, JSON.stringify(data));
    const code = (await createPairCode()).code;
    await Promise.all([deviceForToken(token), redeemPairCode(code, "new phone")]);
    const names = (await listDevices()).map((d) => d.name);
    assert.ok(names.includes("new phone"), names.join(", "));
    assert.notEqual((await listDevices()).find((d) => d.name === "old phone")?.lastSeenAt, "2020-01-01T00:00:00.000Z");
  });
});
