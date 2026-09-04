import { promises as fs } from "node:fs";
import path from "node:path";
import { gitignoreHas, ignoreEntryFor, reposRootFor, resolveProject, type Project } from "../config.js";
import { getProjectRoot } from "./context.js";
import { newestMtime } from "./mtime.js";
import { git, gitNet, sshCommandFor } from "./git.js";

/**
 * Repositories: the git clones an agent works on, kept under one root
 * inside the project (`repos.root` in kraftwerk.yml, default repos/). The
 * folder is the registry: whatever has a .git directory directly under the
 * root is a repository, whoever put it there — this module, the CLI, or an
 * agent running plain `git clone`. Everything shown about a clone is read
 * from git on request, so nothing here can go stale.
 *
 * The root lives inside the project on purpose: chat sessions run in the
 * project root, so every harness reaches the clones without extra grants.
 * It must stay out of the workspace git: `kraftwerk init` ignores it, and
 * the workspace sync never stages it.
 *
 * Like git.ts, every call passes an argument array (nothing reaches a
 * shell), never prompts, and times out — a clone from a web UI must fail
 * loudly, not park on a credential prompt nobody sees.
 */

export interface RepoInfo {
  /** Folder name under the root; the id everywhere. */
  slug: string;
  /** Absolute path of the clone. */
  path: string;
  /** origin url, absent when the clone has no origin. */
  url?: string;
  /** Checked-out branch, or "HEAD" when detached. */
  branch?: string;
  /** Short hash of HEAD. */
  head?: string;
  /** Subject of the HEAD commit. */
  subject?: string;
  /** ISO timestamp of the HEAD commit. */
  committedAt?: string;
  /** Modified, added, deleted or untracked paths (porcelain count). */
  dirty: number;
  /** Commits not on the upstream, or not on any remote when the branch tracks nothing. Absent when git could not tell. */
  ahead?: number;
  /** Commits on the upstream not here. Absent when the branch tracks nothing. */
  behind?: number;
  /** Newest change in the working tree (.git, node_modules and dot entries excluded); lists sort by it. */
  updatedAt?: string;
  /** Set when git could not be read for this folder. */
  error?: string;
}

export interface ReposView {
  enabled: boolean;
  root?: string;
  repos: RepoInfo[];
  /** Set when the feature is on but unusable, or off. */
  error?: string;
}

export interface AddRepoInput {
  url: string;
  name?: string;
  branch?: string;
  /** Shallow clone with this many commits of history (`git clone --depth`). */
  depth?: number;
}

/**
 * A clone is the one call here that can legitimately take long: a large
 * repository on a slow link is minutes, not seconds. Prompts are already
 * disabled (git.ts), so a long timeout only ever cuts a transfer that is
 * still running, and the partial clone is deleted when it does.
 */
export const CLONE_TIMEOUT = 30 * 60_000;

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function safeRepoSlug(slug: string): string {
  if (!SLUG_RE.test(slug) || slug === "." || slug === "..") throw new Error(`invalid repository name "${slug}"`);
  return slug;
}

/** "https://github.com/org/repo.git" → "repo"; "git@host:org/repo" → "repo". */
export function slugFromUrl(url: string): string {
  const last = url.replace(/[/:]+$/, "").split(/[/:]/).pop() ?? "";
  const slug = last.replace(/\.git$/, "");
  return safeRepoSlug(slug);
}

/**
 * The url git gets. `github:org/repo` is the same shorthand `--from`
 * accepts. Anything starting with a dash would be read as an option, and
 * empty is empty.
 */
