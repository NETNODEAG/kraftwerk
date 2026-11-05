import { existsSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { TempView } from "../../src/core/temp.js";

/**
 * `kraftwerk temp`: lists the sessions' scratch folders under
 * kraftwerk-data/temp with files, size and last change; `clean` removes
 * the ones idle for a week, `--older-than <days>` moves the line,
 * `--all` takes every folder. Nothing goes to the trash.
 */
describe("kraftwerk temp", () => {
  let fx: Fixture;
  const root = () => path.join(fx.root, "kraftwerk-data/temp");
  const folder = async (id: string, content: string, at?: Date): Promise<void> => {
    await mkdir(path.join(root(), id), { recursive: true });
    await writeFile(path.join(root(), id, "a.txt"), content);
    if (at) {
      await utimes(path.join(root(), id, "a.txt"), at, at);
      await utimes(path.join(root(), id), at, at);
    }
  };

  before(async () => {
    fx = await makeProject();
  });
  after(() => fx.cleanup());

  it("lists nothing in a fresh workspace", async () => {
    const r = await cli(fx.root, fx.home, ["temp"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /No scratch folders/);
    assert.deepEqual(json<TempView>(await cli(fx.root, fx.home, ["temp", "--json"])).entries, []);
  });

  it("lists folders newest first with files, size and age", async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await folder("chat-old", "old stuff", old);
    await folder("chat-new", "new");
    const view = json<TempView>(await cli(fx.root, fx.home, ["temp", "--json"]));
    assert.deepEqual(
      view.entries.map((e) => [e.id, e.path, e.files, e.bytes]),
      [
        ["chat-new", "kraftwerk-data/temp/chat-new", 1, 3],
        ["chat-old", "kraftwerk-data/temp/chat-old", 1, 9],
      ]
    );
    assert.equal(view.bytes, 12);
    const r = await cli(fx.root, fx.home, ["temp"]);
    assert.match(r.stdout, /chat-new/);
    assert.match(r.stdout, /chat-old/);
    assert.match(r.stdout, /12 B in 2 folders/);
  });

  it("clean removes what was idle for a week; --older-than and --all move the line", async () => {
    let r = await cli(fx.root, fx.home, ["temp", "clean", "--json"]);
    assert.equal(r.code, 0, r.all);
    assert.deepEqual(json(r), { removed: ["chat-old"], bytes: 9 });
    assert.ok(!existsSync(path.join(root(), "chat-old")));
    assert.ok(existsSync(path.join(root(), "chat-new")), "fresh folders stay");

    r = await cli(fx.root, fx.home, ["temp", "clean", "--older-than", "x"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /wants a number of days/);

    r = await cli(fx.root, fx.home, ["temp", "clean", "--older-than", "0"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /removed 1 folder \(3 B\)/);
    assert.ok(!existsSync(path.join(root(), "chat-new")));

    await folder("chat-a", "a");
    await folder("chat-b", "bb");
    r = await cli(fx.root, fx.home, ["temp", "clean", "--all"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /removed 2 folders \(3 B\)/);
    assert.ok(!existsSync(path.join(root(), "chat-a")));
    assert.ok(!existsSync(path.join(fx.root, "kraftwerk-data/trash")), "nothing goes to the trash");
  });
});
