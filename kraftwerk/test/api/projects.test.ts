import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * /api/projects — the registry under $HOME/.kraftwerk/projects. Roots are
 * stored absolute whatever a caller sends: a `~/…` root in a request body
 * (no shell expands it there) must hit the same record as its expanded
 * form, never `<cwd>/~/…` or a literal tilde on disk.
 */
describe("/api/projects", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let otherRoot: string;
  before(async () => {
    fx = await makeProject();
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
    const dir = path.join(fx.home, ".kraftwerk", "projects");
    let files: string[] = [];
    for (let i = 0; i < 50 && files.length === 0; i++) {
      files = await readdir(dir).catch(() => [] as string[]);
      if (files.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    return Promise.all(files.map(async (f) => (JSON.parse(await readFile(path.join(dir, f), "utf8")) as { root: string }).root));
  };

  it("records this instance's root as an absolute path", async () => {
    const stored = await roots();
    assert.deepEqual(stored, [fx.root]);
    assert.ok(path.isAbsolute(stored[0]));
  });

  it("expands ~ in a root sent to the registry and stores the absolute form", async () => {
    const { registerProject } = await import("../../src/inspector/instances.js");
    await registerProject("~/other");
    const stored = await roots();
    assert.ok(stored.includes(otherRoot), `expected ${otherRoot} in ${stored.join(", ")}`);
    assert.ok(stored.every((r) => !r.includes("~")), `tilde stored: ${stored.join(", ")}`);

    const list = (await (await fetch(srv.url + "/api/projects")).json()) as { root?: string; name: string }[];
    const entry = list.find((e) => e.root === otherRoot);
    assert.ok(entry, "listed under its absolute root");
    assert.equal(entry.name, "Other");
  });

  it("forget and stop address a record by its ~ form too", async () => {
    const stop = await post("/api/projects/stop", { root: "~/other" });
    assert.equal(stop.status, 409);
    assert.equal(stop.body.error, "not running");

    const r = await post("/api/projects/forget", { root: "~/other" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(await roots(), [fx.root]);
  });

  it("start rejects a ~ root that does not exist with the expanded path in the error", async () => {
    const r = await post("/api/projects/start", { root: "~/nowhere" });
    assert.equal(r.status, 409);
    assert.match(String(r.body.error), new RegExp(path.join(fx.home, "nowhere").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(String(r.body.error), /~/);
  });
});