export function cloneUrl(input: string): string {
  const url = input.trim();
  if (!url) throw new Error("url is required");
  if (url.startsWith("-")) throw new Error(`invalid url "${url}"`);
  const gh = /^github:([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url);
  if (gh) return `https://github.com/${gh[1]}.git`;
  return url;
}

/** Resolve the project and its repos block. `off` when the feature is not on. */
export async function openRepos(): Promise<{ project?: Project; root?: string; off?: boolean; error?: string }> {
  let project: Project;
  try {
    project = await resolveProject(getProjectRoot());
  } catch (err) {
    return { error: (err as Error).message };
  }
  const root = reposRootFor(project);
  if (!root) return { off: true, error: "repositories are off (enable them in settings or add `repos:` to kraftwerk.yml)" };
  return { project, root };
}

/**
 * Everything about a clone in three git calls. `status --porcelain=v2
 * --branch` carries the branch, its upstream, ahead/behind and the change
 * list in one spawn; `log` the head; `remote` the origin. Only a branch
 * without upstream costs one more call.
 */
async function inspect(root: string, slug: string): Promise<RepoInfo> {
  const dir = path.join(root, slug);
  const info: RepoInfo = { slug, path: dir, dirty: 0 };
  const [status, log, origin, newest] = await Promise.all([
    git(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], dir),
    git(["log", "-1", "--format=%h%x00%s%x00%cI"], dir),
    git(["remote", "get-url", "origin"], dir),
    newestMtime(dir),
  ]);
  if (newest) info.updatedAt = new Date(newest).toISOString();
  if (!status.ok) return { ...info, error: status.stderr || "not a git repository" };
  if (origin.ok) info.url = origin.stdout.trim();
  if (log.ok) {
    const [head, subject, committedAt] = log.stdout.trim().split("\0");
    info.head = head;
    info.subject = subject;
    info.committedAt = committedAt;
  }
  let hasUpstream = false;
  for (const line of status.stdout.split("\n")) {
    if (!line.trim()) continue;
    if (!line.startsWith("# ")) {
      info.dirty++;
      continue;
    }
    const [key, ...rest] = line.slice(2).split(" ");
    const value = rest.join(" ");
    if (key === "branch.head") info.branch = value === "(detached)" ? "HEAD" : value;
    else if (key === "branch.upstream") hasUpstream = true;
    else if (key === "branch.ab") {
      const m = /^\+(\d+) -(\d+)$/.exec(value);
      if (m) {
        info.ahead = Number(m[1]);
        info.behind = Number(m[2]);
      }
    }
  }
  if (!hasUpstream || info.ahead === undefined) {
    // No upstream (a branch made locally, a detached HEAD): count what no
    // remote has, so the remove guard still knows about unpushed work.
    const local = await git(["rev-list", "--count", "HEAD", "--not", "--remotes"], dir);
    if (local.ok && /^\d+$/.test(local.stdout.trim())) info.ahead = Number(local.stdout.trim());
  }
  return info;
}

/** Every clone under the root, alphabetically. Folders without .git are skipped. */
export async function listRepos(): Promise<ReposView> {
  const opened = await openRepos();
  if (!opened.root) return { enabled: false, repos: [], error: opened.error };
  const root = opened.root;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const slugs: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue;
    if (await fs.stat(path.join(root, e.name, ".git")).catch(() => null)) slugs.push(e.name);
  }
  slugs.sort((a, b) => a.localeCompare(b));
  const repos = await Promise.all(slugs.map((s) => inspect(root, s)));
  return { enabled: true, root, repos };
}

const cloneError = (r: { stderr: string; stdout: string }): string =>
  (r.stderr || r.stdout || "git clone failed").split("\n").filter((l) => l.trim()).slice(-3).join(" ");

/**
 * Clone into <root>/<slug>. The folder is claimed with a plain mkdir first:
 * it fails when anything is there already, whatever it is, and two adds of
 * the same name racing each other cannot both win. Only what this call
 * created is deleted when the clone fails.
 */
export async function addRepo(input: AddRepoInput): Promise<RepoInfo> {
  const opened = await openRepos();
  if (!opened.root || !opened.project) throw new Error(opened.error ?? "repositories are off");
  const url = cloneUrl(input.url);
  const slug = input.name?.trim() ? safeRepoSlug(input.name.trim()) : slugFromUrl(url);
  const branch = input.branch?.trim();
  if (branch && (branch.startsWith("-") || /\s/.test(branch))) throw new Error(`invalid branch "${branch}"`);
  if (input.depth !== undefined && (!Number.isInteger(input.depth) || input.depth < 1)) throw new Error(`invalid depth "${input.depth}"`);
  const dest = path.join(opened.root, slug);
  await prepareRoot(opened.project, opened.root);
  try {
    await fs.mkdir(dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`"${slug}" already exists under ${opened.root}`);
    throw err;
  }
  const args = [
    "-c", "protocol.ext.allow=never", "clone",
    ...(branch ? ["--branch", branch] : []),
    ...(input.depth ? ["--depth", String(input.depth)] : []),
    "--", url, dest,
  ];
  const r = await git(args, opened.root, CLONE_TIMEOUT, { GIT_SSH_COMMAND: await sshCommandFor(opened.project.root) });
  if (!r.ok) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    throw new Error(cloneError(r));
  }
  return inspect(opened.root, slug);
}

