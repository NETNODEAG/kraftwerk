import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { GitDiff, GitStatus } from "../../src/inspector/git.js";

/** Status, diff and commit against a real repo, through the HTTP API. */
describe("git sync API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  before(async () => {
    fx = await makeProject();
    await fx.write("knowledge/.env", "SECRET=1\n");
    await fx.write("output/runs/1.json", "{}\n");
    await fx.write("README.md", "outside the scope\n");
    fx.git("init", "-q", "knowledge/vendor");
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  const status = async (): Promise<GitStatus> => (await fetch(srv.url + "/api/git?fresh=1", { cache: "no-store" })).json();
  const diff = async (p: string): Promise<GitDiff> => (await fetch(`${srv.url}/api/git/diff?path=${encodeURIComponent(p)}`)).json();
  const commit = (paths: string[], message: string) =>
    fetch(srv.url + "/api/git/commit", {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(srv.url).origin },
      body: JSON.stringify({ paths, message }),
    });
  const byPath = (st: GitStatus) => new Map((st.files ?? []).map((f) => [f.path, f]));

  it("lists workspace files as syncable and everything else as blocked, with a reason", async () => {
    const st = await status();
    assert.equal(st.enabled, true);
    assert.equal(st.branch, "main");
    assert.equal(st.error, undefined);
    const files = byPath(st);
    assert.equal(files.get("knowledge/notes.md")?.syncable, true);
    assert.equal(files.get("kraftwerk.yml")?.syncable, true);
    assert.match(files.get("knowledge/.env")?.reason ?? "", /secret/);
    assert.match(files.get("knowledge/vendor/")?.reason ?? "", /nested git repository/);
    assert.match(files.get("README.md")?.reason ?? "", /outside the workspace/);
    assert.match(files.get("output/runs/1.json")?.reason ?? "", /run artifacts/);
  });

  it("shows a diff only for syncable files, including on a repo with no commits yet", async () => {
    const shown = await diff("knowledge/notes.md");
    assert.equal(shown.error, undefined);
    assert.match(shown.diff, /^\+# notes$/m);
    for (const denied of ["knowledge/.env", "README.md", "knowledge/vendor/", "../etc/passwd", "kraftwerk.yaml"]) {
      const r = await diff(denied);
      assert.equal(r.diff, "", denied);
      assert.ok(r.error, denied);
    }
  });

  it("refuses to commit anything the status did not mark syncable", async () => {
    for (const paths of [["knowledge"], ["knowledge/.env"], ["knowledge/vendor/"], ["README.md"]]) {
      const r = await commit(paths, "nope");
      assert.equal(r.status, 409, paths.join());
    }
    assert.equal(fx.git("rev-list", "--all", "--count"), "0");
  });

  it("commits exactly the selection, then shows the file as clean and a later edit as modified", async () => {
    const r = await commit(["knowledge/notes.md"], "add notes");
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.deepEqual(body, { ok: true, committed: 1 });
    assert.equal(fx.git("log", "--format=%s", "-1"), "add notes");
    assert.equal(fx.git("show", "--stat", "--format=", "HEAD").split("\n").filter((l) => l.includes("|")).length, 1);

    let st = await status();
    assert.equal(byPath(st).has("knowledge/notes.md"), false);
    assert.equal(byPath(st).get("kraftwerk.yml")?.syncable, true, "the unselected file stays untracked");

    await fx.write("knowledge/notes.md", "# notes\nmore\n");
    st = await status();
    assert.equal(byPath(st).get("knowledge/notes.md")?.status, "modified");
    assert.match((await diff("knowledge/notes.md")).diff, /^\+more$/m);
  });

  it("lists a conflicted file as blocked and refuses to commit it", async () => {
    fx.git("commit", "-qam", "more");
    fx.git("checkout", "-qb", "side");
    await fx.write("knowledge/notes.md", "# notes\nside\n");
    fx.git("commit", "-qam", "side");
    fx.git("checkout", "-q", "main");
    await fx.write("knowledge/notes.md", "# notes\nmain\n");
    fx.git("commit", "-qam", "main");
    assert.throws(() => fx.git("merge", "side"));
    try {
      const st = await status();
      const f = byPath(st).get("knowledge/notes.md");
      assert.equal(f?.code, "UU");
      assert.equal(f?.status, "conflicted");
      assert.equal(f?.syncable, false);
      assert.match(f?.reason ?? "", /conflicted/);
      const r = await commit(["knowledge/notes.md"], "nope");
      assert.equal(r.status, 409);
    } finally {
      fx.git("merge", "--abort");
    }
  });

  it("reports the configured branch not being checked out and blocks the commit", async () => {
    await fx.write("kraftwerk.yml", "name: fixture\ngit:\n  interval: 0\n  branch: release\n");
    const st = await status();
    assert.match(st.error ?? "", /syncs "release" but "main" is checked out/);
    const r = await commit(["knowledge/notes.md"], "blocked");
    assert.equal(r.status, 409);
  });
});
