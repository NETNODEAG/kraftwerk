import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeEmptyDir } from "../helpers/project.js";

/** Definition CRUD on agents/<slug>/routines.yml. `run` needs a server and is covered by the API layer. */
describe("kraftwerk routines", () => {
  let dir: Awaited<ReturnType<typeof makeEmptyDir>>;
  const run = (args: string[], stdin?: string) => cli(dir.root, dir.home, ["routines", ...args], { stdin });
  const file = () => readFile(path.join(dir.root, "kraftwerk-data", "agents", "max", "routines.yml"), "utf8");
  type Status = { id: string; enabled: boolean; schedule: string; prompt: string; nextRunAt?: string };

  before(async () => {
    dir = await makeEmptyDir();
    await cli(dir.root, dir.home, ["init"]);
  });
  after(() => dir.cleanup());

  it("starts empty and refuses an unknown agent", async () => {
    const r = await run([]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /No routines yet/);
    const nope = await run(["list", "ghost"]);
    assert.equal(nope.code, 2);
    assert.match(nope.stderr, /Agent "ghost" not found/);
  });

  it("add creates a routine with a derived id and a next run", async () => {
    const r = await run(["add", "max", "--name", "Morning triage", "--schedule", "0 9 * * 1-5", "--prompt", "Triage the inbox."]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ created max\/morning-triage \(0 9 \* \* 1-5\)/);
    const all = json<Record<string, Status[]>>(await run(["list", "--json"]));
    assert.equal(all.max.length, 1);
    assert.equal(all.max[0].enabled, true);
    assert.equal(all.max[0].prompt, "Triage the inbox.");
    assert.ok(all.max[0].nextRunAt, "an enabled routine has a next run");
    assert.match(await file(), /morning-triage/);
    assert.match(await file(), /^ {2}runs_on: [a-z0-9._-]+@[a-z0-9._-]+$/m, "a new routine runs on this machine");
    assert.match((await run([])).stdout, /runs here/);
  });

  it("add with the same id updates, stdin supplies the prompt", async () => {
    const r = await run(["add", "max", "--id", "morning-triage", "--name", "Morning triage", "--schedule", "@daily"], "From stdin.\n");
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ updated max\/morning-triage \(@daily\)/);
    const all = json<Record<string, Status[]>>(await run(["list", "max", "--json"]));
    assert.equal(all.max.length, 1);
    assert.equal(all.max[0].schedule, "@daily");
    assert.equal(all.max[0].prompt.trim(), "From stdin.");
  });

  it("rejects a bad schedule and an empty prompt", async () => {
    const bad = await run(["add", "max", "--name", "Broken", "--schedule", "every tuesday", "--prompt", "x"]);
    assert.equal(bad.code, 2);
    const empty = await run(["add", "max", "--name", "Empty", "--schedule", "@hourly"], "");
    assert.equal(empty.code, 2);
    assert.match(empty.stderr, /No prompt/);
  });

  it("disable / enable flip the flag, remove deletes", async () => {
    assert.match((await run(["disable", "max", "morning-triage"])).stdout, /disabled/);
    let all = json<Record<string, Status[]>>(await run(["list", "max", "--json"]));
    assert.equal(all.max[0].enabled, false);
    assert.equal(all.max[0].nextRunAt, undefined);

    assert.match((await run(["enable", "max", "morning-triage"])).stdout, /enabled/);
    all = json<Record<string, Status[]>>(await run(["list", "max", "--json"]));
    assert.equal(all.max[0].enabled, true);

    const removed = await run(["remove", "max", "morning-triage"]);
    assert.equal(removed.code, 0, removed.all);
    assert.match(removed.stdout, /✔ removed max\/morning-triage/);
    assert.deepEqual(json<Record<string, Status[]>>(await run(["list", "max", "--json"])).max, []);
    const again = await run(["remove", "max", "morning-triage"]);
    assert.equal(again.code, 2);
  });

  it("run without a server fails with a pointer to `kraftwerk ui`", async () => {
    const r = await run(["run", "max", "anything", "--port", "1"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Inspector not reachable on localhost:1/);
  });

  it("adopt makes this machine the runner of every unassigned routine; outside git it says it did not commit", async () => {
    await writeFile(
      path.join(dir.root, "kraftwerk-data", "agents", "max", "routines.yml"),
      "- id: loose\n  name: Loose\n  schedule: \"@daily\"\n  prompt: p\n  enabled: true\n  private: false\n" +
        "- id: theirs\n  name: Theirs\n  schedule: \"@daily\"\n  prompt: p\n  enabled: true\n  runs_on: anna@laptop\n",
    );
    const listed = await run([]);
    assert.match(listed.stdout, /loose .*unassigned/);
    assert.match(listed.stdout, /theirs .*runs on anna@laptop/);
    assert.equal(json<Record<string, Status[]>>(await run(["list", "--json"])).max.find((r) => r.id === "loose")?.nextRunAt, undefined, "unassigned: no next run");

    const r = await run(["adopt"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ max\/loose runs on [a-z0-9._-]+@[a-z0-9._-]+/);
    assert.doesNotMatch(r.stdout, /theirs/, "another machine's routine stays its own");
    assert.match(r.stdout, /written, not committed: the workspace is not a git repository — commit kraftwerk-data\/agents\/max\/routines\.yml yourself/);
    const yml = await file();
    assert.match(yml, /id: loose[\s\S]*private: false\n {2}runs_on: |id: loose[\s\S]*runs_on: [^\n]+\n {2}private: false/, "private survives the rewrite");
    assert.match(yml, /runs_on: anna@laptop/);
    assert.match((await run(["adopt"])).stdout, /nothing to adopt/);
  });
});
