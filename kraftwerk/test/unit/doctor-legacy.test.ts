import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { ResolvedWorkspace } from "../../src/config.js";

/**
 * `kraftwerk doctor`'s legacy checks, each from a real leftover in a temp
 * home: a server answering with an older version, two installs on PATH at
 * different versions, the pre-0.49 registry folder, a pre-0.36 chat and a
 * run in the old location, public:/tunnel: keys in kraftwerk.yml — and a
 * clean setup that reports nothing.
 */
describe("doctor legacy checks", () => {
  let base = "";
  let home = "";
  let output = "";
  let old: http.Server;
  const env = { HOME: process.env.HOME, PATH: process.env.PATH };
  const ws = (): ResolvedWorkspace => ({ root: path.dirname(output), config: {}, outputDir: output });
  const legacy = async () => (await import("../../src/cli/doctor-legacy.js")).legacyFindings(ws(), "0.64.0");

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-"));
    home = path.join(base, "home");
    output = path.join(base, "ws", "output");
    await mkdir(path.join(home, ".kraftwerk", "instances"), { recursive: true });
    await mkdir(output, { recursive: true });
    process.env.HOME = home;
    // A bin folder with nothing on it yet, so the machine's own installs stay out of the test.
    await mkdir(path.join(base, "bin"));
    process.env.PATH = `${path.join(base, "bin")}:/usr/bin:/bin`;
  });
  after(async () => {
    old?.close();
    process.env.HOME = env.HOME;
    process.env.PATH = env.PATH;
    await rm(base, { recursive: true, force: true });
  });

  it("reports nothing on a clean setup", async () => {
    assert.deepEqual((await legacy()).map((f) => f.label), ["no legacy leftovers"]);
  });

  it("finds an older running server, mixed installs, the old registry, old chats and old runs", async () => {
    old = http.createServer((_, res) => res.end(JSON.stringify({ version: "0.61.0", projectName: "Old Hub" })));
    await new Promise<void>((r) => old.listen(0, "127.0.0.1", r));
    const port = (old.address() as AddressInfo).port;
    await writeFile(path.join(home, ".kraftwerk", "instances", "4242.json"), JSON.stringify({ pid: 4242, port, startedAt: "2026-01-01T00:00:00Z", root: "/srv/old" }));

    for (const [dir, version] of [["a", "0.64.0"], ["b", "0.60.1"]]) {
      const bin = path.join(base, dir, "kraftwerk");
      await mkdir(path.dirname(bin), { recursive: true });
      await writeFile(bin, `#!/bin/sh\necho ${version}\n`);
      await chmod(bin, 0o755);
    }
    process.env.PATH = `${path.join(base, "a")}:${path.join(base, "b")}:/usr/bin:/bin`;

    await mkdir(path.join(home, ".kraftwerk", "projects"), { recursive: true });
    await writeFile(path.join(home, ".kraftwerk", "projects", "x.json"), "{}");
    await mkdir(path.join(output, "chats", "chat-old"), { recursive: true });
    await writeFile(path.join(output, "chats", "chat-old", "meta.json"), JSON.stringify({ id: "chat-old", scope: { kind: "team", member: "dhh" } }));
    await mkdir(path.join(output, "run-20250101-000000-demo"));

    const found = await legacy();
    const byLabel = (re: RegExp) => found.find((f) => re.test(f.label));
    assert.equal(byLabel(/Old Hub runs kraftwerk 0\.61\.0/)?.level, "warn", "an older server, named by its pre-0.64 meta");
    assert.match(byLabel(/2 kraftwerk installs on PATH/)?.detail ?? "", /0\.64\.0.*0\.60\.1/);
    assert.equal(byLabel(/old workspace registry/)?.level, "info");
    assert.ok(byLabel(/1 chat\(s\) in the pre-0\.36 format/));
    assert.ok(byLabel(/1 run\(s\) in the old location/));
    assert.ok(!found.some((f) => f.label === "no legacy leftovers"));
  });

  it("names the public:/tunnel: keys the config loader ignored", async () => {
    const { legacyFindings } = await import("../../src/cli/doctor-legacy.js");
    const found = (await legacyFindings({ ...ws(), legacyKeys: ["public", "tunnel"] }, "0.64.0")).find((f) => f.label === "kraftwerk.yml still has public:/tunnel:");
    assert.equal(found?.level, "info");
    assert.match(found?.detail ?? "", /public:, tunnel: — the Cloudflare Tunnel was removed in 0\.65 and these keys are ignored; delete them/);
    assert.ok(!(await legacy()).some((f) => f.label === "kraftwerk.yml still has public:/tunnel:"), "not without legacy keys");
  });

  it("only reads: a registered server that does not answer keeps its record", async () => {
    const silent = path.join(home, ".kraftwerk", "instances", "4343.json");
    // A port nothing listens on: the probe fails, as it would for a busy server.
    await writeFile(silent, JSON.stringify({ pid: 4343, port: 9, startedAt: "2026-01-01T00:00:00Z", root: "/srv/busy" }));
    await legacy();
    assert.ok(existsSync(silent));
  });
});
