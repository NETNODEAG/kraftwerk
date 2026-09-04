import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { ReposView } from "../../src/inspector/repos.js";

/** `kraftwerk repos` against a local upstream: flag, add, list, update, remove. */
describe("kraftwerk repos", () => {
  let fx: Fixture;
  let base: string;
  let upstream: string;
  before(async () => {
    fx = await makeProject("name: fixture\n");
    base = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-upstream-"));
    upstream = path.join(base, "tools");
    await mkdir(upstream);
    const g = (...args: string[]) => execFileSync("git", args, { cwd: upstream, stdio: "ignore" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "up@example.com");
    g("config", "user.name", "up");
    g("config", "commit.gpgsign", "false");
    await writeFile(path.join(upstream, "README.md"), "# tools\n");
    g("add", ".");
    g("commit", "-qm", "first");
  });
  after(async () => {
    await fx.cleanup();
    await rm(base, { recursive: true, force: true });
  });

  it("refuses everything while the feature is off", async () => {
    const r = await cli(fx.root, fx.home, ["repos"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /repositories are off/);
    assert.equal((await cli(fx.root, fx.home, ["repos", "add", upstream])).code, 1);
  });

  it("refuses a root that is the project itself or outside it", async () => {
    for (const root of [".", "..", "kraftwerk-data/../..", "/tmp"]) {
      await fx.write("kraftwerk.yml", `name: fixture\nrepos:\n  root: ${JSON.stringify(root)}\n`);
      const r = await cli(fx.root, fx.home, ["repos", "add", upstream]);
      assert.equal(r.code, 1, root);
      assert.match(r.stderr, /repos\.root must be a directory inside the project/, root);
      const doctor = await cli(fx.root, fx.home, ["doctor"]);
      assert.equal(doctor.code, 1, root);
      assert.match(doctor.stdout, /✖ kraftwerk\.yml invalid — kraftwerk\.yml: repos\.root must be a directory inside the project/, root);
    }
  });

  it("add clones into the root, git-ignores the root and list shows it", async () => {
    await fx.write("kraftwerk.yml", "name: fixture\nrepos:\n  root: kraftwerk-data/repos\n");
    assert.ok(!existsSync(path.join(fx.root, ".gitignore")), "enabled by editing the yml: nothing ignored yet");
    const add = await cli(fx.root, fx.home, ["repos", "add", upstream, "--name", "tooling"]);
    assert.equal(add.code, 0, add.all);
    assert.match(add.stdout, /✔ tooling/);
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/repos/tooling/README.md")));
    assert.match(await readFile(path.join(fx.root, ".gitignore"), "utf8"), /^kraftwerk-data\/repos\/$/m);
    assert.equal(fx.git("status", "--porcelain", "--", "kraftwerk-data/repos"), "", "the clone is invisible to the workspace git");
    assert.equal((await cli(fx.root, fx.home, ["repos", "add", upstream, "--name", "tooling"])).code, 1, "same name twice");

    const list = await cli(path.join(fx.root, "kraftwerk-data"), fx.home, ["repos", "--json"]);
    assert.equal(list.code, 0, list.all);
    const view = json<ReposView>(list);
    assert.equal(view.enabled, true);
    assert.deepEqual(view.repos.map((r) => [r.slug, r.branch, r.dirty]), [["tooling", "main", 0]]);

    const table = await cli(fx.root, fx.home, ["repos"]);
    assert.match(table.stdout, /tooling/);
    assert.match(table.stdout, /clean/);
  });

  it("doctor checks the root with git: ignored, not ignored, not a repo", async () => {
    const ok = await cli(fx.root, fx.home, ["doctor"]);
    assert.match(ok.stdout, /✔ repos: kraftwerk-data\/repos — git-ignored/);
    await rm(path.join(fx.root, ".gitignore"));
    const warn = await cli(fx.root, fx.home, ["doctor"]);
    assert.match(warn.stdout, /⚠ repos: kraftwerk-data\/repos — kraftwerk-data\/repos\/ is not git-ignored/);
    // A worktree has a .git *file*; doctor must still see the repository.
    fx.git("commit", "-q", "--allow-empty", "-m", "init");
    const wt = path.join(base, "worktree");
    fx.git("worktree", "add", "-q", "--detach", wt);
    try {
      await writeFile(path.join(wt, "kraftwerk.yml"), "name: fixture\nrepos:\n  root: kraftwerk-data/repos\n");
      const inWorktree = await cli(wt, fx.home, ["doctor"]);
      assert.match(inWorktree.stdout, /⚠ repos: kraftwerk-data\/repos — .* is not git-ignored/);
    } finally {
      fx.git("worktree", "remove", "--force", wt);
    }
    await rm(path.join(fx.root, ".git"), { recursive: true, force: true });
    const noGit = await cli(fx.root, fx.home, ["doctor"]);
    assert.match(noGit.stdout, /✔ repos: kraftwerk-data\/repos — not inside a git repository/);
  });

  it("update and remove", async () => {
    const up = await cli(fx.root, fx.home, ["repos", "update", "tooling"]);
    assert.equal(up.code, 0, up.all);
    assert.match(up.stdout, /✔ tooling at \w+ first/);
    await writeFile(path.join(fx.root, "kraftwerk-data/repos/tooling/scratch.txt"), "x\n");
    const blocked = await cli(fx.root, fx.home, ["repos", "remove", "tooling"]);
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /uncommitted/);
    const forced = await cli(fx.root, fx.home, ["repos", "remove", "tooling", "--force"]);
    assert.equal(forced.code, 0, forced.all);
    assert.ok(!existsSync(path.join(fx.root, "kraftwerk-data/repos/tooling")));
    assert.equal((await cli(fx.root, fx.home, ["repos", "remove", "tooling"])).code, 1);
  });
  it("add --depth makes a shallow clone", async () => {
    const g = (...args: string[]) => execFileSync("git", args, { cwd: upstream, stdio: "ignore" });
    await writeFile(path.join(upstream, "CHANGES.md"), "second\n");
    g("add", ".");
    g("commit", "-qm", "second");
    // git ignores --depth for a plain local path; file:// takes the transport route.
    const r = await cli(fx.root, fx.home, ["repos", "add", `file://${upstream}`, "--name", "shallow", "--depth", "1"]);
    assert.equal(r.code, 0, r.all);
    const dir = path.join(fx.root, "kraftwerk-data/repos/shallow");
    assert.equal(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, encoding: "utf8" }).trim(), "1");
    assert.equal((await cli(fx.root, fx.home, ["repos", "add", upstream, "--name", "x", "--depth", "0"])).code, 1);
    assert.equal((await cli(fx.root, fx.home, ["repos", "remove", "shallow", "--force"])).code, 0);
  });
});
