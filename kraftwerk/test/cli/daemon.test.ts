import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";

/**
 * `kraftwerk daemon` and `kraftwerk ui` as a user runs them, real processes:
 * the daemon serves nothing until `kraftwerk ui` in a workspace folder hands
 * it that workspace; `kraftwerk workspaces stop` closes one there while the
 * daemon and the others keep running; a second daemon is refused; stopping
 * the daemon stamps its workspaces stopped, and starting it again reopens
 * what was open. Without a daemon, `kraftwerk ui` serves on its own, as
 * before. The web UI is a stub (KRAFTWERK_WEB_DIR): no build in tests.
 */
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/kraftwerk.js");

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

describe("kraftwerk daemon", () => {
  let a: Fixture;
  let b: Fixture;
  let web = "";
  let port = 0;
  let standalonePort = 0;
  const running: ChildProcess[] = [];
  /** Every CLI call shares one HOME: the machine's registry and daemon file. */
  const env = () => ({ KRAFTWERK_WEB_DIR: web, KRAFTWERK_DAEMON_PORT: String(port) });

  /** A long-running kraftwerk process (daemon, ui), stopped in `after`. */
  const startProcess = (args: string[], cwd: string): ChildProcess => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { ...process.env, ...env(), HOME: a.home, NO_COLOR: "1", KRAFTWERK_CLOUD_URL: "off" },
      stdio: "ignore",
    });
    running.push(child);
    return child;
  };
  const stop = (child: ChildProcess) =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  const get = async (p: string, at = port) => {
    try {
      const r = await fetch(`http://127.0.0.1:${at}${p}`, { signal: AbortSignal.timeout(2000) });
      return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null };
    } catch {
      return { status: 0, body: null };
    }
  };
  const waitFor = async (ok: () => Promise<boolean>, ms = 20_000) => {
    const until = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > until) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const slugs = async () => ((await get("/api/hub")).body?.workspaces as Array<{ slug: string }> | undefined)?.map((w) => w.slug) ?? [];

  before(async () => {
    port = await freePort();
    standalonePort = await freePort();
    a = await makeProject("name: Alpha\nslug: alpha\ngit:\n  interval: 0\n");
    b = await makeProject(`name: Beta\nslug: beta\nport: ${standalonePort}\ngit:\n  interval: 0\n`);
    web = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-web-"));
    await writeFile(path.join(web, "index.html"), "<!doctype html><title>stub</title>");
  });
  after(async () => {
    for (const c of running) await stop(c);
    await rm(web, { recursive: true, force: true });
    await a.cleanup();
    await b.cleanup();
  });

  it("serves nothing until `kraftwerk ui` hands it a workspace; then each at its slug", async () => {
    const daemon = startProcess(["daemon"], a.root);
    await waitFor(async () => (await get("/api/hub")).status === 200);
    assert.deepEqual(await slugs(), []);

    const ui = await cli(a.root, a.home, ["ui"], { env: env() });
    assert.equal(ui.code, 0, ui.all);
    assert.match(ui.stdout, new RegExp(`Kraftwerk UI: http://alpha\\.localhost:${port} \\(served by the kraftwerk daemon`));
    assert.equal((await cli(b.root, a.home, ["ui"], { env: env() })).code, 0);
    assert.deepEqual(await slugs(), ["alpha", "beta"]);
    assert.equal((await get("/w/alpha/api/meta?probe=1")).body?.workspaceSlug, "alpha");
    assert.equal((await get("/w/beta/api/meta?probe=1")).body?.workspaceSlug, "beta");
    // Beta's own port answers for it too (an alias of the daemon).
    assert.equal((await get("/api/meta?probe=1", standalonePort)).body?.workspaceSlug, "beta");
    // Handing it over again changes nothing.
    assert.equal((await cli(a.root, a.home, ["ui"], { env: env() })).code, 0);
    assert.deepEqual(await slugs(), ["alpha", "beta"]);
    assert.equal(daemon.exitCode, null);
  });

  it("refuses a second daemon", async () => {
    const second = await cli(b.root, a.home, ["daemon"], { env: { ...env(), KRAFTWERK_UI_SUPERVISED: "1" } });
    assert.equal(second.code, 1);
    assert.match(second.stderr, /a kraftwerk daemon already runs/);
  });

  it("`kraftwerk workspaces stop` closes one there; the daemon and the others keep running", async () => {
    const r = await cli(a.root, a.home, ["workspaces", "stop", "alpha"], { env: env() });
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /Alpha stopped/);
    assert.deepEqual(await slugs(), ["beta"]);
    assert.equal((await get("/w/alpha/api/meta")).status, 404);
    assert.equal((await get("/w/beta/api/meta?probe=1")).status, 200);
    const file = JSON.parse(await readFile(path.join(a.home, ".kraftwerk", "daemon.json"), "utf8")) as { open: string[] };
    // A process sees its folder resolved (/var is /private/var on macOS): the daemon notes the real path.
    assert.deepEqual(file.open, [await realpath(b.root)]);
  });

  it("stopping the daemon stamps its workspaces stopped; starting it again reopens what was open", async () => {
    await stop(running[0]);
    await waitFor(async () => (await get("/api/hub")).status === 0);
    const workspaces = await cli(a.root, a.home, ["workspaces", "list", "--json"], { env: env() });
    const betaRoot = await realpath(b.root);
    const beta = (JSON.parse(workspaces.stdout) as Array<{ root?: string; state?: string; live?: boolean }>).find((w) => w.root === betaRoot);
    assert.equal(beta?.live, false, workspaces.stdout);
    // A clean stop, not a crash: the registry record says stopped after it last started.
    const dir = path.join(a.home, ".kraftwerk", "workspaces");
    const recs = await Promise.all((await readdir(dir)).map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as { root: string; lastStarted: string; lastStopped?: string }));
    const rec = recs.find((r) => r.root === betaRoot);
    assert.ok(rec?.lastStopped && rec.lastStopped >= rec.lastStarted, JSON.stringify(rec));

    startProcess(["daemon"], a.root);
    await waitFor(async () => (await slugs()).includes("beta"));
    assert.deepEqual(await slugs(), ["beta"], "alpha was closed before, so it stays closed");
  });

  it("without a daemon, `kraftwerk ui` serves on its own as before", async () => {
    for (const c of running) await stop(c);
    await waitFor(async () => (await get("/api/hub")).status === 0);
    startProcess(["ui"], b.root);
    await waitFor(async () => (await get("/api/meta?probe=1", standalonePort)).status === 200);
    const meta = (await get("/api/meta?probe=1", standalonePort)).body;
    assert.equal(meta?.workspaceSlug, "beta");
    assert.equal((await get("/w/beta/api/meta?probe=1", standalonePort)).status, 200, "its slug works on its own server too");
  });
});
