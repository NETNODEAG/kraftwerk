import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addWorkspaceId, newWorkspaceId, resolveWorkspace, WORKSPACE_ID_RE } from "../../src/config.js";
import { defaultMachine, isIdentityString, readIdentity, setIdentity } from "../../src/core/identity.js";

/**
 * ~/.kraftwerk/identity.json (handle@machine, retired pairs in `previous`)
 * and the committed workspace id in kraftwerk.yml.
 */
describe("identity.json", () => {
  let home = "";
  const realHome = process.env.HOME;
  const file = () => path.join(home, ".kraftwerk", "identity.json");
  before(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-"));
    process.env.HOME = home;
  });
  after(async () => {
    process.env.HOME = realHome;
    await rm(home, { recursive: true, force: true });
  });

  it("host names lose their domain and anything outside [a-z0-9-]", () => {
    assert.equal(defaultMachine("Lukas-MBP.local"), "lukas-mbp");
    assert.equal(defaultMachine("build_box.corp.example.com"), "build-box");
    assert.equal(defaultMachine("..."), "machine");
  });

  it("defaults on first read are written, so they stay put", async () => {
    const id = await readIdentity();
    assert.match(id.handle, /^[a-z0-9._-]+$/);
    assert.match(id.machine, /^[a-z0-9-]+$/);
    assert.deepEqual(id.previous, []);
    assert.deepEqual(JSON.parse(await readFile(file(), "utf8")), id);
  });

  it("a rename appends the retired pair to previous, deduplicated and capped", async () => {
    await writeFile(file(), JSON.stringify({ handle: "lukas", machine: "mbp", previous: [] }));
    let id = await setIdentity({ machine: "studio" });
    assert.deepEqual(id, { handle: "lukas", machine: "studio", previous: ["lukas@mbp"] });
    id = await setIdentity({ machine: "studio" });
    assert.deepEqual(id.previous, ["lukas@mbp"], "no change, nothing retired");
    id = await setIdentity({ machine: "mbp" });
    assert.deepEqual(id.previous, ["lukas@studio"], "back to an old pair: it is current again, not retired");
    for (let i = 0; i < 12; i++) id = await setIdentity({ machine: `m${i}` });
    assert.equal(id.previous.length, 10);
    assert.equal(id.previous.at(-1), "lukas@m10");
  });

  it("refuses an empty, uppercase or @-carrying name", async () => {
    await assert.rejects(setIdentity({ handle: "" }), /must not be empty/);
    await assert.rejects(setIdentity({ handle: "Lukas" }), /lowercase/);
    await assert.rejects(setIdentity({ machine: "a@b" }), /must not contain "@"/);
    assert.equal(isIdentityString("lukas@mbp"), true);
    assert.equal(isIdentityString("lukas@mbp@x"), false);
    assert.equal(isIdentityString("Lukas@mbp"), false);
  });
});

describe("kraftwerk.yml id", () => {
  let dir = "";
  const yml = () => path.join(dir, "kraftwerk.yml");
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-test-"));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it("a well-formed id is read into the workspace", async () => {
    assert.match(newWorkspaceId(), WORKSPACE_ID_RE);
    await writeFile(yml(), "id: ws_k3f9x2m7q1\nname: x\n");
    const ws = await resolveWorkspace(dir);
    assert.equal(ws.id, "ws_k3f9x2m7q1");
    assert.equal(ws.config.id, "ws_k3f9x2m7q1");
  });

  it("anything else is refused with what it should look like", async () => {
    for (const bad of ["ws_ABCDEFGHIJ", "ws_short", "k3f9x2m7q1", "42"]) {
      await writeFile(yml(), `id: ${bad}\n`);
      await assert.rejects(resolveWorkspace(dir), /id must be "ws_" followed by 10 lowercase letters or digits/, bad);
    }
  });

  it("addWorkspaceId inserts one line after the leading comments, the rest untouched", async () => {
    const body = "# my workspace\n# keep this comment\nname: x   # inline comment\ngit:\n  interval: 0\n";
    await writeFile(yml(), body);
    const id = await addWorkspaceId(yml());
    assert.match(id, WORKSPACE_ID_RE);
    const text = await readFile(yml(), "utf8");
    assert.ok(text.startsWith(`# my workspace\n# keep this comment\nid: ${id}`), text);
    assert.ok(text.endsWith("name: x   # inline comment\ngit:\n  interval: 0\n"), text);
    assert.equal((await resolveWorkspace(dir)).id, id);
    assert.equal(await addWorkspaceId(yml()), id, "an id already there is kept");
    assert.equal(await readFile(yml(), "utf8"), text);
  });

  it("an empty kraftwerk.yml gets the id as its only line", async () => {
    await writeFile(yml(), "");
    const id = await addWorkspaceId(yml());
    assert.match(await readFile(yml(), "utf8"), new RegExp(`^id: ${id}   #.*\\n$`));
  });
});
