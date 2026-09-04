import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { reposRootFor, resolveProject, vibeablesRootFor, type Project } from "../config.js";
import { ENV_FILE } from "../runner/docker.js";
import { getOutputDir, getProjectRoot } from "./context.js";

/**
 * Workspace git sync. Several people run kraftwerk against one git repo, so
 * knowledge, agents, skills and workflows travel between them like any other
 * tracked file. The inspector shows what changed, lets a human pick files and
 * commit them, and pushes on request.
 *
 * Deliberate limits, because this runs git on someone's repo from a web UI
 * that has no authentication of its own:
 *
 * - Only the roots kraftwerk.yml already declares are ever staged, never the
 *   whole repo, and never the output directory (runs and chats are noise).
 * - DENY matches (.env, keys) are never staged, and `git add -f` is never
 *   called, so .gitignore keeps its meaning.
 * - Reads are scoped too: the diff endpoint only shows a path the status
 *   screen lists as syncable, and status never lists what .gitignore hides,
 *   so an untracked .env cannot be read through it.
 * - Commit and push are manual. The background timer only fetches, and pulls
 *   fast-forward when `autosync: pull` is set, the configured branch is the
 *   one checked out, and no tracked file is modified.
 * - A diverged branch is reported, never merged or rebased from here.
 *
 * Every git call passes an argument array, so nothing reaches a shell, and
 * every call is async with a timeout: git runs inside the single-threaded
 * inspector, so a network operation must never block the event loop, and a
 * remote asking for credentials must fail instead of waiting forever on a
 * terminal nobody is watching.
 */

/** Files that must never be staged, whatever the scope says. */
const DENY = [
  /(^|\/)\.env($|\.)/,
  /(^|\/)\.envrc$/,
  new RegExp(`(^|/)${ENV_FILE.replace(/\./g, "\\.")}$`),
  /\.(pem|key|p12|pfx)$/,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)/,
  /(^|\/)\.(netrc|npmrc|pypirc)$/,
  /(^|\/)credentials\.json$/,
];

const DEFAULTS = { remote: "origin", interval: 300, autosync: "pull" as const };

export interface GitFile {
  /** Path relative to the repo root, which is what git speaks. */
  path: string;
  /** Two-letter porcelain code, e.g. " M", "??", "A ". */
  code: string;
  /** Human label for the code: modified, added, deleted, renamed, untracked. */
  status: string;
  /** Inside a synced root and not denied, so it can be selected. */
  syncable: boolean;
  /** Why it cannot be selected, when it cannot. */
  reason?: string;
}

export interface GitStatus {
  enabled: boolean;
  /** Set when the feature is on but the repo cannot be used. */
  error?: string;
  repoRoot?: string;
  branch?: string;
  /** Configured or inferred upstream, absent when the branch tracks nothing. */
  upstream?: string;
  remote?: string;
  ahead?: number;
  behind?: number;
  /** True when the branches have diverged, which needs a terminal. */
  diverged?: boolean;
  files?: GitFile[];
  /** Blocked entries left out of `files` because the list was capped. */
  blockedHidden?: number;
  /** Repo-relative roots that may be committed. */
  scope?: string[];
  autosync?: "off" | "pull";
  interval?: number;
  lastFetch?: string;
  lastPull?: string;
  lastError?: string;
}

export interface GitDiff {
  diff: string;
  error?: string;
  /** The diff was cut at MAX_DIFF; the rest is available in a terminal. */
  truncated?: boolean;
}

