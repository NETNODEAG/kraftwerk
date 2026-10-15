import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli, json } from "../helpers/cli.js";
import { startStubCloud, type StubCloud } from "../helpers/cloud.js";
import { makeProject, type Fixture } from "../helpers/project.js";

/**
 * `kraftwerk invite`, real processes against a local stub cloud: the daemon
 * asks the cloud for an invite on the machine's behalf, so an unclaimed
 * machine is told to log in first, a workspace without its ws_ id to run
 * doctor --fix; claimed, it prints the join code and link. The web UI is a
 * stub (KRAFTWERK_WEB_DIR).
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

describe("kraftwerk invite", { timeout: 90_000 }, () => {
  let fx: Fixture;
  let bare: Fixture;
  let cloud: StubCloud;
  let web = "";
  let port = 0;
  let daemon: ChildProcess | null = null;
  const env = () => ({ KRAFTWERK_CLOUD_URL: cloud.url, KRAFTWERK_WEB_DIR: web, KRAFTWERK_DAEMON_PORT: String(port) });
  const run = (args: string[], cwd = fx.root) => cli(cwd, fx.home, args, { env: env() });
  const waitFor = async (ok: () => boolean | Promise<boolean>, ms = 20_000) => {
    const until = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > until) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  before(async () => {
    cloud = await startStubCloud({ interval: 1 });
    port = await freePort();
    fx = await makeProject("id: ws_alpha00001\nname: Alpha\nslug: alpha\ngit:\n  interval: 0\n");
    bare = await makeProject("name: Bare\nslug: bare\ngit:\n  interval: 0\n");
    web = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-web-"));
    await writeFile(path.join(web, "index.html"), "<!doctype html><title>stub</title>");
  });
  after(async () => {
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
      const d = daemon;
      await new Promise<void>((resolve) => {
        d.once("exit", () => resolve());
        d.kill("SIGTERM");
      });
    }
    await cloud.close();
    await rm(web, { recursive: true, force: true });
    await fx.cleanup();
    await bare.cleanup();
  });

  it("without a daemon, or outside a workspace with an id, it says what to do", async () => {
    const none = await run(["invite"]);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /the daemon is not running — `kraftwerk daemon start`/);
    const noId = await run(["invite"], bare.root);
    assert.equal(noId.code, 1);
    assert.match(noId.stderr, /no id \(ws_…\) in kraftwerk\.yml — run `kraftwerk doctor --fix`/);
    const role = await run(["invite", "--role", "admin"]);
    assert.equal(role.code, 2);
    assert.equal(cloud.invites().length, 0);
  });

  it("an unclaimed machine is told to log in; claimed, it prints the join code and link", async () => {
    daemon = spawn(process.execPath, [BIN, "daemon"], { cwd: fx.root, env: { ...process.env, ...env(), HOME: fx.home, NO_COLOR: "1" }, stdio: "ignore" });
    await waitFor(() => cloud.calls("register").length > 0);
    assert.equal((await run(["ui"])).code, 0);
    await waitFor(() => cloud.calls("heartbeat").some((h) => (h.body.workspaces as Array<{ id?: string }> | undefined)?.some((w) => w.id === "ws_alpha00001") ?? false));

    const unclaimed = await run(["invite"]);
    assert.equal(unclaimed.code, 1, unclaimed.all);
    assert.match(unclaimed.stderr, /not claimed — run `kraftwerk login` first/);
    assert.equal(cloud.invites().length, 0, "the cloud is not asked");

    const { relayId, fromBase64Url } = await import("../../src/client/relay.js");
    const key = (JSON.parse(await readFile(path.join(fx.home, ".kraftwerk", "relay.json"), "utf8")) as { publicKey: string; secret: string });
    cloud.claim(await relayId(fromBase64Url(key.publicKey)), "alice@example.com");
    await waitFor(async () => json<{ account: string | null }>(await run(["cloud", "--json"])).account === "alice@example.com");

    const ok = await run(["invite"]);
    assert.equal(ok.code, 0, ok.all);
    assert.match(ok.stdout, /invite to Alpha \(alpha, ws_alpha00001\) as member/);
    assert.match(ok.stdout, /code\s+JOIN-\d{4}/);
    assert.match(ok.stdout, new RegExp(`join link\\s+${cloud.url.replace(/[.]/g, "\\.")}/join/JOIN-\\d{4}`));
    const hit = cloud.invites().at(-1)!;
    assert.equal(hit.path, "/api/workspaces/ws_alpha00001/invites");
    assert.equal(hit.body.secret, key.secret, "asked with the machine's credentials");
    assert.equal(hit.body.role, undefined);

    const owner = json<{ role: string; code: string; workspace: { slug: string } }>(await run(["invite", "--workspace", "alpha", "--role", "owner", "--json"], os.tmpdir()));
    assert.equal(owner.role, "owner");
    assert.equal(owner.workspace.slug, "alpha");
    assert.match(owner.code, /^JOIN-/);
    assert.equal(cloud.invites().at(-1)!.body.role, "owner");

    const unknown = await run(["invite", "--workspace", "nope"], os.tmpdir());
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /does not serve "nope"/);
  });
});