/**
 * Fetch, then fast-forward when the clone is behind and clean. Never merges:
 * a diverged or dirty clone is reported, and the agent (or a terminal)
 * sorts it out inside the repo.
 */
export async function updateRepo(slug: string): Promise<{ ok: boolean; error?: string; off?: boolean; repo?: RepoInfo }> {
  safeRepoSlug(slug);
  const opened = await openRepos();
  if (!opened.root) return { ok: false, off: true, error: opened.error };
  const dir = path.join(opened.root, slug);
  if (!(await fs.stat(path.join(dir, ".git")).catch(() => null))) return { ok: false, error: `no repository "${slug}"` };
  const fetched = await gitNet(["fetch", "--prune"], dir);
  if (!fetched.ok) return { ok: false, error: fetched.stderr || "git fetch failed", repo: await inspect(opened.root, slug) };
  let repo = await inspect(opened.root, slug);
  if (repo.behind && !repo.ahead && repo.dirty === 0) {
    const pulled = await git(["merge", "--ff-only", "@{upstream}"], dir);
    if (!pulled.ok) return { ok: false, error: pulled.stderr || "fast-forward failed", repo };
    repo = await inspect(opened.root, slug);
  } else if (repo.behind && (repo.ahead || repo.dirty)) {
    return { ok: true, error: repo.ahead ? "diverged from upstream, not fast-forwarded" : "local changes, not fast-forwarded", repo };
  }
  return { ok: true, repo };
}

/**
 * Delete the clone. Refuses while it holds unpushed or uncommitted work, or
 * while git cannot tell, unless forced: the clone may be the only copy.
 */
export async function removeRepo(slug: string, force = false): Promise<{ ok: boolean; error?: string; off?: boolean; conflict?: boolean }> {
  safeRepoSlug(slug);
  const opened = await openRepos();
  if (!opened.root) return { ok: false, off: true, error: opened.error };
  const dir = path.join(opened.root, slug);
  if (!(await fs.stat(path.join(dir, ".git")).catch(() => null))) return { ok: false, error: `no repository "${slug}"` };
  if (!force) {
    const repo = await inspect(opened.root, slug);
    if (repo.error) return { ok: false, conflict: true, error: `"${slug}" cannot be read (${repo.error}); remove it with --force` };
    if (repo.dirty) return { ok: false, conflict: true, error: `"${slug}" has ${repo.dirty} uncommitted change(s)` };
    if (repo.ahead === undefined) return { ok: false, conflict: true, error: `"${slug}": cannot tell whether it has unpushed commits; remove it with --force` };
    if (repo.ahead) return { ok: false, conflict: true, error: `"${slug}" has ${repo.ahead} unpushed commit(s)` };
  }
  await fs.rm(dir, { recursive: true, force: true });
  return { ok: true };
}

/**
 * Make sure the root exists and is ignored by the workspace git: a clone
 * inside a tracked tree shows up as an untracked gitlink for everyone.
 * Best effort — a missing .gitignore is created, one that already covers
 * the root is left alone. Runs before every clone as well as when the
 * feature is switched on, so a root enabled by editing kraftwerk.yml is
 * ignored by the time the first clone lands.
 */
export async function ensureReposRoot(): Promise<void> {
  const project = await resolveProject(getProjectRoot());
  const root = reposRootFor(project);
  if (!root) return;
  await prepareRoot(project, root);
}

async function prepareRoot(project: Project, root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const entry = ignoreEntryFor(project.root, root);
  if (!entry) return;
  const ignorePath = path.join(project.root, ".gitignore");
  const existing = await fs.readFile(ignorePath, "utf8").catch(() => null);
  if (existing !== null && gitignoreHas(existing, entry)) return;
  const line = `${entry}/\n`;
  await fs.writeFile(ignorePath, existing === null ? line : `${existing}${existing.endsWith("\n") ? "" : "\n"}${line}`).catch(() => {});
}