export interface GitResult {
  ok: boolean;
  /** Exit status, or null when git never ran (spawn error) or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** The git block with defaults applied. */
interface ResolvedGit {
  remote: string;
  branch?: string;
  interval: number;
  autosync: "off" | "pull";
}

/** Everything a git operation needs, resolved once per request. */
interface Repo {
  cfg: ResolvedGit;
  project: Project;
  repoRoot: string;
}

/** Local operations are quick; anything touching the network gets longer. */
const LOCAL_TIMEOUT = 15_000;
export const NET_TIMEOUT = 60_000;
const MAX_OUTPUT = 32 * 1024 * 1024;
/** Longest diff the screen gets; a dumped database under knowledge/ is not something to read in a browser. */
const MAX_DIFF = 512 * 1024;
/** How long a status is reused; the nav badge polls it from every open tab. */
const CACHE_MS = 3_000;

/**
 * How many blocked files the status may carry. A repo with a large untracked
 * tree (node_modules before someone ignores it) has tens of thousands of
 * them, and this payload is polled every few seconds by every open tab.
 * Syncable files are never capped: the commit endpoint checks the selection
 * against them.
 */
const MAX_BLOCKED = 200;

/**
 * Never prompt. Without this a remote that wants a password parks git on a
 * terminal read that never returns, and the inspector hangs with it.
 */
const gitEnv = (extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GIT_OPTIONAL_LOCKS: "0",
  ...extra,
});

