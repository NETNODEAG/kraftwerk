import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Telling a busy daemon from a stopped one. A daemon under load can take
 * seconds to answer; read as stopped, it was started a second time (which
 * crashed on its port) or restarted (which interrupted its agents). Busy:
 * the process lives and its port is taken, but no answer came in time.
 */
describe("daemon state: running, busy, stopped", () => {
  let home = "";
  const prevHome = process.env.HOME;
  const servers: Array<http.Server | net.Server> = [];
  const listen = (s: http.Server | net.Server): Promise<number> =>
    new Promise((resolve) => {
      servers.push(s);
      s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port));
    });
  const record = (pid: number, port: number) =>
    writeFile(path.join(home, ".kraftwerk", "daemon.json"), JSON.stringify({ pid, port, startedAt: new Date().toISOString() }));

  before(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-daemon-state-"));
    await mkdir(path.join(home, ".kraftwerk"), { recursive: true });
    process.env.HOME = home;
  });
  after(async () => {
    for (const s of servers) s.close();
    process.env.HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  });

  it("stopped without a daemon file", async () => {
    const { daemonState } = await import("../../src/core/daemon.js");
    assert.deepEqual(await daemonState(300), { state: "stopped" });
  });

  it("running when it answers as the daemon", async () => {
    const port = await listen(http.createServer((_req, res) => res.end(JSON.stringify({ daemon: true }))));
    await record(process.pid, port);
    const { daemonState } = await import("../../src/core/daemon.js");
    assert.deepEqual(await daemonState(1000), { state: "running", pid: process.pid, port });
  });

  it("busy when its process lives and holds the port but does not answer in time", async () => {
    // Accepts the connection, never answers: a daemon stuck behind its agents.
    const port = await listen(net.createServer(() => {}));
    await record(process.pid, port);
    const { daemonState, findDaemon } = await import("../../src/core/daemon.js");
    assert.equal(await findDaemon(300), null, "no answer in time");
    assert.deepEqual(await daemonState(300), { state: "busy", pid: process.pid, port });
  });

  it("stopped when its process is gone, even if something else holds the port", async () => {
    const port = await listen(net.createServer(() => {}));
    const gone = spawn(process.execPath, ["-e", ""]);
    await new Promise((r) => gone.once("exit", r));
    await record(gone.pid!, port);
    const { daemonState } = await import("../../src/core/daemon.js");
    assert.deepEqual(await daemonState(300), { state: "stopped" });
  });

  it("stopped when its process lives but the port is free", async () => {
    const free = await listen(net.createServer());
    servers.pop()!.close();
    await new Promise((r) => setTimeout(r, 50));
    await record(process.pid, free);
    const { daemonState } = await import("../../src/core/daemon.js");
    assert.deepEqual(await daemonState(300), { state: "stopped" });
  });
});
