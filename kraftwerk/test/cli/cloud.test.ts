import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
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
 * The kraftwerk cloud from the terminal, real processes against a local
 * stub cloud: what doctor says about a workspace, `kraftwerk cloud
 * [status|on|off]`, `kraftwerk login` (claim link and code, waits for the
 * claim made "in the browser") and `logout` — without a daemon (the CLI
 * talks to the cloud itself) and with one (the daemon registers the machine
 * and the CLI asks it). The web UI is a stub (KRAFTWERK_WEB_DIR).
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

describe("kraftwerk.yml cloud: what doctor says", () => {
  let fx: Fixture;
  before(async () => {
    fx = await makeProject("name: fixture\n");
  });
  after(() => fx.cleanup());

  const doctor = async (config: string, env: Record<string, string> = {}) => {
    await fx.write("kraftwerk.yml", `name: fixture\n${config}`);
    // The helper pins KRAFTWERK_CLOUD_URL=off; doctor never registers, so the default URL is safe to show here.
    return cli(fx.root, fx.home, ["doctor"], { env: { KRAFTWERK_CLOUD_URL: "", ...env } });
  };

  it("refuses malformed values, and a token in the file", async () => {
    const cases: Array<[string, RegExp]> = [
      ["cloud: 42\n", /cloud must be a mapping/],
      ["cloud:\n  host: x\n", /cloud\.host is unknown/],
      ["cloud:\n  token: kwc_abc\n", /cloud\.token does not belong in kraftwerk\.yml — the cloud knows the machine, and `kraftwerk login` claims it/],
      ["cloud:\n  url: kraftwerk.start\n", /cloud\.url must be an http\(s\) origin/],
      ["cloud:\n  interval: 0\n", /cloud\.interval must be a positive integer/],
      ["cloud:\n  enabled: yes please\n", /cloud\.enabled must be true or false/],
    ];
    for (const [config, error] of cases) {
      const r = await doctor(config);
      assert.equal(r.code, 1, config);
      assert.match(r.stdout, error, config);
    }
  });

  it("on by default: the daemon registers the machine and lists the workspace; a veto leaves it out", async () => {
    const none = await doctor("");
    assert.match(none.stdout, /✔ cloud: https:\/\/srv\.kraftwerk-cloud\.netnode\.cloud — the daemon registers this machine and lists this workspace/);
    const vetoed = await doctor("cloud:\n  enabled: false\n");
    assert.match(vetoed.stdout, /cloud: this workspace is left out — cloud\.enabled: false in kraftwerk\.yml/);
  });

  it("off for the machine: KRAFTWERK_CLOUD_URL=off, or cloud.json", async () => {
    const off = await doctor("", { KRAFTWERK_CLOUD_URL: "off" });
    assert.match(off.stdout, /• cloud: off — KRAFTWERK_CLOUD_URL=off/);
    await writeFile(path.join(fx.home, ".kraftwerk", "cloud.json"), JSON.stringify({ enabled: false }));
    try {
      const file = await doctor("");
      assert.match(file.stdout, /• cloud: off — turned off for this machine/);
    } finally {
      await rm(path.join(fx.home, ".kraftwerk", "cloud.json"), { force: true });
    }
  });

  it("a cloud.url in kraftwerk.yml is deprecated: used when the machine names none, ignored when it does", async () => {
    const used = await doctor("cloud:\n  url: https://cloud.example.com\n");
    assert.match(used.stdout, /cloud: https:\/\/cloud\.example\.com/);
    assert.match(used.stdout, /kraftwerk\.yml cloud\.url is deprecated — the cloud is the machine's now/);
    const env = await doctor("cloud:\n  url: https://cloud.example.com\n", { KRAFTWERK_CLOUD_URL: "https://other.example.com" });
    assert.match(env.stdout, /cloud: https:\/\/other\.example\.com/);
    assert.match(env.stdout, /deprecated — ignored: the machine's cloud is https:\/\/other\.example\.com \(env\)/);
  });
});

describe("kraftwerk cloud | login | logout", () => {
  let fx: Fixture;
  let cloud: StubCloud;
  let web = "";
  let port = 0;
  let autoClaim: string | null = null;
  const running: ChildProcess[] = [];
  const env = () => ({ KRAFTWERK_CLOUD_URL: cloud.url, KRAFTWERK_WEB_DIR: web, KRAFTWERK_DAEMON_PORT: String(port) });
  const run = (args: string[]) => cli(fx.root, fx.home, args, { env: env() });
  const relay = async () => JSON.parse(await readFile(path.join(fx.home, ".kraftwerk", "relay.json"), "utf8")) as { enabled: boolean; secret: string };
  const waitFor = async (ok: () => boolean | Promise<boolean>, ms = 20_000) => {
    const until = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > until) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const stop = (child: ChildProcess) =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });

  before(async () => {
    // A claim "in the browser" while `login` waits: the stub grants it on the next heartbeat.
    cloud = await startStubCloud({
      interval: 1,
      onHeartbeat: (id, c) => {
        if (autoClaim) c.claim(id, autoClaim);
      },
    });
    port = await freePort();
    fx = await makeProject("name: Alpha\nslug: alpha\ngit:\n  interval: 0\n");
    web = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-web-"));
    await writeFile(path.join(web, "index.html"), "<!doctype html><title>stub</title>");
  });
  after(async () => {
    for (const c of running) await stop(c);
    await cloud.close();
    await rm(web, { recursive: true, force: true });
    await fx.cleanup();
  });

  it("status without a daemon: on by default, no machine id yet, not reporting", async () => {
    const st = json<Record<string, unknown>>(await run(["cloud", "--json"]));
    assert.equal(st.enabled, true);
    assert.equal(st.url, cloud.url);
    assert.equal(st.source, "env");
    assert.equal(st.id, null);
    assert.equal(st.daemon, false);
    assert.equal(st.registered, false);
    const text = await run(["cloud"]);
    assert.equal(text.code, 0, text.all);
    assert.match(text.stdout, /kraftwerk cloud on/);
    assert.match(text.stdout, /not reporting — the daemon registers this machine/);
    assert.equal(cloud.hits.length, 0, "status asks no cloud");
  });

  it("off and on write ~/.kraftwerk/cloud.json", async () => {
    const off = await run(["cloud", "off"]);
    assert.equal(off.code, 0, off.all);
    assert.match(off.stdout, /cloud off for this machine/);
    assert.deepEqual(JSON.parse(await readFile(path.join(fx.home, ".kraftwerk", "cloud.json"), "utf8")), { enabled: false });
    assert.equal(json<{ enabled: boolean }>(await run(["cloud", "status", "--json"])).enabled, false);
    const on = await run(["cloud", "on"]);
    assert.match(on.stdout, /cloud on for this machine/);
    assert.equal(json<{ enabled: boolean }>(await run(["cloud", "status", "--json"])).enabled, true);
  });

  it("login without a daemon: registers the machine, prints the claim link and code, waits for the claim", async () => {
    autoClaim = "bob@example.com";
    const r = await run(["login", "--timeout", "20"]);
    autoClaim = null;
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /claim code\s+CODE-\d+/);
    assert.match(r.stdout, new RegExp(`claim link\\s+${cloud.url.replace(/[.]/g, "\\.")}/claim/CODE-\\d+`));
    assert.match(r.stdout, /logged in as bob@example\.com/);
    const reg = cloud.calls("register").at(-1)!.body;
    assert.deepEqual(reg.workspaces, []);
    assert.equal(reg.secret, (await relay()).secret);
    assert.equal((await relay()).enabled, false, "the machine key exists; the relay stays off");
    assert.ok(cloud.calls("heartbeat").length >= 1);
    assert.equal(cloud.calls("goodbye").length, 1, "nothing reports afterwards without a daemon: the record says so now");

    const again = await run(["login"]);
    assert.equal(again.code, 0, again.all);
    assert.match(again.stdout, /already logged in as bob@example\.com/);
  });

  it("logout releases the machine and prints the fresh claim code", async () => {
    const r = await run(["logout"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /logged out — this machine is unclaimed/);
    assert.match(r.stdout, /claim code\s+CODE-\d+/);
    assert.equal(cloud.calls("unlink").length, 1);
    assert.equal([...cloud.machines.values()][0].account, null);
  });

  it("login gives up after --timeout when nobody claims", async () => {
    const r = await run(["login", "--timeout", "2"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not claimed within 2s/);
  });

  it("with the daemon: it registers the machine, reports the workspace, and login/off go through it", async () => {
    const child = spawn(process.execPath, [BIN, "daemon"], { cwd: fx.root, env: { ...process.env, ...env(), HOME: fx.home, NO_COLOR: "1" }, stdio: "ignore" });
    running.push(child);
    const registers = cloud.calls("register").length;
    await waitFor(() => cloud.calls("register").length > registers);
    assert.equal((await run(["ui"])).code, 0);
    await waitFor(() => cloud.calls("heartbeat").some((h) => (h.body.workspaces as Array<{ slug: string }> | undefined)?.some((w) => w.slug === "alpha") ?? false));

    const st = json<Record<string, unknown>>(await run(["cloud", "--json"]));
    assert.equal(st.daemon, true);
    assert.equal(st.registered, true);
    assert.equal(st.claimed, false);
    assert.match(String(st.claimCode), /^CODE-/);
    assert.equal(st.workspaces, 1);
    assert.ok(st.lastSeen);

    autoClaim = "carol@example.com";
    const login = await run(["login", "--timeout", "20"]);
    autoClaim = null;
    assert.equal(login.code, 0, login.all);
    assert.match(login.stdout, /logged in as carol@example\.com/);
    // Claimed: the daemon's next heartbeat carries the root.
    await waitFor(() => cloud.calls("heartbeat").some((h) => (h.body.workspaces as Array<{ root?: string }> | undefined)?.some((w) => !!w.root) ?? false));
    assert.equal(json<{ account: string }>(await run(["cloud", "--json"])).account, "carol@example.com");

    const goodbyes = cloud.calls("goodbye").length;
    const off = await run(["cloud", "off"]);
    assert.match(off.stdout, /the daemon said goodbye/);
    assert.equal(cloud.calls("goodbye").length, goodbyes + 1);
    assert.equal(json<{ state: string }>(await run(["cloud", "--json"])).state, "off");
    assert.equal(existsSync(path.join(fx.home, ".kraftwerk", "cloud")), false);
  });
});
