import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";

/** `kraftwerk journal`: the write path an agent uses from its session, and reading it back. */
describe("kraftwerk journal", () => {
  let fx: Fixture;
  before(async () => {
    fx = await makeProject("name: fixture\n");
    await fx.write("agents/lisa/agent.yml", "name: Lisa\nemoji: 🦊\nharness: claude\n");
  });
  after(() => fx.cleanup());

  it("prints an empty journal", async () => {
    const r = await cli(fx.root, fx.home, ["journal", "lisa"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /journal is empty/);
  });

  it("adds a line with its kind; the agent's own actor is not stamped, another one is", async () => {
    let r = await cli(fx.root, fx.home, ["journal", "lisa", "the client wants weekly reports", "--kind", "learned", "--actor", "lisa/claude"]);
    assert.equal(r.code, 0, r.all);
    r = await cli(fx.root, fx.home, ["journal", "lisa", "ship v2 first", "--kind", "decided", "--actor", "human:lukas"]);
    assert.equal(r.code, 0, r.all);
    const text = await readFile(path.join(fx.root, "agents/lisa/journal.md"), "utf8");
    assert.match(text, /\* \*\*Decided\*\*: ship v2 first \(human:lukas\)\n\* \*\*Learned\*\*: the client wants weekly reports\n/);
    assert.match((await cli(fx.root, fx.home, ["journal", "lisa"])).stdout, /weekly reports/);
  });

  it("refuses an unknown kind and an unknown agent", async () => {
    assert.equal((await cli(fx.root, fx.home, ["journal", "lisa", "x", "--kind", "gossip"])).code, 2);
    assert.equal((await cli(fx.root, fx.home, ["journal", "nobody", "x"])).code, 2);
  });
});
