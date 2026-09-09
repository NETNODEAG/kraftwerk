import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * /api/workspaces — the registry under $HOME/.kraftwerk/workspaces. Roots are
 * stored absolute whatever a caller sends: a `~/…` root in a request body
 * (no shell expands it there) must hit the same record as its expanded
 * form, never `<cwd>/~/…` or a literal tilde on disk.
 */
describe("/api/workspaces", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let otherRoot: string;
  let legacyRoot: string;
  before(async () => {
    fx = await makeProject();
    // A record written by a kraftwerk before 0.49 under the old registry name.
    legacyRoot = path.join(fx.home, "legacy");
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(path.join(legacyRoot, "kraftwerk.yml"), "name: Legacy\n");
    process.env.HOME = fx.home; // the registry paths are resolved when the module loads
    const { workspaceRecordName } = await import("../../src/inspector/instances.js");
    const legacyDir = path.join(fx.home, ".kraftwerk", "projects");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, workspaceRecordName(legacyRoot)), JSON.stringify({ root: legacyRoot, firstSeen: "2026-01-01T00:00:00.000Z", lastStarted: "2026-01-01T00:00:00.000Z", startCount: 1 }));
    // A second project *inside* the private HOME, so `~/other` addresses it.
    otherRoot = path.join(fx.home, "other");
    await mkdir(otherRoot, { recursive: true });
    await writeFile(path.join(otherRoot, "kraftwerk.yml"), "name: Other\n");
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  const post = async (route: string, body: unknown) => {
    const r = await fetch(srv.url + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  // Registration is fire-and-forget after listen; wait for the directory to appear.
  const roots = async (): Promise<string[]> => {
    const dir = path.join(fx.home, ".kraftwerk", "workspaces");
    let files: string[] = [];
    for (let i = 0; i < 50 && files.length === 0; i++) {
      files = await readdir(dir).catch(() => [] as string[]);
      if (files.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    return Promise.all(files.map(async (f) => (JSON.parse(await readFile(path.join(dir, f), "utf8")) as { root: string }).root));
  };

  it("records this instance's root as an absolute path", async () => {
    const stored = await roots();
    assert.ok(stored.includes(fx.root), `expected ${fx.root} in ${stored.join(", ")}`);
    assert.ok(stored.every((r) => path.isAbsolute(r)));
  });

  it("moves records from the pre-0.49 ~/.kraftwerk/projects into the workspaces registry", async () => {
    const stored = await roots();
    assert.ok(stored.includes(legacyRoot), `legacy record missing in ${stored.join(", ")}`);
    assert.equal((await readdir(path.join(fx.home, ".kraftwerk", "projects"))).length, 1, "the old directory stays for inspectors of older versions");
  });

  it("expands ~ in a root sent to the registry and stores the absolute form", async () => {
    const { registerWorkspace } = await import("../../src/inspector/instances.js");
    await registerWorkspace("~/other");
    const stored = await roots();
    assert.ok(stored.includes(otherRoot), `expected ${otherRoot} in ${stored.join(", ")}`);
    assert.ok(stored.every((r) => !r.includes("~")), `tilde stored: ${stored.join(", ")}`);

    const list = (await (await fetch(srv.url + "/api/workspaces")).json()) as { root?: string; name: string }[];
    const entry = list.find((e) => e.root === otherRoot);
    assert.ok(entry, "listed under its absolute root");
    assert.equal(entry.name, "Other");
    assert.equal(list.find((e) => e.root === legacyRoot)?.name, "Legacy", "the migrated record reads its name from its root");
  });

  it("forget and stop address a record by its ~ form too", async () => {
    const stop = await post("/api/workspaces/stop", { root: "~/other" });
    assert.equal(stop.status, 409);
    assert.equal(stop.body.error, "not running");

    const r = await post("/api/workspaces/forget", { root: "~/other" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(!(await roots()).includes(otherRoot));
  });

  it("forget drops a migrated record from the old directory too, so it does not come back", async () => {
    const r = await post("/api/workspaces/forget", { root: legacyRoot });
    assert.equal(r.status, 200);
    assert.deepEqual(await readdir(path.join(fx.home, ".kraftwerk", "projects")), []);
    assert.ok(!(await roots()).includes(legacyRoot));
  });

  it("start rejects a ~ root that does not exist with the expanded path in the error", async () => {
    const r = await post("/api/workspaces/start", { root: "~/nowhere" });
    assert.equal(r.status, 409);
    assert.match(String(r.body.error), new RegExp(path.join(fx.home, "nowhere").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(String(r.body.error), /~/);
  });
});
