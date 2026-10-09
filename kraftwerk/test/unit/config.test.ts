import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveWorkspace, slugFromFolder, workspaceSlug } from "../../src/config.js";

/**
 * kraftwerk.yml keys an older kraftwerk read: `public:` and `tunnel:` (the
 * Cloudflare Tunnel, removed in 0.65) still load, are dropped from the
 * config, and are named in `legacyKeys` for doctor. Other unknown keys
 * still fail.
 */
describe("kraftwerk.yml legacy keys", () => {
  let dir = "";
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-"));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it("loads a file with public: and tunnel: (access block included) and ignores both", async () => {
    await writeFile(
      path.join(dir, "kraftwerk.yml"),
      `name: old\npublic: https://kw.example.com\ntunnel:\n  name: kraftwerk\n  access:\n    team: acme\n    aud: ${"a".repeat(64)}\n`,
    );
    const ws = await resolveWorkspace(dir);
    assert.equal(ws.root, dir);
    assert.deepEqual(ws.config, { name: "old" });
    assert.deepEqual(ws.legacyKeys, ["public", "tunnel"]);
  });

  it("a bare tunnel: alone loads too; a current file has no legacyKeys", async () => {
    await writeFile(path.join(dir, "kraftwerk.yml"), "name: old\ntunnel:\n");
    assert.deepEqual((await resolveWorkspace(dir)).legacyKeys, ["tunnel"]);
    await writeFile(path.join(dir, "kraftwerk.yml"), "name: new\n");
    assert.equal((await resolveWorkspace(dir)).legacyKeys, undefined);
  });

  it("other unknown keys still fail", async () => {
    await writeFile(path.join(dir, "kraftwerk.yml"), "name: x\nfunnel: yes\n");
    await assert.rejects(resolveWorkspace(dir), /unknown key "funnel"/);
  });
});

/** The slug: the workspace's address on this machine — the folder name unless kraftwerk.yml says otherwise. */
describe("workspace slug", () => {
  let dir = "";
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-"));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it("makes a folder name into a DNS label", () => {
    assert.equal(slugFromFolder("Team Blau (2024)"), "team-blau-2024");
    assert.equal(slugFromFolder("Ünïcödé"), "unicode");
    assert.equal(slugFromFolder("---"), "workspace");
    assert.equal(slugFromFolder("a".repeat(80)).length, 63);
  });

  it("takes kraftwerk.yml slug over the folder name, and the name never", async () => {
    await writeFile(path.join(dir, "kraftwerk.yml"), "name: Team Blau\n");
    assert.equal(workspaceSlug(await resolveWorkspace(dir)), slugFromFolder(path.basename(dir)));
    await writeFile(path.join(dir, "kraftwerk.yml"), "name: Team Blau\nslug: blau\n");
    assert.equal(workspaceSlug(await resolveWorkspace(dir)), "blau");
  });

  it("refuses a slug that is not a DNS label", async () => {
    for (const bad of ["Blau", "-blau", "blau-", "blau_team", '"a b"']) {
      await writeFile(path.join(dir, "kraftwerk.yml"), `slug: ${bad}\n`);
      await assert.rejects(resolveWorkspace(dir), /slug must be lowercase/, bad);
    }
  });
});
