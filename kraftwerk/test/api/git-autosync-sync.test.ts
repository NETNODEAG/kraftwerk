import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { GitStatus } from "../../src/core/git.js";

/**
 * `autosync: sync` (kraftwerk sync's default): the timer commits what changed
 * under the synced roots, takes the remote's commits in and pushes — and
 * where both sides changed a file, the remote's version wins and this
 * machine's is committed beside it as name.konflikt-<handle>.ext. A bare repo
 * is the remote, a second clone the colleague; the timer runs every second.
 */
describe("git autosync: sync", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let remote: string;
  let clone: string;
  const sh = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const remoteLog = (): string[] => {
    try {
      return sh(remote, "log", "--format=%s", "main").split("\n");
    } catch {
      return [];
    }
  };
  const until = async (what: string, done: () => boolean | Promise<boolean>, ms = 20_000): Promise<void> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await done()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.fail(`timed out waiting for ${what}`);
  };
  const status = async (): Promise<GitStatus> => (await fetch(srv.url + "/api/git?fresh=1")).json();
  const colleague = async (rel: string, content: string | null, message: string): Promise<void> => {
    sh(clone, "pull", "-q", "--ff-only");
    if (content === null) sh(clone, "rm", "-q", "--", rel);
    else {
      await mkdir(path.dirname(path.join(clone, rel)), { recursive: true });
      await writeFile(path.join(clone, rel), content);
      sh(clone, "add", "--", rel);
    }
    sh(clone, "commit", "-q", "-m", message);
    sh(clone, "push", "-q", "origin", "main");
  };

  before(async () => {
    fx = await makeProject("name: fixture\ngit:\n  interval: 1\n  autosync: sync\n");
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

  it("commits what changed and publishes the branch by itself", async () => {
    await until("the first automatic commit to reach the remote", () => remoteLog().some((s) => s.startsWith("kraftwerk sync: ")));
    const st = await status();
    assert.equal(st.upstream, "origin/main");
    assert.ok(st.lastAutoCommit);
    assert.equal((st.files ?? []).filter((f) => f.syncable).length, 0, "nothing left to commit");
    sh(path.dirname(clone), "clone", "-q", remote, clone);
    sh(clone, "config", "user.email", "ben@example.com");
    sh(clone, "config", "user.name", "Ben");
    sh(clone, "config", "commit.gpgsign", "false");
    assert.ok(existsSync(path.join(clone, "knowledge", "notes.md")));
  });

  it("an edit here goes up, an edit there comes in", async () => {
    await fx.write("knowledge/here.md", "# from here\n");
    await until("the edit to reach the remote", () => remoteLog()[0]?.includes("knowledge/here.md") === true);
    await colleague("knowledge/there.md", "# from there\n", "Ben adds a page");
    await until("the colleague's page to arrive", () => existsSync(path.join(fx.root, "knowledge", "there.md")));
  });

  it("both change one file at once: the remote wins, ours is kept beside it, both sides end equal", async () => {
    await until("in step", async () => {
      const st = await status();
      return !st.ahead && !st.behind && !(st.files ?? []).some((f) => f.syncable);
    });
    // Stop the timer's view of our edit until the colleague has pushed: write theirs first, then ours.
    await colleague("knowledge/notes.md", "# notes\nBen's line\n", "Ben edits notes");
    await fx.write("knowledge/notes.md", "# notes\nmy line\n");
    await until("a conflict to be kept", async () => !!(await status()).conflicts?.length);
    const st = await status();
    const c = st.conflicts![0];
    assert.equal(c.path, "knowledge/notes.md");
    assert.match(c.copy, /^knowledge\/notes\.konflikt-[a-z0-9._-]+\.md$/);
    assert.equal(readFileSync(path.join(fx.root, "knowledge", "notes.md"), "utf8"), "# notes\nBen's line\n", "the remote's version won");
    assert.equal(readFileSync(path.join(fx.root, c.copy), "utf8"), "# notes\nmy line\n", "ours is kept beside it");
    await until("the copy to reach the remote", () => {
      try {
        return sh(remote, "show", `main:${c.copy}`) === "# notes\nmy line";
      } catch {
        return false;
      }
    });
    sh(clone, "pull", "-q", "--ff-only");
    assert.ok(existsSync(path.join(clone, c.copy)), "the colleague sees the copy too");
    assert.equal(st.lastError, undefined);
  });

  it("deleted there, changed here: the deletion wins, our version is kept", async () => {
    await fx.write("knowledge/gone.md", "# gone\n");
    await until("gone.md to be on the remote", () => {
      try {
        sh(remote, "cat-file", "-e", "main:knowledge/gone.md");
        return true;
      } catch {
        return false;
      }
    });
    await until("in step", async () => {
      const st = await status();
      return !st.ahead && !st.behind;
    });
    await colleague("knowledge/gone.md", null, "Ben deletes gone.md");
    await fx.write("knowledge/gone.md", "# gone\nbut I wrote more\n");
    await until("the deletion's conflict to be kept", async () => !!(await status()).conflicts?.some((k) => k.path === "knowledge/gone.md"));
    const k = (await status()).conflicts!.find((x) => x.path === "knowledge/gone.md")!;
    assert.ok(!existsSync(path.join(fx.root, "knowledge", "gone.md")), "deleted, as the remote has it");
    assert.equal(readFileSync(path.join(fx.root, k.copy), "utf8"), "# gone\nbut I wrote more\n");
  });
});
