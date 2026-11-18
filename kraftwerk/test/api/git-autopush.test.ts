import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { GitStatus } from "../../src/core/git.js";

/**
 * `autosync: push`: the background timer also pushes what is committed. A
 * bare repo on disk is the remote and a second clone the colleague, as in
 * git-remote.test.ts; the timer runs every second so the test only waits
 * for it.
 */
describe("git autosync: push", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let remote: string;
  let clone: string;
  const sh = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const remoteHead = (): string => {
    try {
      return sh(remote, "log", "--format=%s", "-1", "main");
    } catch {
      return "";
    }
  };

  before(async () => {
    fx = await makeProject("name: fixture\ngit:\n  interval: 1\n  autosync: push\n");
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
  const until = async (what: string, done: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await done()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`timed out waiting for ${what}`);
  };
  /** A few timer rounds, for the cases where nothing may happen. */
  const rounds = (): Promise<void> => new Promise((r) => setTimeout(r, 2_500));

  it("leaves the first push of a branch to a click", async () => {
    const commit = await post("commit", { paths: ["knowledge/notes.md", "kraftwerk.yml"], message: "first" });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    await rounds();
    assert.equal(remoteHead(), "", "a branch without an upstream is not published in the background");
    assert.equal((await post("push")).status, 200);
    assert.equal((await status()).upstream, "origin/main");
  });

  it("pushes a commit made on the git screen without a click", async () => {
    await fx.write("knowledge/notes.md", "# notes\nfrom the screen\n");
    const commit = await post("commit", { paths: ["knowledge/notes.md"], message: "from the screen" });
    assert.equal(commit.status, 200, JSON.stringify(commit.body));
    await until("the commit to reach the remote", () => remoteHead() === "from the screen");
    const st = await status();
    assert.equal(st.ahead, 0);
    assert.ok(st.lastPush, "a background push is stamped");
    assert.equal(st.lastError, undefined);
  });

  it("pushes a commit made outside the UI at the next interval", async () => {
    await fx.write("knowledge/agent.md", "# written by an agent\n");
    fx.git("add", "--", "knowledge/agent.md");
    fx.git("commit", "-q", "-m", "agent commit");
    await until("the commit to reach the remote", () => remoteHead() === "agent commit");
  });

  it("pulls a colleague's commit first, then pushes on top of it", async () => {
    sh(path.dirname(clone), "clone", "-q", remote, clone);
    sh(clone, "config", "user.email", "colleague@example.com");
    sh(clone, "config", "user.name", "colleague");
    sh(clone, "config", "commit.gpgsign", "false");
    await mkdir(path.join(clone, "knowledge"), { recursive: true });
    await writeFile(path.join(clone, "knowledge", "theirs.md"), "# theirs\n");
    sh(clone, "add", "--", "knowledge/theirs.md");
    sh(clone, "commit", "-q", "-m", "colleague adds a note");
    sh(clone, "push", "-q", "origin", "main");

    await until("the colleague's file to arrive", () => existsSync(path.join(fx.root, "knowledge", "theirs.md")));
    await fx.write("knowledge/mine.md", "# mine\n");
    assert.equal((await post("commit", { paths: ["knowledge/mine.md"], message: "mine" })).status, 200);
    await until("the commit to reach the remote", () => remoteHead() === "mine");
    assert.equal(sh(remote, "log", "--format=%s", "-2", "main"), "mine\ncolleague adds a note");
  });

  it("does not push a diverged branch, and never forces", async () => {
    // The local edit comes first: a modified tree keeps the timer from pulling the colleague's commit in between.
    await fx.write("knowledge/mine.md", "# mine, revised\n");
    await writeFile(path.join(clone, "knowledge", "theirs.md"), "# theirs, revised\n");
    sh(clone, "pull", "-q", "--ff-only");
    sh(clone, "commit", "-q", "-am", "colleague revises");
    sh(clone, "push", "-q", "origin", "main");
    fx.git("commit", "-q", "-am", "mine revised");

    await until("the divergence to show", async () => (await status()).diverged === true);
    await rounds();
    assert.equal(remoteHead(), "colleague revises", "the remote keeps the colleague's commit");
    assert.equal(fx.git("log", "--format=%s", "-1"), "mine revised", "nothing was merged");
  });

  it("with autosync: pull nothing is pushed", async () => {
    // Back to a branch that could be pushed: drop the diverged commit.
    fx.git("reset", "-q", "--hard", "origin/main");
    await fx.write("kraftwerk.yml", "name: fixture\ngit:\n  interval: 1\n  autosync: pull\n");
    await until("the setting to be read", async () => (await status()).autosync === "pull");
    await fx.write("knowledge/mine.md", "# mine, again\n");
    assert.equal((await post("commit", { paths: ["knowledge/mine.md"], message: "stays local" })).status, 200);
    await rounds();
    assert.equal(remoteHead(), "colleague revises");
    assert.equal((await status()).ahead, 1);
  });
});
