import { gitCommit, gitDiff, gitFetch, gitPull, gitPush, gitStatus } from "../git.js";
import { addRepo, listRepos, openRepos, removeRepo, repoCommitDiff, repoDetail, repoDiff, updateRepo } from "../repos.js";
import { fail, reply, route, statusByMessage } from "./router.js";

const repoErrors = statusByMessage(/^no repository/);
const conflictUnlessOk = <T extends { ok: boolean }>(result: T) => reply(result.ok ? 200 : 409, result);

/** The workspace's own git, and the repositories cloned under its repos root. */
export const gitRoutes = [
  // The git screen polls this, so it is cached for a beat; ?fresh=1 bypasses the cache.
  route({ name: "git.status", method: "GET", path: "/api/git", summary: "branch, ahead/behind, changed files" }, async (c) => gitStatus(c.query.has("fresh"))),
  route({ name: "git.diff", method: "GET", path: "/api/git/diff", summary: "unified diff for one file ?path=" }, async (c) => {
    const file = c.query.get("path");
    if (!file) fail(400, "path required");
    return gitDiff(file);
  }),
  // Commit and push stay manual; the background timer never writes history.
  route({ name: "git.commit", method: "POST", path: "/api/git/commit", summary: "stage and commit {paths, message}", errors: 400 }, async (c) => {
    const body = await c.body<{ paths?: unknown; message?: unknown }>();
    const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];
    const result = await gitCommit(paths, typeof body.message === "string" ? body.message : "");
    return reply(result.ok ? 200 : 409, result);
  }),
  route({ name: "git.fetch", method: "POST", path: "/api/git/fetch", summary: "git fetch" }, async () => conflictUnlessOk(await gitFetch())),
  route({ name: "git.pull", method: "POST", path: "/api/git/pull", summary: "git pull --ff-only" }, async () => conflictUnlessOk(await gitPull())),
  route({ name: "git.push", method: "POST", path: "/api/git/push", summary: "git push" }, async () => conflictUnlessOk(await gitPush())),

  route({ name: "repos.list", method: "GET", path: "/api/repos", summary: "every clone under the repos root, read live from git" }, async () => listRepos()),
  route({ name: "repos.add", method: "POST", path: "/api/repos", summary: "clone {url, name?, branch?, depth?} into the root", errors: 400 }, async (c) => {
    if ((await openRepos()).off) fail(409, "repositories are off");
    const body = await c.body<{ url?: unknown; name?: unknown; branch?: unknown; depth?: unknown }>();
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const depth = body.depth === undefined ? undefined : typeof body.depth === "number" ? body.depth : Number.NaN;
    return reply(201, await addRepo({ url: str(body.url) ?? "", name: str(body.name), branch: str(body.branch), depth }));
  }),
  route({ name: "repos.get", method: "GET", path: "/api/repos/:slug", summary: "changed files, line counts, recent commits (unpushed marked)", errors: repoErrors }, async (c) => {
    const detail = await repoDetail(c.params.slug);
    return detail ?? fail(404, `no repository "${c.params.slug}"`);
  }),
  route({ name: "repos.diff", method: "GET", path: "/api/repos/:slug/diff", summary: "unified diff of one changed file ?path= against HEAD", errors: repoErrors }, async (c) => {
    const d = await repoDiff(c.params.slug, c.query.get("path") ?? "");
    return reply(d.error ? (/^not shown/.test(d.error) ? 404 : 400) : 200, d);
  }),
  route({ name: "repos.commit", method: "GET", path: "/api/repos/:slug/commits/:hash", summary: "one commit as a patch", errors: repoErrors }, async (c) => {
    const d = await repoCommitDiff(c.params.slug, c.params.hash);
    return reply(d.error ? (/^no such commit/.test(d.error) ? 404 : 400) : 200, d);
  }),
  route({ name: "repos.update", method: "POST", path: "/api/repos/:slug/update", summary: "fetch, fast-forward when clean", errors: 400 }, async (c) => {
    const result = await updateRepo(c.params.slug);
    return reply(result.ok ? 200 : result.repo || result.off ? 409 : 404, result);
  }),
  // 409 while the clone holds unpushed or uncommitted work, unless ?force=1.
  route({ name: "repos.remove", method: "DELETE", path: "/api/repos/:slug", summary: "remove the clone", errors: 400 }, async (c) => {
    const result = await removeRepo(c.params.slug, ["1", "true"].includes(c.query.get("force") ?? ""));
    return reply(result.ok ? 200 : result.conflict || result.off ? 409 : 404, result);
  }),
];
