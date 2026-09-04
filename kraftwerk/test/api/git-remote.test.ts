import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { GitStatus } from "../../src/inspector/git.js";

/**
 * The reason the feature exists: two people, one repo. A bare repo on disk
 * stands in for the remote and a second clone for the colleague, so push,
 * fetch, fast-forward pull and divergence run against real git without a
 * network or ssh.
 */
describe("git sync against a remote", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let remote: string;
  let clone: string;
  const sh = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  before(async () => {
    fx = await makeProject();
    remote = path.join(path.dirname(fx.root), "remote.git");
    clone = path.join(path.dirname(fx.root), "colleague");
    sh(path.dirname(fx.root), "init", "-q", "--bare", "-b", "main", "remote.git");
    fx.git("remote", "add", "origin", remote);
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  const status = async (): Promise<GitStatus> => (await fetch(srv.url + "/api/git?fresh=1")).json();
  const post = async (verb: string, body: unknown = {}): Promise<{ status: number; body: { ok?: boolean; error?: string } }> => {
    const r = await fetch(`${srv.url}/api/git/${verb}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(srv.url).origin },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const colleagueCommits = async (rel: string, content: string, message: string): Promise<void> => {
    if (!existsSync(clone)) {
      sh(path.dirname(clone), "clone", "-q", remote, clone);
      sh(clone, "config", "user.email", "colleague@example.com");
      sh(clone, "config", "user.name", "colleague");
      sh(clone, "config", "commit.gpgsign", "false");
    } else {
      sh(clone, "pull", "-q", "--ff-only");
    }
    await mkdir(path.dirname(path.join(clone, rel)), { recursive: true });
    await writeFile(path.join(clone, rel), content);
    sh(clone, "add", "--", rel);
    sh(clone, "commit", "-q", "-m", message);
    sh(clone, "push", "-q", "origin", "main");
  };

  it("pushes the first commit and sets the upstream", async () => {
    assert.equal((await status()).upstream, undefined);
    const commit = await post("commit", { paths: ["knowledge/notes.md", "kraftwerk.yml"], message: "first" });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    const push = await post("push");
    assert.equal(push.status, 200, JSON.stringify(push.body));

    const st = await status();
    assert.equal(st.upstream, "origin/main");
    assert.equal(st.ahead, 0);
    assert.equal(st.behind, 0);
    assert.equal(sh(remote, "log", "--format=%s", "main"), "first");
  });

  it("fetch reports being behind, pull fast-forwards and brings the file in", async () => {
    await colleagueCommits("knowledge/theirs.md", "# theirs\n", "colleague adds a note");
    assert.equal((await status()).behind, 0, "nothing is known before a fetch");

    const fetched = await post("fetch");
    assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
    let st = await status();
    assert.equal(st.behind, 1);
    assert.equal(st.diverged, false);
    assert.ok(st.lastFetch, "a successful fetch is stamped");

    const pulled = await post("pull");
    assert.equal(pulled.status, 200, JSON.stringify(pulled.body));
    st = await status();
    assert.equal(st.behind, 0);
    assert.ok(st.lastPull);
    assert.ok(existsSync(path.join(fx.root, "knowledge", "theirs.md")));
    assert.equal(fx.git("log", "--format=%s", "-1"), "colleague adds a note");
  });

  it("a local commit shows as ahead and push delivers it", async () => {
    await fx.write("knowledge/notes.md", "# notes\nlocal edit\n");
    const commit = await post("commit", { paths: ["knowledge/notes.md"], message: "local edit" });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    assert.equal((await status()).ahead, 1);
    assert.equal((await post("push")).status, 200);
    assert.equal((await status()).ahead, 0);
    assert.equal(sh(remote, "log", "--format=%s", "-1", "main"), "local edit");
  });

  it("reports a diverged branch and refuses to pull it", async () => {
    await colleagueCommits("knowledge/theirs.md", "# theirs, revised\n", "colleague revises");
    await fx.write("knowledge/mine.md", "# mine\n");
    assert.equal((await post("commit", { paths: ["knowledge/mine.md"], message: "mine" })).status, 200);
    assert.equal((await post("fetch")).status, 200);

    const st = await status();
    assert.equal(st.ahead, 1);
    assert.equal(st.behind, 1);
    assert.equal(st.diverged, true);

    const pull = await post("pull");
    assert.equal(pull.status, 409);
    assert.match(pull.body.error ?? "", /diverged/);
    assert.match((await status()).lastError ?? "", /diverged/);
    assert.equal(fx.git("log", "--format=%s", "-1"), "mine", "nothing was merged");
  });
});
