import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cli } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import { workspaceRecordName } from "../../src/core/instances.js";

/** `kraftwerk doctor` names the workspace's slug, and warns when another registered workspace has the same one. */
describe("kraftwerk doctor: slug", () => {
  let fx: Fixture;
  before(async () => {
    fx = await makeProject();
  });
  after(() => fx.cleanup());

  it("reports the slug, then the clash once another workspace has it", async () => {
    const ok = await cli(fx.root, fx.home, ["doctor"]);
    assert.match(ok.stdout, /✔ slug: project — the folder name/);

    const twin = path.join(fx.home, "elsewhere", "project");
    const dir = path.join(fx.home, ".kraftwerk", "workspaces");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, workspaceRecordName(twin)), JSON.stringify({ root: twin, slug: "project", firstSeen: "2026-01-01T00:00:00.000Z", lastStarted: "2026-01-01T00:00:00.000Z", startCount: 1 }));
    const clash = await cli(fx.root, fx.home, ["doctor"]);
    assert.match(clash.stdout, new RegExp(`⚠ slug: project — also used by ${twin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — set \`slug:\` in one kraftwerk.yml`));
  });
});
