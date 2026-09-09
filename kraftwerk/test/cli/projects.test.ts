import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { ProjectDetail, ProjectsView } from "../../src/inspector/projects.js";

/** `kraftwerk projects`: flag, create, list, show, link/unlink, log, remove — and doctor on the config key. */
describe("kraftwerk projects", () => {
  let fx: Fixture;
  before(async () => {
    fx = await makeProject("name: fixture\n");
  });
  after(() => fx.cleanup());

  const dir = () => path.join(fx.root, "kraftwerk-data/projects/demo-project");

  it("refuses everything while the feature is off", async () => {
    const r = await cli(fx.root, fx.home, ["projects"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /projects are off/);
    assert.equal((await cli(fx.root, fx.home, ["projects", "create", "Demo"])).code, 1);
  });

  it("doctor rejects a root outside the project and unknown keys", async () => {
    for (const root of ["..", "/tmp", "."]) {
      await fx.write("kraftwerk.yml", `name: fixture\nprojects:\n  root: ${JSON.stringify(root)}\n`);
      const r = await cli(fx.root, fx.home, ["doctor"]);
      assert.equal(r.code, 1, root);
      assert.match(r.stdout, /kraftwerk\.yml: projects\.root must be a directory inside the project/, root);
    }
    await fx.write("kraftwerk.yml", "name: fixture\nprojects:\n  colour: red\n");
    assert.match((await cli(fx.root, fx.home, ["doctor"])).stdout, /projects\.colour is unknown/);
  });

  it("create scaffolds the starter and list shows it, from a subdirectory too", async () => {
    await fx.write("kraftwerk.yml", "name: fixture\nprojects:\n"); // bare key: on, default root kraftwerk-data/projects
    const r = await cli(fx.root, fx.home, ["projects", "create", "Demo Project", "--goal", "Prove the CLI", "--harness", "pi", "--model", "sonnet", "--json"]);
    assert.equal(r.code, 0, r.all);
    const p = json<ProjectDetail>(r);
    assert.equal(p.slug, "demo-project");
    assert.equal(p.goal, "Prove the CLI");
    assert.equal(p.harness, "pi");
    assert.equal(p.model, "sonnet");
    assert.match(await readFile(path.join(dir(), "project.yml"), "utf8"), /^harness: pi$/m);
    assert.equal((await cli(fx.root, fx.home, ["projects", "create", "Bad", "--harness", "gemini"])).code, 1, "unknown harness");
    for (const f of ["project.yml", "brief.md", "state.md", "log.md"]) assert.ok(existsSync(path.join(dir(), f)), f);

    await fx.write("kraftwerk-data/knowledge/.keep", "");
    const sub = await cli(path.join(fx.root, "kraftwerk-data"), fx.home, ["projects", "--json"]);
    assert.equal(sub.code, 0, sub.all);
    const v = json<ProjectsView>(sub);
    assert.equal(v.enabled, true);
    assert.deepEqual(v.projects.map((x) => x.slug), ["demo-project"]);

    const table = await cli(fx.root, fx.home, ["projects"]);
    assert.match(table.stdout, /Demo Project/);
    assert.match(table.stdout, /Prove the CLI/);
    assert.equal((await cli(fx.root, fx.home, ["projects", "create", "Demo Project"])).code, 1, "duplicate");
  });

  it("set changes harness, model and effort; show prints what the project runs on", async () => {
    let r = await cli(fx.root, fx.home, ["projects", "set", "demo-project", "--harness", "codex", "--effort", "high", "--model", ""]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ demo-project runs on codex · effort high/);
    const yml = await readFile(path.join(dir(), "project.yml"), "utf8");
    assert.match(yml, /^harness: codex$/m);
    assert.match(yml, /^effort: high$/m);
    assert.doesNotMatch(yml, /^model:/m);
    assert.match((await cli(fx.root, fx.home, ["projects", "show", "demo-project"])).stdout, /runs on codex · effort high/);
    assert.equal((await cli(fx.root, fx.home, ["projects", "set", "demo-project"])).code, 1, "nothing to set");
    r = await cli(fx.root, fx.home, ["projects", "set", "demo-project", "--effort", "extreme"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /effort must be one of/);
  });

  it("link and unlink edit project.yml and report whether the target exists", async () => {
    let r = await cli(fx.root, fx.home, ["projects", "link", "demo-project", "workflows", "website-check"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /✔ linked workflows website-check to demo-project \(not found in this workspace yet\)/);
    assert.match(await readFile(path.join(dir(), "project.yml"), "utf8"), /^workflows:\n  - website-check$/m);

    const show = await cli(fx.root, fx.home, ["projects", "show", "demo-project"]);
    assert.equal(show.code, 0, show.all);
    assert.match(show.stdout, /Demo Project/);
    assert.match(show.stdout, /\? website-check \(not found\)/);

    r = await cli(fx.root, fx.home, ["projects", "unlink", "demo-project", "workflows", "website-check"]);
    assert.equal(r.code, 0, r.all);
    assert.doesNotMatch(await readFile(path.join(dir(), "project.yml"), "utf8"), /website-check/);
    assert.equal((await cli(fx.root, fx.home, ["projects", "link", "demo-project", "tickets", "x"])).code, 1, "unknown kind");
    assert.equal((await cli(fx.root, fx.home, ["projects", "link", "nope", "agents", "x"])).code, 1, "unknown project");
  });

  it("log appends a dated, attributed line; show prints it", async () => {
    const r = await cli(fx.root, fx.home, ["projects", "log", "demo-project", "Kickoff done.", "--actor", "max/claude"]);
    assert.equal(r.code, 0, r.all);
    const log = await readFile(path.join(dir(), "log.md"), "utf8");
    assert.match(log, /^\* Kickoff done\. \(max\/claude\)$/m);
    assert.match(log, new RegExp(`^## ${new Date().toISOString().slice(0, 10)}$`, "m"));
    assert.match((await cli(fx.root, fx.home, ["projects", "show", "demo-project"])).stdout, /Kickoff done/);
    assert.equal((await cli(fx.root, fx.home, ["projects", "log", "demo-project"])).code, 1, "empty entry");
  });

  it("remove deletes the folder; unknown slugs exit 1", async () => {
    const r = await cli(fx.root, fx.home, ["projects", "remove", "demo-project"]);
    assert.equal(r.code, 0, r.all);
    assert.ok(!existsSync(dir()));
    assert.equal((await cli(fx.root, fx.home, ["projects", "remove", "demo-project"])).code, 1);
    assert.deepEqual(json<ProjectsView>(await cli(fx.root, fx.home, ["projects", "--json"])).projects, []);
  });
});
