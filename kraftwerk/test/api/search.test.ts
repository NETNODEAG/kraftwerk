import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { AgentSearch } from "../../src/inspector/search.js";
import type { ProjectRecord } from "../../src/inspector/instances.js";

/**
 * The ⌘K palette's data: this workspace's roster from disk plus every other
 * registered project's roster from ~/.kraftwerk/projects. One other project
 * is running (a stub answering /api/meta like an inspector, registered in
 * instances/), one is stopped; both carry a roster in their record.
 */
describe("agent search API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let other: http.Server;
  let otherRoot: string;
  let stoppedRoot: string;
  before(async () => {
    fx = await makeProject("name: fixture\nicon: 🏭\ngit:\n  interval: 0\n");
    await fx.write("agents/writer/agent.yml", "name: Writer\nemoji: ✍️\ndescription: drafts posts\n");
    await fx.write("agents/reviewer/agent.yml", "name: Reviewer\n");
    await fx.write("agents/old/agent.yml", "name: Old\narchived: true\n");

    // Two more project roots, each a real kraftwerk project (name/icon are read from there).
    otherRoot = path.join(await mkdtemp(path.join(os.tmpdir(), "kraftwerk-other-")), "project");
    stoppedRoot = path.join(await mkdtemp(path.join(os.tmpdir(), "kraftwerk-stopped-")), "project");
    await mkdir(otherRoot, { recursive: true });
    await mkdir(stoppedRoot, { recursive: true });
    await writeFile(path.join(otherRoot, "kraftwerk.yml"), "name: Other\nicon: 🛰️\n");
    await writeFile(path.join(stoppedRoot, "kraftwerk.yml"), "name: Dormant\n");

    other = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/api/meta")) res.end(JSON.stringify({ version: "0.0.0", projectName: "Other", projectIcon: "🛰️" }));
      else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    const otherPort = (other.address() as AddressInfo).port;

    const kw = path.join(fx.home, ".kraftwerk");
    await mkdir(path.join(kw, "instances"), { recursive: true });
    await mkdir(path.join(kw, "projects"), { recursive: true });
    await writeFile(path.join(kw, "instances", "111111.json"), JSON.stringify({ pid: 111111, port: otherPort, startedAt: "2026-01-01T00:00:00Z", root: otherRoot }));
    const record = (root: string, agents: unknown[]) =>
      JSON.stringify({ root, firstSeen: "2026-01-01T00:00:00Z", lastStarted: "2026-01-01T00:00:00Z", lastStopped: "2026-01-02T00:00:00Z", startCount: 1, agents });
    await writeFile(path.join(kw, "projects", "other.json"), record(otherRoot, [{ slug: "remote-bot", name: "Remote Bot", emoji: "🤖" }]));
    await writeFile(path.join(kw, "projects", "stopped.json"), record(stoppedRoot, [{ slug: "sleeper", name: "Sleeper", emoji: "😴", group: "Ops" }]));
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await new Promise<void>((r) => other.close(() => r()));
    await fx.cleanup();
    await rm(path.dirname(otherRoot), { recursive: true, force: true });
    await rm(path.dirname(stoppedRoot), { recursive: true, force: true });
  });

  const search = async (): Promise<AgentSearch> => (await fetch(srv.url + "/api/search/agents")).json();
  const ownRecord = async (): Promise<ProjectRecord | undefined> => {
    const dir = path.join(fx.home, ".kraftwerk", "projects");
    const recs = await Promise.all((await readdir(dir)).map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as ProjectRecord));
    return recs.find((r) => r.root === fx.root);
  };

  it("lists this workspace first with its active agents and the switcher URL", async () => {
    const { workspaces } = await search();
    const self = workspaces[0];
    assert.equal(self.current, true);
    assert.equal(self.live, true);
    assert.equal(self.name, "fixture");
    assert.equal(self.icon, "🏭");
    assert.equal(self.url, `http://localhost:${new URL(srv.url).port}`);
    assert.deepEqual(
      self.agents.map((a) => a.slug),
      ["reviewer", "writer"]
    );
    assert.deepEqual(self.agents[1], { slug: "writer", name: "Writer", emoji: "✍️", description: "drafts posts" });
  });

  it("lists the other projects' recorded rosters, running and stopped", async () => {
    const { workspaces } = await search();
    assert.equal(workspaces.length, 3, JSON.stringify(workspaces));
    const running = workspaces.find((w) => w.root === otherRoot);
    assert.ok(running);
    assert.equal(running.current, false);
    assert.equal(running.live, true);
    assert.equal(running.name, "Other");
    assert.equal(running.icon, "🛰️");
    assert.deepEqual(running.agents, [{ slug: "remote-bot", name: "Remote Bot", emoji: "🤖" }]);
    const stopped = workspaces.find((w) => w.root === stoppedRoot);
    assert.ok(stopped);
    assert.equal(stopped.live, false);
    assert.equal(stopped.name, "Dormant");
    assert.deepEqual(stopped.agents, [{ slug: "sleeper", name: "Sleeper", emoji: "😴", group: "Ops" }]);
  });

  it("records this workspace's roster in the project registry whenever it is read", async () => {
    let rec = await ownRecord();
    assert.deepEqual(
      rec?.agents?.map((a) => a.slug),
      ["reviewer", "writer"],
      "archived agents stay out of the record"
    );
    const r = await fetch(srv.url + "/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(srv.url).origin },
      body: JSON.stringify({ name: "Planner", emoji: "🗺️", harness: "claude", system: "plan things" }),
    });
    assert.equal(r.status, 200, await r.text());
    await fetch(srv.url + "/api/agents"); // the UI re-lists after a save; that read syncs
    rec = await ownRecord();
    assert.deepEqual(
      rec?.agents?.map((a) => a.slug),
      ["planner", "reviewer", "writer"]
    );
    assert.equal(rec?.startCount, 1, "the rest of the record is untouched");
  });
});