export function git(args: string[], cwd: string, timeoutMs = LOCAL_TIMEOUT, env?: NodeJS.ProcessEnv): Promise<GitResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", args, { cwd, env: gitEnv(env) });
    } catch (err) {
      return resolve({ ok: false, code: null, stdout: "", stderr: (err as Error).message });
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r: GitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, code: null, stdout, stderr: `git ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString();
    });
    child.once("error", (err) => finish({ ok: false, code: null, stdout, stderr: err.message }));
    child.once("close", (code) => finish({ ok: code === 0, code, stdout, stderr: stderr.trim() }));
  });
}

/**
 * ssh must not prompt either, but GIT_SSH_COMMAND takes precedence over
 * core.sshCommand, so setting it blindly would replace a per-repo key setup
 * (`ssh -i ~/.ssh/work_key`) with plain ssh and fail with "permission denied"
 * on a repo that works fine in a terminal. Take whatever is configured and
 * append BatchMode to it. An explicit GIT_SSH_COMMAND in our own environment
 * is left alone: whoever set it owns it.
 */
const sshCache = new Map<string, { at: number; cmd: string }>();
export async function sshCommandFor(repoRoot: string): Promise<string> {
  if (process.env.GIT_SSH_COMMAND) return process.env.GIT_SSH_COMMAND;
  const hit = sshCache.get(repoRoot);
  if (hit && Date.now() - hit.at < 60_000) return hit.cmd;
  const configured = (await git(["config", "--get", "core.sshCommand"], repoRoot)).stdout.trim();
  const cmd = `${configured || "ssh"} -o BatchMode=yes`;
  sshCache.set(repoRoot, { at: Date.now(), cmd });
  return cmd;
}

/** A git call that may touch the network: longer timeout, non-interactive ssh. */
export async function gitNet(args: string[], repoRoot: string): Promise<GitResult> {
  return git(args, repoRoot, NET_TIMEOUT, { GIT_SSH_COMMAND: await sshCommandFor(repoRoot) });
}

/**
 * Pathspecs are globs by default, so a file called `note[1].md` would not
 * match itself. `:(literal)` turns the pattern off.
 */
const literal = (p: string): string => `:(literal)${p}`;

/** Repo root for a directory, or null when it is not inside a git repo. */
export async function repoRootFor(dir: string): Promise<string | null> {
  const r = await git(["rev-parse", "--show-toplevel"], dir);
  return r.ok ? path.resolve(r.stdout.trim()) : null;
}

/**
 * Resolve the project, its git block and the repo root in one go. `off` when
 * kraftwerk.yml has no git block; `error` when it has one but the repo is
 * unusable. The config is re-read every time, so an edit to kraftwerk.yml
 * takes effect without a restart.
 */
async function openRepo(): Promise<{ repo?: Repo; cfg?: ResolvedGit; off?: boolean; error?: string }> {
  let project: Project;
  try {
    project = await resolveProject(getProjectRoot());
  } catch (err) {
    return { error: (err as Error).message };
  }
  const g = project.config.git;
  if (!g || g.enabled === false) return { off: true, error: "git sync is off" };
  const cfg: ResolvedGit = {
    remote: g.remote ?? DEFAULTS.remote,
    branch: g.branch,
    interval: g.interval ?? DEFAULTS.interval,
    autosync: g.autosync ?? DEFAULTS.autosync,
  };
  const repoRoot = await repoRootFor(project.root);
  if (!repoRoot) return { cfg, error: `${project.root} is not inside a git repository.` };
  return { repo: { cfg, project, repoRoot } };
}

/**
 * The checked-out branch, or why it cannot be synced: a detached HEAD, or a
 * configured branch that is not the one checked out. Without the second
 * check the background timer would fast-forward whatever branch happens to
 * be out, and a push would report success for the wrong ref.
 */
async function checkedOut(repo: Repo): Promise<{ branch?: string; error?: string }> {
  // symbolic-ref, not `rev-parse --abbrev-ref HEAD`: on a repo with no
  // commits yet rev-parse exits 128, which would render a blank branch name
  // and report a detached HEAD that isn't one. symbolic-ref answers on an
  // unborn branch and fails only when HEAD really is detached.
  const head = await git(["symbolic-ref", "--short", "HEAD"], repo.repoRoot);
  const branch = head.ok ? head.stdout.trim() : "";
  if (!branch) return { error: "HEAD is detached. Check out a branch to sync." };
  if (repo.cfg.branch && repo.cfg.branch !== branch) {
    return { branch, error: `kraftwerk.yml syncs "${repo.cfg.branch}" but "${branch}" is checked out.` };
  }
  return { branch };
}

interface Scope {
  include: string[];
  exclude: string[];
  /** A configured root IS the repo root, which would put every file in scope. */
  wholeRepo: boolean;
}

/**
 * The roots that may be committed, as repo-relative paths: the workflows,
 * knowledge, agents, skills and vibeables roots this project declares, plus
 * kraftwerk.yml. The output directory is excluded even when it lives inside
 * one of them.
 */
function scopeFor({ project, repoRoot }: Repo): Scope {
  // rev-parse reports the repo root with symlinks resolved; the project root
  // may be spelled through one (/var → /private/var on macOS, a linked
  // checkout). Compared unresolved, every root would look outside the repo.
  const real = (abs: string): string => {
    try {
      return realpathSync.native(abs);
    } catch {
      return path.resolve(abs);
    }
  };
  const rel = (abs: string): string | null => {
    const r = path.relative(repoRoot, real(abs));
    if (r.startsWith("..")) return null;
    return r.split(path.sep).join("/") || ".";
  };
  const roots = [
    project.workflowsRoot,
    path.resolve(project.root, project.config.knowledge ?? "knowledge"),
    path.resolve(project.root, project.config.agents ?? "agents"),
    path.resolve(project.root, project.config.skills ?? "skills"),
    // Vibeables are the workspace's own apps: versioned with it, unlike clones.
    vibeablesRootFor(project),
    project.configPath,
  ];
  const mapped = roots.filter((r): r is string => !!r).map(rel).filter((r): r is string => !!r);
  // Clones under the repos root are other people's history, never this
  // repo's: excluded like run artifacts, whatever the configured roots say.
  const excluded = [getOutputDir(), reposRootFor(project)].filter((r): r is string => !!r);
  return {
    include: [...new Set(mapped.filter((r) => r !== "."))],
    exclude: excluded.map(rel).filter((r): r is string => !!r && r !== "."),
    wholeRepo: mapped.includes("."),
  };
}

const within = (file: string, root: string): boolean =>
  file === root || file.startsWith(root.endsWith("/") ? root : root + "/");

/**
 * Why a repo-relative path may not be synced, or undefined when it may. The
 * one place that decides: status marks files with it, and commit and diff
 * only accept what status marked syncable.
 */
function reasonFor(file: string, code: string, scope: Scope): string | undefined {
  // `status --untracked-files=all` expands every directory except a nested
  // git repository, which it lists as `dir/`. Adding that records a gitlink
  // to a commit nobody else has: a broken entry for everyone who pulls.
  if (file.endsWith("/")) return "a nested git repository, not synced";
  if (DENY.some((re) => re.test(file))) return "never synced (secret or key)";
  if (scope.exclude.some((e) => within(file, e))) return "run artifacts or repositories, not synced";
  if (!scope.include.some((r) => within(file, r))) return "outside the workspace paths";
  if (/[RC]/.test(code)) return "renamed, commit it in a terminal";
  if (/U/.test(code) || code === "AA" || code === "DD") return "conflicted, resolve it in a terminal";
  return undefined;
}

/**
 * True when tracked files differ from HEAD, in the worktree or the index.
 * Untracked files are deliberately not counted: they do not stop
 * `pull --ff-only`, and treating them as dirt would disable autosync for
 * good in any repo with a scratch file lying around. A git error counts as
 * dirty, because not knowing is not a reason to merge.
 */
async function hasLocalChanges(repoRoot: string): Promise<boolean> {
  if (!(await git(["diff", "--quiet"], repoRoot)).ok) return true;
  return !(await git(["diff", "--cached", "--quiet"], repoRoot)).ok;
}

/** Label for a porcelain code, using whichever half is set. */
function label(code: string): string {
  if (code === "??") return "untracked";
  const c = code.replace(/ /g, "");
  if (c.includes("U") || c === "AA" || c === "DD") return "conflicted";
  if (c.includes("D")) return "deleted";
  if (c.includes("R")) return "renamed";
  if (c.includes("C")) return "copied";
  if (c.includes("A")) return "added";
  if (c.includes("M")) return "modified";
  if (c.includes("T")) return "typechange";
  return c || "changed";
}

/** Parse `git status --porcelain=v1 -z`, which NUL-separates and doubles up on renames and copies. */
function parseStatus(out: string): { path: string; code: string }[] {
  const parts = out.split("\0").filter((p) => p.length > 0);
  const files: { path: string; code: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    files.push({ path: entry.slice(3), code });
    // A rename or copy entry is followed by its source path in its own record.
    if (/[RC]/.test(code)) i++;
  }
  return files;
}

let statusCache: { at: number; value: GitStatus } | null = null;
/** Bumped by touched(); a status computed under an older value is stale. */
let generation = 0;

/** Invalidate the status cache after anything that changes the repo. */
const touched = (): void => {
  statusCache = null;
  generation++;
};

/**
 * One repo-mutating git command at a time. The background sync and the
 * request handlers share the repo: a `pull --ff-only` still holding
 * .git/index.lock when a commit arrives makes the commit fail with "index.lock:
 * File exists", and the rollback after it hits the same lock. So commit,
 * fetch, pull and push queue behind each other. Status stays outside the
 * queue (GIT_OPTIONAL_LOCKS=0 keeps it lock-free).
 */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

let lastFetch: string | undefined;
let lastPull: string | undefined;
let lastError: string | undefined;

/**
 * Everything the git screen renders. Each call shells out to git a handful
 * of times, and the nav badge polls it from every open tab, so results are
 * cached for a beat.
 */
export async function gitStatus(fresh = false): Promise<GitStatus> {
  if (!fresh && statusCache && Date.now() - statusCache.at < CACHE_MS) return statusCache.value;
  const gen = generation;
  const opened = await openRepo();
  if (opened.off) return { enabled: false };
  const { repo, cfg } = opened;
  if (!repo) return { enabled: true, error: opened.error, autosync: cfg?.autosync, interval: cfg?.interval };
  const { repoRoot } = repo;

  const [head, upstreamRes, status] = await Promise.all([
    checkedOut(repo),
    git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repoRoot),
    git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], repoRoot),
  ]);
  const upstream = upstreamRes.ok ? upstreamRes.stdout.trim() : undefined;

  let ahead: number | undefined;
  let behind: number | undefined;
  if (upstream) {
    const counts = await git(["rev-list", "--left-right", "--count", `${upstream}...HEAD`], repoRoot);
    if (counts.ok) {
      const [b, a] = counts.stdout.trim().split(/\s+/).map(Number);
      behind = Number.isFinite(b) ? b : undefined;
      ahead = Number.isFinite(a) ? a : undefined;
    }
  }

  const base: GitStatus = {
    enabled: true,
    repoRoot,
    branch: head.branch,
    upstream,
    remote: cfg?.remote ?? repo.cfg.remote,
    ahead,
    behind,
    diverged: !!ahead && !!behind,
    autosync: repo.cfg.autosync,
    interval: repo.cfg.interval,
    lastFetch,
    lastPull,
    lastError,
  };

  // A failed status (a stale index.lock, a timeout on a huge untracked tree)
  // must not read as "workspace clean": with no file list the commit endpoint
  // refuses everything, and the message should say why.
  if (!status.ok) {
    const value = { ...base, error: `git status failed: ${status.stderr || "unknown error"}` };
    if (gen === generation) statusCache = { at: Date.now(), value };
    return value;
  }

  const scope = scopeFor(repo);
  const all: GitFile[] = parseStatus(status.stdout).map((f) => {
    const reason = reasonFor(f.path, f.code, scope);
    return { path: f.path, code: f.code, status: label(f.code), syncable: !reason, reason };
  });
  const byPath = (a: GitFile, b: GitFile) => a.path.localeCompare(b.path);
  const syncable = all.filter((f) => f.syncable).sort(byPath);
  const blocked = all.filter((f) => !f.syncable).sort(byPath);
  const blockedHidden = Math.max(0, blocked.length - MAX_BLOCKED);

  const scopeError = scope.wholeRepo
    ? "A configured root points at the repository root, which would put the whole repo in scope. Narrow workflows/knowledge/agents/skills/vibeables in kraftwerk.yml."
    : undefined;

  const value: GitStatus = {
    ...base,
    error: head.error ?? scopeError,
    files: [...syncable, ...blocked.slice(0, MAX_BLOCKED)],
    blockedHidden: blockedHidden || undefined,
    scope: scope.include,
  };
  // A commit that finished while this status was running already emptied
  // the cache; caching the pre-commit list on top of that would show the
  // committed file as dirty for another CACHE_MS.
  if (gen === generation) statusCache = { at: Date.now(), value };
  return value;
}

/**
 * Unified diff for one changed file. Reading is as sensitive as writing
 * here: this endpoint has no auth of its own, and a diff of an untracked
 * .env is the file itself. So the status list is the one source of readable
 * paths: a file not listed there, or listed as blocked, is not shown.
 * Status never lists ignored files, which covers .gitignore too.
 */
export async function gitDiff(file: string): Promise<GitDiff> {
  if (file.includes("\0") || path.isAbsolute(file) || file.split("/").includes("..")) {
    return { diff: "", error: "invalid path" };
  }
  const st = await gitStatus();
  if (!st.enabled) return { diff: "", error: "git sync is off" };
  if (!st.repoRoot || !st.files) return { diff: "", error: st.error ?? "not a git repository" };
  const entry = st.files.find((f) => f.path === file);
  if (!entry) return { diff: "", error: "not shown: not a changed file under the workspace paths" };
  if (!entry.syncable) return { diff: "", error: `not shown: ${entry.reason}` };
  const { repoRoot } = st;

  // A repo without commits yet has nothing for `diff HEAD` to compare with;
  // there, as for an untracked file, the whole file is the change.
  const hasHead = (await git(["rev-parse", "--verify", "-q", "HEAD"], repoRoot)).ok;
  if (entry.code === "??" || !hasHead) {
    // --no-index exits 1 when the files differ, which is the normal case here.
    const r = await git(["diff", "--no-index", "--", "/dev/null", file], repoRoot);
    return r.stdout ? capDiff(r.stdout) : { diff: "", error: r.stderr || "no diff available" };
  }
  const r = await git(["diff", "HEAD", "--", literal(file)], repoRoot);
  return r.ok ? capDiff(r.stdout) : { diff: "", error: r.stderr || "diff failed" };
}

function capDiff(diff: string): GitDiff {
  if (diff.length <= MAX_DIFF) return { diff };
  const cut = diff.lastIndexOf("\n", MAX_DIFF);
  return { diff: diff.slice(0, cut > 0 ? cut : MAX_DIFF), truncated: true };
}

/** Stage the given repo-relative paths and commit just those. */
export function gitCommit(paths: string[], message: string): Promise<{ ok: boolean; error?: string; committed?: number }> {
  return serial(() => commitNow(paths, message));
}

async function commitNow(paths: string[], message: string): Promise<{ ok: boolean; error?: string; committed?: number }> {
  const { repo, error } = await openRepo();
  if (!repo) return { ok: false, error };
  const { repoRoot } = repo;
  const text = message.trim();
  if (!text) return { ok: false, error: "commit message required" };
  if (paths.length === 0) return { ok: false, error: "no files selected" };

  // Re-check the selection server-side. Matching the posted string against
  // the scope is not enough: `git add -- knowledge` is a directory pathspec
  // that would stage everything beneath it, denied files included. So every
  // path must be one the current status already reports as syncable.
  // Uncached: the status cache is fine for a badge, but a path that just
  // stopped being syncable must not slip through on a stale read. A status
  // error (detached HEAD, a root covering the whole repo) blocks the commit
  // rather than producing one no branch points at.
  const current = await gitStatus(true);
  if (current.error) return { ok: false, error: current.error };
  const allowed = new Map((current.files ?? []).filter((f) => f.syncable).map((f) => [f.path, f]));
  for (const p of paths) {
    if (!allowed.has(p)) {
      return { ok: false, error: `${p} is not a syncable change (directories and out-of-scope paths are refused)` };
    }
  }

  const specs = paths.map(literal);
  // Only untracked paths are staged. `git commit -- <paths>` commits the
  // worktree content of a tracked path without going through the index at
  // all, so a partially staged file (code "MM") keeps whatever the user had
  // staged when the commit is rejected by a pre-commit hook or a signing
  // failure. Untracked files have no index entry for a pathspec to match, so
  // they must be added first — and they are the only thing rolled back.
  const ours = paths.filter((p) => allowed.get(p)?.code === "??");
  if (ours.length) {
    const add = await git(["add", "--", ...ours.map(literal)], repoRoot);
    if (!add.ok) {
      touched();
      return { ok: false, error: add.stderr || "git add failed" };
    }
  }
  const commit = await git(["commit", "-m", text, "--", ...specs], repoRoot);
  if (!commit.ok) {
    let error = commit.stderr || commit.stdout.trim() || "git commit failed";
    if (ours.length) {
      const specs2 = ours.map(literal);
      // `reset HEAD` has no HEAD to reset to in a repo without commits yet;
      // there, dropping the index entry is the same rollback.
      let reset = await git(["reset", "-q", "HEAD", "--", ...specs2], repoRoot);
      if (!reset.ok) reset = await git(["rm", "-q", "--cached", "--", ...specs2], repoRoot);
      if (!reset.ok) error += ` (${ours.length} path(s) left staged)`;
    }
    touched();
    return { ok: false, error };
  }
  touched();
  return { ok: true, committed: paths.length };
}

export function gitFetch(): Promise<{ ok: boolean; error?: string }> {
  return serial(fetchNow);
}

async function fetchNow(): Promise<{ ok: boolean; error?: string }> {
  const { repo, error } = await openRepo();
  if (!repo) return { ok: false, error };
  const r = await gitNet(["fetch", repo.cfg.remote], repo.repoRoot);
  touched();
  // Only a fetch that worked counts. Stamping the time on a failure would
  // put "fetched 5s ago" next to ahead/behind counts that stopped moving
  // hours ago, which is the one thing this line exists to rule out.
  if (!r.ok) {
    lastError = r.stderr || "fetch failed";
    return { ok: false, error: lastError };
  }
  lastFetch = new Date().toISOString();
  lastError = undefined;
  return { ok: true };
}

/** Fast-forward only. A diverged branch is the user's problem, not ours. */
export function gitPull(): Promise<{ ok: boolean; error?: string }> {
  return serial(pullNow);
}

async function pullNow(): Promise<{ ok: boolean; error?: string }> {
  const { repo, error } = await openRepo();
  if (!repo) return { ok: false, error };
  const { repoRoot, cfg } = repo;
  const head = await checkedOut(repo);
  if (head.error || !head.branch) return { ok: false, error: head.error };

  const upstream = (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repoRoot)).ok;
  const r = upstream
    ? await gitNet(["pull", "--ff-only"], repoRoot)
    : await gitNet(["pull", "--ff-only", cfg.remote, head.branch], repoRoot);
  touched();
  if (!r.ok) {
    // git's own non-fast-forward output is a wall of hints. Say the one
    // thing that matters and leave the resolution to a terminal.
    const notFf = /non-fast-forward|diverg|cannot be fast-forwarded/i.test(r.stderr);
    lastError = notFf
      ? "The branch has diverged from its upstream. Merge or rebase it in a terminal."
      : r.stderr || "pull failed";
    return { ok: false, error: lastError };
  }
  lastPull = new Date().toISOString();
  lastError = undefined;
  return { ok: true };
}

export function gitPush(): Promise<{ ok: boolean; error?: string }> {
  return serial(pushNow);
}

async function pushNow(): Promise<{ ok: boolean; error?: string }> {
  const { repo, error } = await openRepo();
  if (!repo) return { ok: false, error };
  const { repoRoot, cfg } = repo;
  const head = await checkedOut(repo);
  if (head.error || !head.branch) return { ok: false, error: head.error };

  const upstream = (await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repoRoot)).ok;
  const r = upstream
    ? await gitNet(["push"], repoRoot)
    : await gitNet(["push", "--set-upstream", cfg.remote, `HEAD:${head.branch}`], repoRoot);
  touched();
  if (!r.ok) {
    lastError = r.stderr || "push failed";
    return { ok: false, error: lastError };
  }
  lastError = undefined;
  return { ok: true };
}

/* ---------- background sync ---------- */

/**
 * How often the timer re-reads kraftwerk.yml while the feature is off or its
 * interval is 0, and the longest it waits between reads while it is on, so
 * an edit to the git block takes effect within a minute instead of at the
 * next restart.
 */
const RECHECK_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;
let lastRun = 0;

/**
 * Fetch on an interval, and fast-forward when `autosync: pull` is set. Never
 * commits. A pull is skipped while the tree is dirty, so nobody's unsaved
 * work is disturbed by a background merge. Ticks are chained, not scheduled
 * on a fixed interval: a fetch against a slow remote must finish (or time
 * out) before the next one starts, or a short interval piles up processes.
 */
export function startGitSync(): void {
  if (timer || ticking) return;
  schedule(0);
}

function schedule(ms: number): void {
  timer = setTimeout(() => void tick(), ms);
  timer.unref?.();
}

async function tick(): Promise<void> {
  timer = null;
  ticking = true;
  let next = RECHECK_MS;
  try {
    const { repo } = await openRepo();
    if (repo && repo.cfg.interval > 0) {
      const every = repo.cfg.interval * 1000;
      if (Date.now() - lastRun >= every - 500) {
        lastRun = Date.now();
        await sync(repo);
      }
      next = Math.min(RECHECK_MS, Math.max(1_000, lastRun + every - Date.now()));
    }
  } catch {
    // A failed tick is retried at the next one; the status carries lastError.
  } finally {
    ticking = false;
    schedule(next);
  }
}

async function sync(repo: Repo): Promise<void> {
  const fetched = await gitFetch();
  if (!fetched.ok || repo.cfg.autosync !== "pull") return;
  const st = await gitStatus();
  if (st.error || !st.behind || st.diverged || !st.repoRoot) return;
  // A local modification can make --ff-only refuse, and a failed pull
  // every interval would park a permanent error in the UI. Untracked
  // files do not count: they only collide when an incoming commit adds
  // the same path, and that shows up as one pull error, not silence.
  if (await hasLocalChanges(st.repoRoot)) return;
  await gitPull();
}
