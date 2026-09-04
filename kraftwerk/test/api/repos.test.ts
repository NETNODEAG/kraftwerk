import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { RepoInfo, ReposView } from "../../src/inspector/repos.js";

/**
 * Repositories over the HTTP API: the feature flag, cloning into the root,
 * what the listing reads from git, fast-forward updates, and removal
 * guards. The upstream is a local repo, so nothing touches the network.
 */
describe("repositories API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let upstreamBase: string;
  let upstream: string;
  const ugit = (...args: string[]): string =>
    execFileSync("git", args, { cwd: upstream, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  before(async () => {
    fx = await makeProject("name: fixture\n");
    srv = await startServer(fx);
    upstreamBase = await mkdtemp(path.join(os.tmpdir(), "kraftwerk-upstream-"));
    upstream = path.join(upstreamBase, "widgets.git");
    await mkdir(upstream);
    ugit("init", "-q", "-b", "main");
    ugit("config", "user.email", "up@example.com");
    ugit("config", "user.name", "up");
    ugit("config", "commit.gpgsign", "false");
    await writeFile(path.join(upstream, "README.md"), "# widgets\n");
    ugit("add", ".");
    ugit("commit", "-qm", "first");
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
    await rm(upstreamBase, { recursive: true, force: true });
  });

  const headers = { "content-type": "application/json" };
  const list = async (): Promise<ReposView> => (await fetch(srv.url + "/api/repos")).json();
  const add = (body: unknown) =>
    fetch(srv.url + "/api/repos", { method: "POST", headers: { ...headers, origin: new URL(srv.url).origin }, body: JSON.stringify(body) });
  const update = (slug: string) =>
    fetch(`${srv.url}/api/repos/${slug}/update`, { method: "POST", headers: { origin: new URL(srv.url).origin } });
  const remove = (slug: string, force = false) =>
    fetch(`${srv.url}/api/repos/${slug}${force ? "?force=1" : ""}`, { method: "DELETE", headers: { origin: new URL(srv.url).origin } });
  const settings = (repos: unknown) =>
    fetch(srv.url + "/api/settings", { method: "PUT", headers: { ...headers, origin: new URL(srv.url).origin }, body: JSON.stringify({ repos }) });
  const meta = async (): Promise<{ repos: boolean }> => (await fetch(srv.url + "/api/meta")).json();

  it("is off without a repos block: listing says so, cloning is refused", async () => {
    assert.equal((await meta()).repos, false);
    const v = await list();
    assert.equal(v.enabled, false);
    assert.match(v.error ?? "", /off/);
    assert.equal((await add({ url: upstream })).status, 409);
  });

  it("settings turn it on, create the root and git-ignore it", async () => {
    const r = await settings({ enabled: true, root: "kraftwerk-data/repos" });
    assert.equal(r.status, 200, await r.text());
    assert.equal((await meta()).repos, true);
    assert.match(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), /^repos:\n  root: kraftwerk-data\/repos$/m);
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/repos")));
    assert.match(await readFile(path.join(fx.root, ".gitignore"), "utf8"), /^kraftwerk-data\/repos\/$/m);
    const v = await list();
    assert.equal(v.enabled, true);
    assert.equal(v.root, path.join(fx.root, "kraftwerk-data/repos"));
    assert.deepEqual(v.repos, []);
  });

  it("refuses a root that is the project itself or outside it", async () => {
    for (const root of [".", "..", "kraftwerk-data/../..", "/tmp", fx.root]) {
      const r = await settings({ enabled: true, root });
      assert.equal(r.status, 400, root);
      assert.match(((await r.json()) as { error: string }).error, /inside the project/, root);
    }
    assert.match(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), /^repos:\n  root: kraftwerk-data\/repos$/m, "config untouched");
  });

  it("rejects bad input before touching git", async () => {
    for (const body of [{}, { url: "" }, { url: "--upload-pack=x" }, { url: upstream, name: "../x" }, { url: upstream, name: ".hidden" }, { url: upstream, branch: "-x" }, { url: upstream, depth: 0 }, { url: upstream, depth: "1" }]) {
      const r = await add(body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal((await list()).repos.length, 0);
  });

  it("clones into <root>/<name>, name derived from the url", async () => {
    const r = await add({ url: upstream });
    const repo = (await r.json()) as RepoInfo;
    assert.equal(r.status, 201, JSON.stringify(repo));
    assert.equal(repo.slug, "widgets");
    assert.equal(repo.path, path.join(fx.root, "kraftwerk-data/repos/widgets"));
    assert.equal(repo.url, upstream);
    assert.equal(repo.branch, "main");
    assert.equal(repo.subject, "first");
    assert.equal(repo.dirty, 0);
    assert.equal(repo.ahead, 0);
    assert.equal(repo.behind, 0);
    assert.ok(existsSync(path.join(repo.path, "README.md")));
    assert.equal((await add({ url: upstream })).status, 400, "same name twice");
  });

  it("lists a clone an agent made by hand, and skips folders that are not repos", async () => {
    const root = path.join(fx.root, "kraftwerk-data/repos");
    execFileSync("git", ["clone", "-q", upstream, path.join(root, "by-hand")], { stdio: "ignore" });
    await mkdir(path.join(root, "not-a-repo"));
    await writeFile(path.join(root, "stray.txt"), "");
    const v = await list();
    assert.deepEqual(v.repos.map((r) => r.slug), ["by-hand", "widgets"]);
    assert.equal(v.repos[0].url, upstream);
  });

  it("update fast-forwards a clean clone that fell behind", async () => {
    await writeFile(path.join(upstream, "CHANGES.md"), "second\n");
    ugit("add", ".");
    ugit("commit", "-qm", "second");
    const r = await update("widgets");
    const body = (await r.json()) as { ok: boolean; repo: RepoInfo; error?: string };
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.error, undefined);
    assert.equal(body.repo.subject, "second");
    assert.equal(body.repo.behind, 0);
    assert.equal((await update("nope")).status, 404);
  });

  it("update leaves a dirty clone alone and says why", async () => {
    const dir = path.join(fx.root, "kraftwerk-data/repos/widgets");
    await writeFile(path.join(dir, "README.md"), "# widgets\nlocal\n");
    await writeFile(path.join(upstream, "MORE.md"), "third\n");
    ugit("add", ".");
    ugit("commit", "-qm", "third");
    const r = await update("widgets");
    const body = (await r.json()) as { ok: boolean; repo: RepoInfo; error?: string };
    assert.equal(r.status, 200);
    assert.match(body.error ?? "", /local changes/);
    assert.equal(body.repo.behind, 1);
    assert.equal(body.repo.dirty, 1);
    assert.equal(body.repo.subject, "second");
  });

  it("refuses to remove a clone whose commits exist nowhere else, even on a branch without upstream", async () => {
    const dir = path.join(fx.root, "kraftwerk-data/repos/by-hand");
    const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    g("config", "user.email", "me@example.com");
    g("config", "user.name", "me");
    g("config", "commit.gpgsign", "false");
    g("checkout", "-qb", "feature");
    await writeFile(path.join(dir, "work.md"), "local only\n");
    g("add", ".");
    g("commit", "-qm", "local work");
    const listed = (await list()).repos.find((r) => r.slug === "by-hand");
    assert.equal(listed?.branch, "feature");
    assert.equal(listed?.ahead, 1);
    assert.equal(listed?.behind, undefined);
    const r = await remove("by-hand");
    assert.equal(r.status, 409);
    assert.match(((await r.json()) as { error: string }).error, /unpushed/);
    g("checkout", "-q", "main");
    g("branch", "-qD", "feature");
  });

  it("a clone git cannot read is listed as unreadable and needs force to remove", async () => {
    // A .git file pointing nowhere: git fails on it instead of walking up to the workspace repo.
    const root = path.join(fx.root, "kraftwerk-data/repos");
    await mkdir(path.join(root, "broken"), { recursive: true });
    await writeFile(path.join(root, "broken", ".git"), "gitdir: /nonexistent-gitdir\n");
    const listed = (await list()).repos.find((r) => r.slug === "broken");
    assert.ok(listed?.error, "unreadable clone is listed with its error");
    assert.equal(listed?.ahead, undefined);
    assert.equal((await remove("broken")).status, 409);
    assert.equal((await remove("broken", true)).status, 200);
    assert.ok(!existsSync(path.join(root, "broken")));
  });

  it("refuses to remove a clone with uncommitted work unless forced", async () => {
    const r = await remove("widgets");
    assert.equal(r.status, 409);
    assert.match(((await r.json()) as { error: string }).error, /uncommitted/);
    assert.equal((await remove("widgets", true)).status, 200);
    assert.equal((await remove("widgets")).status, 404);
    assert.equal((await remove(".hidden")).status, 400);
    assert.deepEqual((await list()).repos.map((r) => r.slug), ["by-hand"]);
  });

  it("keeps the clones out of the workspace git sync", async () => {
    await fx.write("kraftwerk.yml", "name: fixture\ngit:\n  interval: 0\nrepos:\n  root: kraftwerk-data/repos\n");
    await rm(path.join(fx.root, ".gitignore"));
    const st = (await (await fetch(srv.url + "/api/git?fresh=1")).json()) as { files?: { path: string; syncable: boolean; reason?: string }[] };
    const inside = (st.files ?? []).filter((f) => f.path.startsWith("kraftwerk-data/repos/"));
    assert.ok(inside.length > 0, "the un-ignored clone shows up in status");
    for (const f of inside) assert.equal(f.syncable, false, f.path);
  });

  it("enabled: false keeps the root but turns the feature off", async () => {
    const r = await settings({ enabled: false, root: "kraftwerk-data/repos" });
    assert.equal(r.status, 200);
    assert.match(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), /^repos:\n  enabled: false\n  root: kraftwerk-data\/repos$/m);
    assert.equal((await list()).enabled, false);
    assert.equal((await remove("by-hand", true)).status, 409);
    assert.equal((await update("by-hand")).status, 409);
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/repos/by-hand/.git")), "nothing deleted while off");
  });
});
