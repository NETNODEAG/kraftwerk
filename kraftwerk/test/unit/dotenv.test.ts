import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyDotenv, DOTENV_MARKER, parseDotenv } from "../../src/dotenv.js";

/** The .env loader: parsing, shell precedence, and the restart/relaunch re-apply. */
describe("dotenv", () => {
  const KEYS = ["DOT_A", "DOT_B", "DOT_C", "DOT_SHELL", "DOT_OLD", DOTENV_MARKER];
  let root: string;
  let saved: Record<string, string | undefined>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-dotenv-"));
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(async () => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(root, { recursive: true, force: true });
  });

  it("parses comments, export, quotes and inline comments", () => {
    const parsed = parseDotenv(
      [
        "# comment",
        "",
        "DOT_A=plain value # trailing comment",
        'export DOT_B="quoted # not a comment\\nline two"',
        "DOT_C='single $literal'",
        "not a line",
        "1BAD=x",
        "DOT_D=",
      ].join("\n")
    );
    assert.deepEqual(parsed, { DOT_A: "plain value", DOT_B: "quoted # not a comment\nline two", DOT_C: "single $literal", DOT_D: "" });
  });

  it("applies the file, lets the shell win, and marks what it injected", async () => {
    await writeFile(path.join(root, ".env"), "DOT_A=1\nDOT_SHELL=from-file\n");
    process.env.DOT_SHELL = "from-shell";
    const r = await applyDotenv(root);
    assert.equal(r.file, path.join(root, ".env"));
    assert.deepEqual(r.applied, ["DOT_A"]);
    assert.deepEqual(r.kept, ["DOT_SHELL"]);
    assert.equal(process.env.DOT_A, "1");
    assert.equal(process.env.DOT_SHELL, "from-shell");
    assert.equal(process.env[DOTENV_MARKER], "DOT_A");
  });

  it("re-applies changed values over ones an earlier process injected (restart), drops removed ones", async () => {
    // What a restarted server inherits from its supervisor: the old values plus the marker.
    process.env.DOT_A = "old";
    process.env.DOT_OLD = "gone-from-file";
    process.env[DOTENV_MARKER] = "DOT_A,DOT_OLD";
    await writeFile(path.join(root, ".env"), "DOT_A=new\nDOT_B=added\n");
    const r = await applyDotenv(root);
    assert.deepEqual(r.applied, ["DOT_A", "DOT_B"]);
    assert.deepEqual(r.removed, ["DOT_OLD"]);
    assert.equal(process.env.DOT_A, "new");
    assert.equal(process.env.DOT_B, "added");
    assert.equal(process.env.DOT_OLD, undefined);
    assert.equal(process.env[DOTENV_MARKER], "DOT_A,DOT_B");
  });

  it("without a file still drops another workspace's injected variables", async () => {
    process.env.DOT_A = "other-workspace";
    process.env[DOTENV_MARKER] = "DOT_A";
    const r = await applyDotenv(root);
    assert.equal(r.file, undefined);
    assert.deepEqual(r.removed, ["DOT_A"]);
    assert.equal(process.env.DOT_A, undefined);
    assert.equal(process.env[DOTENV_MARKER], undefined);
  });
});
