import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeEmptyDir } from "../helpers/project.js";

/** `init` → `list` → `doctor`: the first three commands a new consumer runs. */
describe("kraftwerk init / list / doctor", () => {
  let dir: Awaited<ReturnType<typeof makeEmptyDir>>;
  before(async () => {
    dir = await makeEmptyDir();
  });
  after(() => dir.cleanup());

  it("--version prints the package version", async () => {
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    const r = await cli(dir.root, dir.home, ["--version"]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), pkg.version);
  });

  it("init scaffolds a runnable project", async () => {
    const r = await cli(dir.root, dir.home, ["init"]);
    assert.equal(r.code, 0, r.all);
    for (const rel of [
      "kraftwerk.yml",
      "kraftwerk-data/workflows/hello/workflow.yml",
      "kraftwerk-data/workflows/hello/prompts/answer.md",
      "kraftwerk-data/agents/max/agent.yml",
      "kraftwerk-data/skills/daily-summary/SKILL.md",
      "kraftwerk-data/knowledge/demo-customer-support/index.md",
      "kraftwerk-data/knowledge/demo-customer-support/playbooks/refunds.md",
      ".gitignore",
    ]) {
      assert.ok(existsSync(path.join(dir.root, rel)), `${rel} missing`);
      assert.match(r.stdout, new RegExp(`✔ ${rel.split("/").slice(0, 3).join("/")}`), rel);
    }
    const gitignore = await readFile(path.join(dir.root, ".gitignore"), "utf8");
    assert.match(gitignore, /^kraftwerk-data\/output\/$/m);
    assert.match(gitignore, /^kraftwerk-data\/repos\/$/m, "the repos root is ignored before the first clone");
    assert.match(await readFile(path.join(dir.root, "kraftwerk.yml"), "utf8"), /^name: "project"/m);
  });

  it("init is idempotent: a second run touches nothing", async () => {
    const before = await readFile(path.join(dir.root, "kraftwerk.yml"), "utf8");
    const r = await cli(dir.root, dir.home, ["init"]);
    assert.equal(r.code, 0, r.all);
    assert.doesNotMatch(r.stdout, /✔/);
    assert.match(r.stdout, /skipped \(exists\):.*kraftwerk\.yml/);
    assert.equal(await readFile(path.join(dir.root, "kraftwerk.yml"), "utf8"), before);
  });

  it("list --json discovers the scaffolded workflow, also from a subdirectory", async () => {
    const r = await cli(path.join(dir.root, "kraftwerk-data"), dir.home, ["list", "--json"]);
    assert.equal(r.code, 0, r.all);
    const found = json<{ name?: string; steps?: unknown[]; agents?: { id: string; harness: string }[]; error?: string }[]>(r);
    assert.equal(found.length, 1);
    assert.equal(found[0].name, "hello");
    assert.equal(found[0].error, undefined);
    assert.equal(found[0].steps?.length, 1);
    assert.deepEqual(found[0].agents?.map((a) => a.id), ["assistant"]);
  });

  it("doctor reports the project as well-formed", async () => {
    const r = await cli(dir.root, dir.home, ["doctor"]);
    // Exit status depends on the machine (harness CLIs, docker); the
    // project checks do not.
    assert.match(r.stdout, /✔ kraftwerk\.yml well-formed/);
    assert.match(r.stdout, /✔ 1 workflow\(s\) valid, 0 broken/);
    assert.doesNotMatch(r.stdout, /configured directory does not exist/);
  });

  it("doctor fails on an invalid kraftwerk.yml and names the problem", async () => {
    const other = await makeEmptyDir();
    try {
      await cli(other.root, other.home, ["init"]);
      const yml = path.join(other.root, "kraftwerk.yml");
      await import("node:fs/promises").then((fs) => fs.appendFile(yml, "git:\n  interval: soon\n"));
      const r = await cli(other.root, other.home, ["doctor"]);
      assert.equal(r.code, 1);
      assert.match(r.stdout, /✖ kraftwerk\.yml invalid — kraftwerk\.yml: git\.interval must be a whole number/);
      assert.match(r.stdout, /1 problem\(s\) found/);
    } finally {
      await other.cleanup();
    }
  });

  it("doctor rejects a color that is not a hex value", async () => {
    const other = await makeEmptyDir();
    try {
      await cli(other.root, other.home, ["init"]);
      const yml = path.join(other.root, "kraftwerk.yml");
      await import("node:fs/promises").then((fs) => fs.appendFile(yml, "color: orange\n"));
      const r = await cli(other.root, other.home, ["doctor"]);
      assert.equal(r.code, 1);
      assert.match(r.stdout, /kraftwerk\.yml: color must be a hex colour like "#c2410c"/);
    } finally {
      await other.cleanup();
    }
  });

  it("an unknown command exits non-zero with usage", async () => {
    const r = await cli(dir.root, dir.home, ["frobnicate"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /unknown command 'frobnicate'/);
  });
});
