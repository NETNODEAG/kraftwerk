import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { cli } from "../helpers/cli.js";

/**
 * `kraftwerk daemon install` / `uninstall`: the daemon as a macOS login item.
 * launchctl is a stand-in that records its calls (KRAFTWERK_LAUNCHCTL), and
 * HOME is private, so nothing is loaded into this machine's launchd.
 */
describe("kraftwerk daemon install", { skip: process.platform !== "darwin" && "a LaunchAgent is macOS only" }, () => {
  let home = "";
  let lc = "";
  const plist = () => path.join(home, "Library", "LaunchAgents", "ch.netnode.kraftwerk.daemon.plist");
  const calls = async () => (await readFile(path.join(home, "launchctl.log"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  const run = (args: string[], env: Record<string, string> = {}) =>
    cli(home, home, args, { env: { KRAFTWERK_LAUNCHCTL: lc, PATH: `/opt/agents/bin:${process.env.PATH}`, ...env } });

  before(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "kw-login-"));
    lc = path.join(home, "launchctl");
    await writeFile(lc, `#!/bin/sh\necho "$@" >> "${home}/launchctl.log"\n`);
    await chmod(lc, 0o755);
  });
  after(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("writes a LaunchAgent that runs this kraftwerk's daemon with the installing shell's PATH, and loads it", async () => {
    const r = await run(["daemon", "install"], { KRAFTWERK_DAEMON_PORT: "19777" });
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /login item installed and started/);
    const text = await readFile(plist(), "utf8");
    if (spawnSync("plutil", ["-lint", plist()]).status !== 0) assert.fail(`not a valid plist:\n${text}`);
    const json = JSON.parse(spawnSync("plutil", ["-convert", "json", "-o", "-", plist()], { encoding: "utf8" }).stdout) as {
      Label: string;
      ProgramArguments: string[];
      EnvironmentVariables: Record<string, string>;
      RunAtLoad: boolean;
      StandardOutPath: string;
    };
    assert.equal(json.Label, "ch.netnode.kraftwerk.daemon");
    assert.equal(json.ProgramArguments[0], process.execPath, "the node that installed it");
    assert.match(json.ProgramArguments[1], /bin[/\\]kraftwerk\.js$/);
    assert.deepEqual(json.ProgramArguments.slice(2), ["daemon"]);
    assert.match(json.EnvironmentVariables.PATH, /^\/opt\/agents\/bin:/, "launchd's own PATH would not find the agents");
    assert.equal(json.EnvironmentVariables.KRAFTWERK_DAEMON_PORT, "19777");
    assert.equal(json.RunAtLoad, true);
    assert.equal(json.StandardOutPath, path.join(home, ".kraftwerk", "logs", "daemon.log"));
    const uid = os.userInfo().uid;
    assert.deepEqual(await calls(), [`bootout gui/${uid}/ch.netnode.kraftwerk.daemon`, `bootstrap gui/${uid} ${plist()}`]);
  });

  it("with a daemon already running, installs for the next login without starting a second", async () => {
    const daemon = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ daemon: true, port: (daemon.address() as AddressInfo).port, workspaces: [] }));
    });
    await new Promise<void>((r) => daemon.listen(0, "127.0.0.1", r));
    const port = (daemon.address() as AddressInfo).port;
    await mkdir(path.join(home, ".kraftwerk"), { recursive: true });
    await writeFile(path.join(home, ".kraftwerk", "daemon.json"), JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString(), open: [] }));
    await rm(path.join(home, "launchctl.log"), { force: true });
    try {
      const r = await run(["daemon", "install", "--port", String(port)]);
      assert.equal(r.code, 0, r.all);
      assert.match(r.stdout, /already runs .*next login/s);
      assert.ok(!(await calls()).some((c) => c.startsWith("bootstrap")), "not loaded now");
      assert.match(await readFile(plist(), "utf8"), new RegExp(`<string>--port</string>\\s*<string>${port}</string>`));
    } finally {
      await new Promise<void>((r) => daemon.close(() => r()));
      await rm(path.join(home, ".kraftwerk", "daemon.json"), { force: true });
    }
  });

  it("uninstall unloads and removes it; again, there is nothing to remove", async () => {
    await rm(path.join(home, "launchctl.log"), { force: true });
    const r = await run(["daemon", "uninstall"]);
    assert.equal(r.code, 0, r.all);
    assert.ok(!existsSync(plist()));
    assert.deepEqual(await calls(), [`bootout gui/${os.userInfo().uid}/ch.netnode.kraftwerk.daemon`]);
    const again = await run(["daemon", "uninstall"]);
    assert.equal(again.code, 0);
    assert.match(again.stdout, /No login item installed/);
  });
});
