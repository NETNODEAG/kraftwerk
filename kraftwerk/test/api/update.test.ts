import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { UpdateStatus } from "../../src/inspector/update.js";

/**
 * Self-update over the HTTP API, against a stub npm (KRAFTWERK_NPM): the
 * install runs with the package name and version asked for, its output is
 * kept, a failure is reported, a second run while one is running is refused,
 * and a global folder this process cannot write to refuses up front.
 */
describe("update API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let globalRoot: string;
  const headers = () => ({ "content-type": "application/json", origin: new URL(srv.url).origin });
  const post = (body: unknown) => fetch(srv.url + "/api/update", { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const status = async (): Promise<UpdateStatus & { available: boolean; reason?: string; name: string }> =>
    (await fetch(srv.url + "/api/update", { cache: "no-store" })).json();
  const settled = async () => {
    for (let i = 0; i < 100; i++) {
      const s = await status();
      if (s.state !== "running") return s;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("update did not settle");
  };

  before(async () => {
    fx = await makeProject();
    globalRoot = path.join(fx.root, "global-root");
    await mkdir(globalRoot, { recursive: true });
    // A stub npm: `root -g` names the folder, `i -g` narrates and exits as told.
    const stub = path.join(fx.root, "fake-npm");
    await writeFile(
      stub,
      '#!/bin/sh\nif [ "$1" = "root" ]; then echo "$FAKE_NPM_ROOT"; exit 0; fi\n' +
        'echo "installing $3"\n[ -n "$FAKE_NPM_SLEEP" ] && sleep "$FAKE_NPM_SLEEP"\necho "added 1 package"\nexit "${FAKE_NPM_EXIT:-0}"\n'
    );
    await chmod(stub, 0o755);
    process.env.KRAFTWERK_NPM = stub;
    process.env.FAKE_NPM_ROOT = globalRoot;
    srv = await startServer(fx);
  });
  after(async () => {
    delete process.env.KRAFTWERK_NPM;
    delete process.env.FAKE_NPM_ROOT;
    delete process.env.FAKE_NPM_EXIT;
    delete process.env.FAKE_NPM_SLEEP;
    await srv.close();
    await fx.cleanup();
  });

  it("reports idle and available before anything ran", async () => {
    const s = await status();
    assert.equal(s.state, "idle");
    assert.equal(s.available, true);
    assert.equal(s.name, "@netnodeag/kraftwerk");
  });

  it("installs the requested version with the server's npm and keeps the output", async () => {
    const r = await post({ version: "9.9.9" });
    assert.equal(r.status, 202);
    const s = await settled();
    assert.equal(s.state, "done");
    assert.equal(s.exitCode, 0);
    assert.equal(s.version, "9.9.9");
    assert.deepEqual(s.log, ["$ npm i -g @netnodeag/kraftwerk@9.9.9", "installing @netnodeag/kraftwerk@9.9.9", "added 1 package"]);
  });

  it("refuses a second install while one is running, and defaults to latest", async () => {
    process.env.FAKE_NPM_SLEEP = "1";
    assert.equal((await post({})).status, 202);
    const again = await post({});
    assert.equal(again.status, 409);
    assert.match(((await again.json()) as { error: string }).error, /already running/);
    const s = await settled();
    assert.equal(s.version, "latest");
    assert.equal(s.state, "done");
    delete process.env.FAKE_NPM_SLEEP;
  });

  it("reports a failed install with its output", async () => {
    process.env.FAKE_NPM_EXIT = "3";
    assert.equal((await post({ version: "1.0.0" })).status, 202);
    const s = await settled();
    assert.equal(s.state, "failed");
    assert.equal(s.exitCode, 3);
    delete process.env.FAKE_NPM_EXIT;
  });

  it("rejects a malformed version", async () => {
    assert.equal((await post({ version: "1.0.0; rm -rf /" })).status, 409);
  });

  it("refuses up front when the global folder is not writable", async () => {
    if (process.getuid?.() === 0) return; // root can write anywhere; nothing to test
    const locked = path.join(fx.root, "locked-root");
    await mkdir(locked, { recursive: true });
    await chmod(locked, 0o555);
    process.env.FAKE_NPM_ROOT = locked;
    try {
      const s = await status();
      assert.equal(s.available, false);
      assert.match(s.reason ?? "", /not writable/);
      const r = await post({});
      assert.equal(r.status, 409);
    } finally {
      process.env.FAKE_NPM_ROOT = globalRoot;
      await chmod(locked, 0o755);
    }
  });
});
