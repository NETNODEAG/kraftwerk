import * as z from "zod";
import { resolveWorkspace } from "../../config.js";
import { workspaceRoot } from "../../core/context.js";
import { gitCommit, gitDiff, gitFetch, gitPull, gitPush, gitStatus, type GitStatus } from "../../core/git.js";
import { cloudStatus } from "../cloud.js";
import { setupSync } from "../sync-setup.js";
import { addRepo, listRepos, openRepos, removeRepo, repoCommitDiff, repoDetail, repoDiff, updateRepo } from "../../core/repos.js";
import { fail, reply, route, statusByMessage } from "./router.js";

const repoErrors = statusByMessage(/^no repository/);
const conflictUnlessOk = <T extends { ok: boolean }>(result: T) => reply(result.ok ? 200 : 409, result);

/** Files to stage and the message; the domain refuses an empty selection or message. */
const Commit = z.object({ paths: z.array(z.string()).default([]), message: z.string().default("") });
/** A clone to add; url, name, branch and depth are checked by addRepo. */
const AddRepo = z.object({ url: z.string().default(""), name: z.string().optional(), branch: z.string().optional(), depth: z.number().optional() });

/**
 * Who hosts the workspace's remote: kraftwerk sync is the workspace's own
 * repo in kraftwerk cloud, `<cloud>/git/<id>.git` (the cloud's host when this
 * machine knows it); anything else is an own git provider.
 */
export async function hostingOf(remoteUrl: string | undefined): Promise<NonNullable<GitStatus["hosting"]>> {
  if (!remoteUrl) return "none";
  const id = (await resolveWorkspace(workspaceRoot()).catch(() => null))?.config.id;
  let u: URL;
  try {
    u = new URL(remoteUrl);
  } catch {
    return "custom"; // scp-like ssh (git@host:path) — never kraftwerk sync
  }
  const cloud = cloudStatus().url;
  const sameHost = !cloud || (() => { try { return new URL(cloud).host === u.host; } catch { return false; } })();
  return id && sameHost && u.pathname.replace(/\/+$/, "") === `/git/${encodeURIComponent(id)}.git` ? "kraftwerk" : "custom";
}

/** The workspace's own git, and the repositories cloned under its repos root. */
export const gitRoutes = [
  // The git screen polls this, so it is cached for a beat; ?fresh=1 bypasses the cache.
  route({ name: "git.status", method: "GET", path: "/api/git", summary: "branch, ahead/behind, changed files" }, async (c) => {
    const st = await gitStatus(c.query.has("fresh"));
    return st.repoRoot ? { ...st, hosting: await hostingOf(st.remoteUrl) } : st;
  }),
  route({ name: "git.diff", method: "GET", path: "/api/git/diff", summary: "unified diff for one file ?path=" }, async (c) => {
    const file = c.query.get("path");
    if (!file) fail(400, "path required");
    return gitDiff(file);
  }),
  // Committing stays manual: the background timer never writes history, and pushes it only with `autosync: push`.
  route({ name: "git.commit", method: "POST", path: "/api/git/commit", summary: "stage and commit {paths, message}", errors: 400, body: Commit }, async (c) => {
    const { paths, message } = await c.body();
    const result = await gitCommit(paths, message);
    return reply(result.ok ? 200 : 409, result);
  }),
  // kraftwerk sync in one go (server/sync-setup.ts); 409 while cloud mode is not there or the remote is someone else's.
  route({ name: "git.setupSync", method: "POST", path: "/api/git/sync-setup", summary: "set up kraftwerk sync: repo, git block, cloud remote, first push", errors: 409 }, async () => {
    const r = await setupSync();
    const st = r.status.repoRoot ? { ...r.status, hosting: await hostingOf(r.status.remoteUrl) } : r.status;
    return reply(r.ok ? 200 : 409, { ...r, status: st });
  }),
  route({ name: "git.fetch", method: "POST", path: "/api/git/fetch", summary: "git fetch" }, async () => conflictUnlessOk(await gitFetch())),
  route({ name: "git.pull", method: "POST", path: "/api/git/pull", summary: "git pull --ff-only" }, async () => conflictUnlessOk(await gitPull())),
  route({ name: "git.push", method: "POST", path: "/api/git/push", summary: "git push" }, async () => conflictUnlessOk(await gitPush())),

  route({ name: "repos.list", method: "GET", path: "/api/repos", summary: "every clone under the repos root, read live from git" }, async () => listRepos()),
  route({ name: "repos.add", method: "POST", path: "/api/repos", summary: "clone {url, name?, branch?, depth?} into the root", errors: 400, body: AddRepo }, async (c) => {
    if ((await openRepos()).off) fail(409, "repositories are off");
    return reply(201, await addRepo(await c.body()));
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
