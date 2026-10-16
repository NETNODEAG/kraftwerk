import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { cli } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";

/**
 * The daemon from the outside, as a user runs it without a terminal of its
 * own: `status` says whether it runs (exit 3 when not), `start` / `-d` runs
 * it in the background writing to the daemon log, `logs` shows that log, a
 * crash is restarted by its supervisor, `restart` relaunches it, `stop`
 * stops it for good. No login item here (a private HOME has none), so the
 * daemon is a detached process; the web UI is a stub.
 */
describe("kraftwerk daemon status / start / stop / restart / logs", () => {
  let fx: Fixture;
  let web = "";
  let port = 0;
  const env = () => ({ KRAFTWERK_WEB_DIR: web, KRAFTWERK_DAEMON_PORT: String(port), KRAFTWERK_RESTART_AFTER_MS: "0" });
  const kw = (args: string[]) => cli(fx.root, fx.home, args, { env: env() });
  const daemonFile = async () => JSON.parse(await readFile(path.join(fx.home, ".kraftwerk", "daemon.json"), "utf8")) as { pid: number; supervisor?: number };
  const status = async () => {
    const r = await kw(["daemon", "status", "--json"]);
    return { code: r.code, body: JSON.parse(r.stdout) as { running: boolean; pid?: number; version?: string; workspaces?: Array<{ slug: string }> } };
  };
  const waitFor = async (ok: () => Promise<boolean>, ms = 30_000) => {
    const end = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > end) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  before(async () => {
    port = await new Promise<number>((resolve) => {
      const s = http.createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    fx = await makeProject("name: Gamma\nslug: gamma\ngit:\n  interval: 0\n");
    web = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-web-"));
    await writeFile(path.join(web, "index.html"), "<!doctype html><title>stub</title>");
  });
  after(async () => {
    // Whatever a failed test left running in the background goes.
    await kw(["daemon", "stop"]);
    await rm(web, { recursive: true, force: true });
    await fx.cleanup();
  });

  it("says when none runs, with exit 3", async () => {
    const r = await kw(["daemon", "status"]);
    assert.equal(r.code, 3, r.all);
    assert.match(r.stdout, /kraftwerk daemon not running/);
    assert.match(r.stdout, /`kraftwerk daemon start`/);
    assert.equal((await kw(["daemon", "logs"])).code, 0, "no log yet is not an error");
  });

  it("starts it in the background; status shows it, logs show what it said", async () => {
    const r = await kw(["daemon", "start"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /kraftwerk daemon running/);
    const s = await status();
    assert.equal(s.code, 0);
    assert.equal(s.body.running, true);
    assert.match(s.body.version ?? "", /^\d+\.\d+\.\d+/);
    assert.match((await kw(["daemon", "start"])).stdout, /already runs/);
    const logs = await kw(["daemon", "logs", "-n", "20"]);
    assert.match(logs.stdout, /^\d{4}-\d{2}-\d{2}T\S+ INFO  daemon    listening on http:\/\/localhost:\d+/m, "the log follows the standard line shape");
  });

  it("starts it again after a crash (the supervisor)", async () => {
    const before = await daemonFile();
    assert.ok(before.supervisor, "the supervisor is in the daemon file");
    process.kill(before.pid, "SIGKILL");
    await waitFor(async () => {
      const s = await status();
      return s.body.running && s.body.pid !== before.pid;
    });
    assert.equal((await daemonFile()).supervisor, before.supervisor, "the same supervisor started it again");
    assert.match((await kw(["daemon", "logs"])).stdout, /stopped unexpectedly \(signal SIGKILL\)/);
  });

  it("restarts it: a new daemon process, the workspace open again", async () => {
    const open = await fetch(`http://127.0.0.1:${port}/api/hub/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: fx.root }),
    });
    assert.equal(open.status, 200, await open.text());
    const old = (await status()).body.pid;
    const r = await kw(["daemon", "restart"]);
    assert.equal(r.code, 0, r.all);
    const s = await status();
    assert.notEqual(s.body.pid, old);
    assert.deepEqual(s.body.workspaces?.map((w) => w.slug), ["gamma"]);
  });

  it("stops it for good — no supervisor starts it again", async () => {
    const { supervisor } = await daemonFile();
    const r = await kw(["daemon", "stop"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /daemon stopped/);
    await new Promise((res) => setTimeout(res, 1500));
    assert.equal((await status()).code, 3);
    assert.throws(() => process.kill(supervisor!, 0), "the supervisor is gone too");
    assert.match((await kw(["daemon", "stop"])).stdout, /No daemon running/);
  });

  it("`kraftwerk daemon -d` is start", async () => {
    const r = await kw(["daemon", "-d"]);
    assert.equal(r.code, 0, r.all);
    assert.equal((await status()).body.running, true);
    assert.equal((await kw(["daemon", "stop"])).code, 0);
  });
});
