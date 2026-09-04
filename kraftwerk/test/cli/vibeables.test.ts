import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { VibeableInfo, VibeablesView } from "../../src/inspector/vibeables.js";

/** `kraftwerk vibeables`: flag, create, list, remove — and doctor on the config key. */
describe("kraftwerk vibeables", () => {
  let fx: Fixture;
  before(async () => {
    fx = await makeProject("name: fixture\n");
  });
  after(() => fx.cleanup());

  it("refuses everything while the feature is off", async () => {
    const r = await cli(fx.root, fx.home, ["vibeables"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /vibeables are off/);
    assert.equal((await cli(fx.root, fx.home, ["vibeables", "create", "demo"])).code, 1);
  });

  it("doctor rejects a root outside the project", async () => {
    for (const root of ["..", "/tmp", "."]) {
      await fx.write("kraftwerk.yml", `name: fixture\nvibeables:\n  root: ${JSON.stringify(root)}\n`);
      const r = await cli(fx.root, fx.home, ["doctor"]);
      assert.equal(r.code, 1, root);
      assert.match(r.stdout, /kraftwerk\.yml: vibeables\.root must be a directory inside the project/, root);
    }
    await fx.write("kraftwerk.yml", "name: fixture\nvibeables:\n  colour: red\n");
    assert.match((await cli(fx.root, fx.home, ["doctor"])).stdout, /vibeables\.colour is unknown/);
  });

  it("create scaffolds the starter, list shows it, from a subdirectory too", async () => {
    await fx.write("kraftwerk.yml", "name: fixture\nvibeables:\n"); // bare key: on, default root kraftwerk-data/vibeables
    const r = await cli(fx.root, fx.home, ["vibeables", "create", "demo-app", "--json"]);
    assert.equal(r.code, 0, r.all);
    const v = json<VibeableInfo>(r);
    assert.equal(v.slug, "demo-app");
    // The CLI resolves its cwd through realpath (/var → /private/var on macOS); the tail is what matters.
    assert.ok(v.path.endsWith(path.join("kraftwerk-data/vibeables/demo-app")), v.path);
    assert.equal(v.hasIndex, true);
    const dir = path.join(fx.root, "kraftwerk-data/vibeables/demo-app");
    assert.match(await readFile(path.join(dir, "index.html"), "utf8"), /<h1>demo-app<\/h1>/);
    assert.ok(existsSync(path.join(dir, "vibeable.yml")));
    assert.ok(!existsSync(path.join(dir, ".git")), "part of the workspace, no repository of its own");
    assert.equal(fx.git("status", "--porcelain", "--", "kraftwerk-data/vibeables").split("\n").filter(Boolean).length > 0, true, "the workspace git sees it");

    assert.equal((await cli(fx.root, fx.home, ["vibeables", "create", "demo-app"])).code, 1, "same name twice");
    assert.equal((await cli(fx.root, fx.home, ["vibeables", "create", "../x"])).code, 1);
    const plain = await cli(fx.root, fx.home, ["vibeables", "create", "second"]);
    assert.equal(plain.code, 0, plain.all);
    assert.match(plain.stdout, /✔ second/);

    const list = await cli(path.join(fx.root, "kraftwerk-data"), fx.home, ["vibeables", "--json"]);
    assert.equal(list.code, 0, list.all);
    const view = json<VibeablesView>(list);
    assert.equal(view.enabled, true);
    assert.deepEqual(view.vibeables.map((x) => [x.slug, x.hasIndex, x.dev]), [["demo-app", true, undefined], ["second", true, undefined]]);
    const table = await cli(fx.root, fx.home, ["vibeables"]);
    assert.match(table.stdout, /demo-app/);
    assert.match(table.stdout, /static/);
  });

  it("remove deletes the folder", async () => {
    const r = await cli(fx.root, fx.home, ["vibeables", "remove", "second"]);
    assert.equal(r.code, 0, r.all);
    assert.ok(!existsSync(path.join(fx.root, "kraftwerk-data/vibeables/second")));
    assert.equal((await cli(fx.root, fx.home, ["vibeables", "remove", "second"])).code, 1);
    assert.deepEqual(json<VibeablesView>(await cli(fx.root, fx.home, ["vibeables", "--json"])).vibeables.map((x) => x.slug), ["demo-app"]);
  });
});
