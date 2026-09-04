import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeEmptyDir } from "../helpers/project.js";

/** The registry under $HOME/.kraftwerk: what `kraftwerk ui` records, `projects` shows and forgets. */
describe("kraftwerk projects", () => {
  let dir: Awaited<ReturnType<typeof makeEmptyDir>>;
  const run = (args: string[]) => cli(dir.root, dir.home, ["projects", ...args]);
  type Entry = { name: string; root?: string; live: boolean; lastStarted?: string; lastStopped?: string };

  before(async () => {
    dir = await makeEmptyDir();
    await cli(dir.root, dir.home, ["init"]);
  });
  after(() => dir.cleanup());

  it("knows nothing until a UI registered itself", async () => {
    const r = await run([]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /No projects known yet/);
    assert.deepEqual(json(await run(["--json"])), []);
  });

  it("lists a registered project as not running, by its kraftwerk.yml name", async () => {
    // Register the way the inspector does on start, with the same HOME the CLI sees.
    process.env.HOME = dir.home;
    const { registerProject } = await import("../../src/inspector/instances.js");
    await registerProject(dir.root);

    const entries = json<Entry[]>(await run(["--json"]));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "project");
    assert.equal(entries[0].root, dir.root);
    assert.equal(entries[0].live, false);
    const table = await run([]);
    assert.match(table.stdout, /project/);
    assert.match(table.stdout, /died|stopped/);
  });

  it("stop on a project that is not running is a no-op", async () => {
    const r = await run(["stop", "project"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /project is not running/);
  });

  it("a ~ ref addresses a project under HOME and the record stays absolute", async () => {
    // Registered with a tilde (what a quoted arg or a JSON body carries): stored expanded.
    process.env.HOME = dir.home;
    const { registerProject } = await import("../../src/inspector/instances.js");
    await registerProject("~/tilde-project");
    const entries = json<Entry[]>(await run(["--json"]));
    const rec = entries.find((e) => e.root === path.join(dir.home, "tilde-project"));
    assert.ok(rec, `absolute root missing in ${JSON.stringify(entries.map((e) => e.root))}`);
    assert.ok(entries.every((e) => !e.root?.includes("~")));

    const r = await run(["forget", "~/tilde-project"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ forgot tilde-project/);
    assert.equal(json<Entry[]>(await run(["--json"])).length, 1);
  });

  it("forget drops the record by name, folder name or path; unknown refs exit 2", async () => {
    const unknown = await run(["forget", "nothing-like-this"]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /No known project "nothing-like-this"/);

    const r = await run(["forget", path.basename(dir.root)]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ forgot project/);
    assert.deepEqual(json(await run(["--json"])), []);
  });
});
