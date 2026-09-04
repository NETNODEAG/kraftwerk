import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { GitStatus } from "../../src/inspector/git.js";
import type { SettingsView } from "../../src/inspector/settings.js";

/** The settings screen's git block, written to kraftwerk.yml and read back by the git screen. */
describe("settings API: git sync", () => {
  let fx: Fixture;
  let srv: RunningServer;
  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  const put = (body: unknown) =>
    fetch(srv.url + "/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: new URL(srv.url).origin },
      body: JSON.stringify(body),
    });
  const gitStatus = async (): Promise<GitStatus> => (await fetch(srv.url + "/api/git?fresh=1", { cache: "no-store" })).json();
  const yml = () => readFile(path.join(fx.root, "kraftwerk.yml"), "utf8");

  it("writes the git block and the git screen picks it up without a restart", async () => {
    const r = await put({ git: { enabled: true, remote: "upstream", branch: "main", interval: 120, autosync: "off" } });
    const d = (await r.json()) as SettingsView;
    assert.equal(r.status, 200, JSON.stringify(d));
    assert.deepEqual(d.config.git, { remote: "upstream", branch: "main", interval: 120, autosync: "off" });
    const text = await yml();
    assert.match(text, /^name: fixture$/m, "other keys survive");
    assert.match(text, /remote: upstream/);
    const st = await gitStatus();
    assert.equal(st.enabled, true);
    assert.equal(st.remote, "upstream");
    assert.equal(st.interval, 120);
    assert.equal(st.autosync, "off");
  });

  it("turns sync off while keeping the other fields", async () => {
    const r = await put({ git: { enabled: false, remote: "upstream", interval: 120, autosync: "off" } });
    const d = (await r.json()) as SettingsView;
    assert.equal(r.status, 200);
    assert.deepEqual(d.config.git, { enabled: false, remote: "upstream", interval: 120, autosync: "off" });
    assert.equal((await gitStatus()).enabled, false);
  });

  it("leaves defaults out of the file, and drops the block when off with nothing set", async () => {
    let r = await put({ git: { enabled: true, remote: "origin", branch: "", interval: "300", autosync: "pull" } });
    assert.deepEqual(((await r.json()) as SettingsView).config.git, {});
    assert.match(await yml(), /^git: \{\}$/m);
    r = await put({ git: { enabled: false } });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as SettingsView).config.git, undefined);
    r = await put({ git: { enabled: false } });
    assert.equal(((await r.json()) as SettingsView).config.git, undefined);
    assert.doesNotMatch(await yml(), /git/);
  });

  it("rejects bad values", async () => {
    for (const git of [{ enabled: true, interval: -1 }, { enabled: true, interval: 1.5 }, { enabled: true, autosync: "push" }, { enabled: "yes" }]) {
      const r = await put({ git });
      assert.equal(r.status, 400, JSON.stringify(git));
    }
  });
});
