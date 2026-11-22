import { spawn } from "node:child_process";
import { createWriteStream, existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { boardsRootFor, presentationsRootFor, ENTITY_KINDS, entitiesRootFor, projectsRootFor, reposRootFor, resolveWorkspace, vibeablesRootFor, type ResolvedWorkspace, isSafeGitName } from "../config.js";
import { ENV_FILE } from "../runner/docker.js";
import { getOutputDir, workspaceRoot } from "./context.js";
import { perWorkspace, workspaceOpen } from "./workspace.js";
import { workspaceEnv } from "./env.js";
import { readIdentity } from "./identity.js";

/**
 * Workspace git sync. Several people run kraftwerk against one git repo, so
 * knowledge, agents, skills, channels and workflows travel between them like
 * any other tracked file. The inspector shows what changed, lets a human pick files and
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
 * - Commits are manual. The background timer only fetches, and pulls
 *   fast-forward when `autosync` is `pull` or `push`, the configured branch
 *   is the one checked out, and no tracked file is modified.
 * - Push is a click, unless `autosync: push` opts in: then the timer also
 *   pushes commits that already exist to a branch that already tracks its
 *   upstream. It never creates a commit, never publishes a new branch and
 *   never forces.
 * - A diverged branch is reported, never merged or rebased from here —
 *   except with `autosync: sync` (kraftwerk sync's default): there the timer
 *   also commits what changed under the synced roots, and a diverged branch
 *   is merged with the rule "the cloud wins": where both sides changed a
 *   file, the remote's version stays and this machine's lands beside it as
 *   `name.konflikt-<handle>.ext`, committed too, so nothing is lost and
 *   nobody has to resolve anything in a terminal (see syncNow).
 *
 * Every git call passes an argument array, so nothing reaches a shell, and
 * every call is async with a timeout: git runs inside the single-threaded
 * inspector, so a network operation must never block the event loop, and a
 * remote asking for credentials must fail instead of waiting forever on a
 * terminal nobody is watching.
 */

/** Files that must never be staged, whatever the scope says. */
/** Paths whose content is never shown or synced, whichever repo they sit in. */
export const DENY = [
  /(^|\/)\.env($|\.)/,
  /(^|\/)\.envrc$/,
  new RegExp(`(^|/)${ENV_FILE.replace(/\./g, "\\.")}$`),
  /\.(pem|key|p12|pfx)$/,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)/,
  /(^|\/)\.(netrc|npmrc|pypirc)$/,
  /(^|\/)credentials\.json$/,
];

const DEFAULTS = { remote: "origin", interval: 300, autosync: "pull" as const };

/** off = fetch only. pull = also fast-forward. push = fast-forward, then push what is ahead. */
export type Autosync = "off" | "pull" | "push" | "sync";

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
  /** Where the remote lives (`git remote get-url`), any credentials in it cut out; absent without a remote. */
  remoteUrl?: string;
  /**
   * Who hosts the remote: "kraftwerk" (kraftwerk sync, the workspace's repo in
   * kraftwerk cloud), "custom" (an own git provider — expert mode) or "none"
   * (no remote yet). Set by the API, which knows the cloud.
   */
  hosting?: "kraftwerk" | "custom" | "none";
  ahead?: number;
  behind?: number;
  /** True when the branches have diverged, which needs a terminal. */
  diverged?: boolean;
  files?: GitFile[];
  /** Blocked entries left out of `files` because the list was capped. */
  blockedHidden?: number;
  /** Repo-relative roots that may be committed. */
  scope?: string[];
  autosync?: Autosync;
  interval?: number;
  lastFetch?: string;
  lastPull?: string;
  /** The last push that worked, by hand or in the background. */
  lastPush?: string;
  lastError?: string;
  /** The last commit `autosync: sync` made by itself. */
  lastAutoCommit?: string;
  /**
   * Copies `autosync: sync` kept beside the remote's version (on this machine
   * or any other), read from the files themselves: they stay listed until
   * someone deletes the copy. Newest first.
   */
  conflicts?: SyncConflict[];
}

/** One file both sides changed: the remote's version is at `path`, the other side's at `copy`, kept for `by`. */
export interface SyncConflict {
  path: string;
  copy: string;
  by: string;
  at: string;
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
  autosync: Autosync;
}

/** Everything a git operation needs, resolved once per request. */
interface Repo {
  cfg: ResolvedGit;
  project: ResolvedWorkspace;
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
  ...workspaceEnv(),
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
  return git(args, repoRoot, NET_TIMEOUT, { GIT_SSH_COMMAND: await sshCommandFor(repoRoot), ...remoteAuthEnv() });
}

/**
 * HTTP credentials git gets for some remotes, by URL prefix → header. The
 * daemon sets one for kraftwerk sync (`<cloud>/git/` → the machine's key, see
 * server/cloud.ts), so a workspace syncs with its cloud repo without a token
 * in a remote URL or a credential helper. They go in through the
 * environment as URL-scoped `http.<prefix>.extraHeader` — never written to a
 * git config, and git sends them to that prefix only.
 */
let remoteAuth: () => Record<string, string> = () => ({});
export function setRemoteAuth(fn: () => Record<string, string>): void {
  remoteAuth = fn;
}
export function remoteAuthEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const headers = Object.entries(remoteAuth());
  if (headers.length === 0) return {};
  const start = Number(base.GIT_CONFIG_COUNT ?? 0) || 0;
  const env: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: String(start + headers.length) };
  headers.forEach(([prefix, header], i) => {
    env[`GIT_CONFIG_KEY_${start + i}`] = `http.${prefix}.extraHeader`;
    env[`GIT_CONFIG_VALUE_${start + i}`] = header;
  });
  return env;
}

/**
 * Remote/branch names from kraftwerk.yml become git positionals. Config
 * load and the settings API already refuse dash-led names, but the file is
 * shared through the workspace repo itself, so the call site checks again
 * and separates options from positionals.
 */
function netArgs(cmd: string[], ...names: string[]): string[] {
  for (const n of names) {
    if (!isSafeGitName(n)) throw new Error(`refusing git name "${n}" (looks like an option)`);
  }
  return [...cmd, "--end-of-options", ...names];
}

/**
 * Pathspecs are globs by default, so a file called `note[1].md` would not
 * match itself. `:(literal)` turns the pattern off.
 */
export const literal = (p: string): string => `:(literal)${p}`;

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
  let project: ResolvedWorkspace;
  try {
    project = await resolveWorkspace(workspaceRoot());
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

/** The workspace's remote URL (its git block's remote), credentials cut out; undefined without git, a repo or that remote. */
export async function gitRemoteUrl(): Promise<string | undefined> {
  const { repo } = await openRepo();
  if (!repo) return undefined;
  const r = await git(["remote", "get-url", repo.cfg.remote], repo.repoRoot);
  return r.ok && r.stdout.trim() ? withoutCredentials(r.stdout.trim()) : undefined;
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
 * knowledge, agents, skills, channels, vibeables, projects and files roots this project
 * declares, plus kraftwerk.yml and the project README. The output directory
 * is excluded even when it lives inside one of them.
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
    // Channels have no configurable root: channels/ under the project.
    path.resolve(project.root, "channels"),
    // Vibeables are the workspace's own apps: versioned with it, unlike clones.
    vibeablesRootFor(project),
    // Projects too: briefs, state and logs are the workspace's own record.
    projectsRootFor(project),
    // Contacts, places and events: who, where and when — the workspace's records.
    ...ENTITY_KINDS.map((kind) => entitiesRootFor(project, kind)),
    // Workspace boards: tasks, logs and their files (project boards sit inside the projects root).
    boardsRootFor(project),
    // Workspace presentations: decks, their assets and templates (project decks sit inside the projects root).
    presentationsRootFor(project),
    // Workspace files: shared material, versioned (files over 25 MB ignore themselves, see files.ts).
    path.resolve(project.root, "kraftwerk-data/files"),
    project.configPath,
    path.resolve(project.root, "README.md"),
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
export function label(code: string): string {
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
export function parseStatus(out: string): { path: string; code: string }[] {
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

/**
 * The workspace's sync state: the status cache, the queue of repo-mutating
 * commands, the last fetch/pull/error, and the background timer.
 */
const gitState = perWorkspace(() => ({
  statusCache: null as { at: number; value: GitStatus } | null,
  /** Bumped by touched(); a status computed under an older value is stale. */
  generation: 0,
  chain: Promise.resolve() as Promise<unknown>,
  lastFetch: undefined as string | undefined,
  lastPull: undefined as string | undefined,
  lastPush: undefined as string | undefined,
  lastError: undefined as string | undefined,
  lastAutoCommit: undefined as string | undefined,
  timer: null as ReturnType<typeof setTimeout> | null,
  ticking: false,
  lastRun: 0,
  /** A commit asked for a sync while a tick was in flight: run one more right after it. */
  again: false,
  /** Set when the workspace closes: a tick in flight does not schedule the next one. */
  stopped: false,
}));

/** Invalidate the status cache after anything that changes the repo. */
const touched = (): void => {
  gitState().statusCache = null;
  gitState().generation++;
};

/**
 * One repo-mutating git command at a time. The background sync and the
 * request handlers share the repo: a `pull --ff-only` still holding
 * .git/index.lock when a commit arrives makes the commit fail with "index.lock:
 * File exists", and the rollback after it hits the same lock. So commit,
 * fetch, pull and push queue behind each other. Status stays outside the
 * queue (GIT_OPTIONAL_LOCKS=0 keeps it lock-free).
 */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = gitState().chain.then(fn, fn);
  gitState().chain = run.catch(() => {});
  return run;
}


/**
 * Everything the git screen renders. Each call shells out to git a handful
 * of times, and the nav badge polls it from every open tab, so results are
 * cached for a beat.
 */
/** A remote URL fit to show: `https://user:secret@host/x` → `https://host/x`. */
export function withoutCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}

export async function gitStatus(fresh = false): Promise<GitStatus> {
  const cached = gitState().statusCache;
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const gen = gitState().generation;
  const opened = await openRepo();
  if (opened.off) return { enabled: false };
  const { repo, cfg } = opened;
  if (!repo) return { enabled: true, error: opened.error, autosync: cfg?.autosync, interval: cfg?.interval };
  const { repoRoot } = repo;

  const [head, upstreamRes, status, urlRes] = await Promise.all([
    checkedOut(repo),
    git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repoRoot),
    git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], repoRoot),
    git(["remote", "get-url", repo.cfg.remote], repoRoot),
  ]);
  const upstream = upstreamRes.ok ? upstreamRes.stdout.trim() : undefined;
  const remoteUrl = urlRes.ok && urlRes.stdout.trim() ? withoutCredentials(urlRes.stdout.trim()) : undefined;

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
    remoteUrl,
    ahead,
    behind,
    diverged: !!ahead && !!behind,
    autosync: repo.cfg.autosync,
    interval: repo.cfg.interval,
    lastFetch: gitState().lastFetch,
    lastPull: gitState().lastPull,
    lastPush: gitState().lastPush,
    lastError: gitState().lastError,
    ...(gitState().lastAutoCommit ? { lastAutoCommit: gitState().lastAutoCommit } : {}),
  };

  // A failed status (a stale index.lock, a timeout on a huge untracked tree)
  // must not read as "workspace clean": with no file list the commit endpoint
  // refuses everything, and the message should say why.
  if (!status.ok) {
    const value = { ...base, error: `git status failed: ${status.stderr || "unknown error"}` };
    if (gen === gitState().generation) gitState().statusCache = { at: Date.now(), value };
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
    ? "A configured root points at the repository root, which would put the whole repo in scope. Narrow workflows/knowledge/agents/skills/vibeables/projects in kraftwerk.yml."
    : undefined;

  const conflicts = repo.cfg.autosync === "sync" ? await conflictCopies(repoRoot) : [];
  const value: GitStatus = {
    ...base,
    error: head.error ?? scopeError,
    files: [...syncable, ...blocked.slice(0, MAX_BLOCKED)],
    blockedHidden: blockedHidden || undefined,
    scope: scope.include,
    ...(conflicts.length ? { conflicts } : {}),
  };
  // A commit that finished while this status was running already emptied
  // the cache; caching the pre-commit list on top of that would show the
  // committed file as dirty for another CACHE_MS.
  if (gen === gitState().generation) gitState().statusCache = { at: Date.now(), value };
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
  return diffAgainstHead(st.repoRoot, file, entry.code);
}

/**
 * Unified diff of one path in a repo against HEAD, capped. The caller has
 * checked that the path is a listed, showable change. A repo without
 * commits yet has nothing for `diff HEAD` to compare with; there, as for an
 * untracked file, the whole file is the change. Shared by the workspace
 * diff and the repositories screen so the two never drift.
 */
export async function diffAgainstHead(repoRoot: string, file: string, code: string): Promise<GitDiff> {
  const hasHead = (await git(["rev-parse", "--verify", "-q", "HEAD"], repoRoot)).ok;
  if (code === "??" || !hasHead) {
    // --no-index exits 1 when the files differ, which is the normal case here.
    const r = await git(["diff", "--no-index", "--", "/dev/null", file], repoRoot);
    return r.stdout ? capDiff(r.stdout) : { diff: "", error: r.stderr || "no diff available" };
  }
  const r = await git(["diff", "HEAD", "--", literal(file)], repoRoot);
  return r.ok ? capDiff(r.stdout) : { diff: "", error: r.stderr || "diff failed" };
}

export function capDiff(diff: string): GitDiff {
  if (diff.length <= MAX_DIFF) return { diff };
  const cut = diff.lastIndexOf("\n", MAX_DIFF);
  return { diff: diff.slice(0, cut > 0 ? cut : MAX_DIFF), truncated: true };
}

/** Stage the given repo-relative paths and commit just those. */
export function gitCommit(paths: string[], message: string): Promise<{ ok: boolean; error?: string; committed?: number }> {
  return serial(() => commitNow(paths, message));
}

/**
 * Who a commit is by. A commit by hand is git's own user (its config); one
 * that kraftwerk makes by itself (`autosync: sync`) is by the account this
 * machine is linked to, when the daemon knows one (setSyncAuthor) — else
 * git's user. With no git user configured at all, the machine's identity
 * stands in, so a commit never fails on "Please tell me who you are".
 */
let syncAuthor: () => { name: string; email: string } | null = () => null;
export function setSyncAuthor(fn: () => { name: string; email: string } | null): void {
  syncAuthor = fn;
}
async function authorEnv(repoRoot: string, who: "git" | "sync"): Promise<NodeJS.ProcessEnv> {
  const pick = who === "sync" ? syncAuthor() : null;
  if (pick) return { GIT_AUTHOR_NAME: pick.name, GIT_AUTHOR_EMAIL: pick.email, GIT_COMMITTER_NAME: pick.name, GIT_COMMITTER_EMAIL: pick.email };
  if ((await git(["config", "user.email"], repoRoot)).stdout.trim()) return {};
  const id = await readIdentity().catch(() => null);
  const name = id?.handle || "kraftwerk";
  const email = `${name}@${(id?.machine || "kraftwerk").replace(/[^A-Za-z0-9.-]+/g, "-")}.kraftwerk`;
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}

async function commitNow(paths: string[], message: string, author: "git" | "sync" = "git"): Promise<{ ok: boolean; error?: string; committed?: number }> {
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
  const commit = await git(["commit", "-m", text, "--", ...specs], repoRoot, LOCAL_TIMEOUT, await authorEnv(repoRoot, author));
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
  // With `autosync: push` or `sync` a commit should not sit here until the next interval.
  if (author === "git" && (repo.cfg.autosync === "push" || repo.cfg.autosync === "sync")) syncSoon();
  return { ok: true, committed: paths.length };
}

export function gitFetch(): Promise<{ ok: boolean; error?: string }> {
  return serial(fetchNow);
}

async function fetchNow(): Promise<{ ok: boolean; error?: string }> {
  const { repo, error } = await openRepo();
  if (!repo) return { ok: false, error };
  const r = await gitNet(netArgs(["fetch"], repo.cfg.remote), repo.repoRoot);
  touched();
  // Only a fetch that worked counts. Stamping the time on a failure would
  // put "fetched 5s ago" next to ahead/behind counts that stopped moving
  // hours ago, which is the one thing this line exists to rule out.
  if (!r.ok) {
    gitState().lastError = r.stderr || "fetch failed";
    return { ok: false, error: gitState().lastError };
  }
  gitState().lastFetch = new Date().toISOString();
  gitState().lastError = undefined;
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
    : await gitNet(netArgs(["pull", "--ff-only"], cfg.remote, head.branch), repoRoot);
  touched();
  if (!r.ok) {
    // git's own non-fast-forward output is a wall of hints. Say the one
    // thing that matters and leave the resolution to a terminal.
    const notFf = /non-fast-forward|diverg|cannot be fast-forwarded/i.test(r.stderr);
    gitState().lastError = notFf
      ? "The branch has diverged from its upstream. Merge or rebase it in a terminal."
      : r.stderr || "pull failed";
    return { ok: false, error: gitState().lastError };
  }
  gitState().lastPull = new Date().toISOString();
  gitState().lastError = undefined;
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
    : await gitNet(netArgs(["push", "--set-upstream"], cfg.remote, `HEAD:${head.branch}`), repoRoot);
  touched();
  if (!r.ok) {
    gitState().lastError = r.stderr || "push failed";
    return { ok: false, error: gitState().lastError };
  }
  gitState().lastPush = new Date().toISOString();
  gitState().lastError = undefined;
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


/**
 * Fetch on an interval, fast-forward when `autosync` is `pull` or `push`,
 * and with `push` also push what is ahead. Never commits. A pull is skipped
 * while the tree is dirty, so nobody's unsaved work is disturbed by a
 * background merge. Ticks are chained, not scheduled
 * on a fixed interval: a fetch against a slow remote must finish (or time
 * out) before the next one starts, or a short interval piles up processes.
 */
export function startGitSync(): void {
  gitState().stopped = false;
  if (gitState().timer || gitState().ticking) return;
  schedule(0);
}

/** Stop the current workspace's background sync (the workspace closes). A tick in flight finishes, then stops. */
export function stopGitSync(): void {
  const s = gitState();
  s.stopped = true;
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
}

/**
 * Run the background sync now instead of at the next interval. Goes through
 * the timer, so it is a no-op while the timer is off (interval 0) or the
 * workspace's sync was never started, and it never overlaps a running tick.
 */
function syncSoon(): void {
  const s = gitState();
  if (s.stopped) return;
  s.lastRun = 0;
  if (s.ticking) {
    s.again = true;
    return;
  }
  if (!s.timer) return;
  clearTimeout(s.timer);
  schedule(0);
}

function schedule(ms: number): void {
  const timer = setTimeout(() => void tick(), ms);
  timer.unref?.();
  gitState().timer = timer;
}

async function tick(): Promise<void> {
  gitState().timer = null;
  gitState().ticking = true;
  let next = RECHECK_MS;
  try {
    const { repo } = await openRepo();
    if (repo && repo.cfg.interval > 0) {
      const every = repo.cfg.interval * 1000;
      if (Date.now() - gitState().lastRun >= every - 500) {
        gitState().lastRun = Date.now();
        await sync(repo);
      }
      next = Math.min(RECHECK_MS, Math.max(1_000, gitState().lastRun + every - Date.now()));
    }
  } catch {
    // A failed tick is retried at the next one; the status carries lastError.
  } finally {
    // The workspace may have closed while git ran: then its state is gone and nothing is scheduled.
    if (workspaceOpen()) {
      const s = gitState();
      s.ticking = false;
      if (s.again) next = 0;
      s.again = false;
      if (!s.stopped) schedule(next);
    }
  }
}

async function sync(repo: Repo): Promise<void> {
  if (repo.cfg.autosync === "sync") {
    await syncNow(repo);
    return;
  }
  const fetched = await gitFetch();
  if (!fetched.ok || repo.cfg.autosync === "off") return;
  let st = await gitStatus();
  if (st.error || st.diverged || !st.repoRoot) return;
  if (st.behind) {
    // A local modification can make --ff-only refuse, and a failed pull
    // every interval would park a permanent error in the UI. Untracked
    // files do not count: they only collide when an incoming commit adds
    // the same path, and that shows up as one pull error, not silence.
    if (await hasLocalChanges(st.repoRoot)) return;
    if (!(await gitPull()).ok) return;
    st = await gitStatus();
  }
  if (repo.cfg.autosync !== "push") return;
  // Only what would go through: a branch that already tracks its upstream
  // (the first push, which publishes the branch, stays a click), is ahead
  // of it and not behind. A diverged branch would be rejected every
  // interval; it is reported on the git screen instead.
  if (st.error || !st.upstream || !st.ahead || st.behind) return;
  await gitPush();
}

/* ---------- autosync: sync ---------- */

/** How many conflict copies the status lists. */
const MAX_CONFLICTS = 20;

const COPY_MARK = ".konflikt-";

/** `knowledge/a.konflikt-ben-2.md` → { path: knowledge/a.md, by: ben }, or null when it is not a copy. */
export function parseConflictCopy(copy: string): { path: string; by: string } | null {
  const slash = copy.lastIndexOf("/") + 1;
  const name = copy.slice(slash);
  const i = name.lastIndexOf(COPY_MARK);
  if (i <= 0) return null;
  const rest = name.slice(i + COPY_MARK.length);
  const dot = rest.indexOf(".");
  const tag = dot >= 0 ? rest.slice(0, dot) : rest;
  if (!/^[a-z0-9_-]+$/.test(tag)) return null;
  return { path: copy.slice(0, slash) + name.slice(0, i) + (dot >= 0 ? rest.slice(dot) : ""), by: tag.replace(/-\d+$/, "") };
}

/** The conflict copies in the work tree, newest first (their files' times). */
async function conflictCopies(repoRoot: string): Promise<SyncConflict[]> {
  const r = await git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", `*${COPY_MARK}*`], repoRoot);
  if (!r.ok) return [];
  const out: SyncConflict[] = [];
  for (const copy of r.stdout.split("\0").filter(Boolean)) {
    const parsed = parseConflictCopy(copy);
    if (!parsed) continue;
    let at = "";
    try {
      at = statSync(path.join(repoRoot, copy)).mtime.toISOString();
    } catch {
      continue; // deleted, not committed yet
    }
    out.push({ path: parsed.path, copy, by: parsed.by, at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_CONFLICTS);
}

/** `notes/preise.md` → `notes/preise.konflikt-anna.md`, numbered while taken. */
export function conflictPath(file: string, handle: string, taken: (p: string) => boolean): string {
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  const name = file.slice(dir.length);
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  const tag = (handle || "lokal").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "lokal";
  for (let n = 1; ; n++) {
    const p = `${dir}${stem}.konflikt-${tag}${n > 1 ? `-${n}` : ""}${ext}`;
    if (!taken(p)) return p;
  }
}

/** A blob of `rev` written to a file in the work tree, bytes as they are. */
function blobToFile(repoRoot: string, rev: string, file: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("git", ["cat-file", "blob", rev], { cwd: repoRoot, env: gitEnv() });
    const out = createWriteStream(path.join(repoRoot, file));
    child.stdout.pipe(out);
    child.once("error", () => resolve(false));
    child.once("close", (code) => out.end(() => resolve(code === 0)));
  });
}

const lines = (r: GitResult): string[] => (r.ok ? r.stdout.split("\n").map((l) => l.trim()).filter(Boolean) : []);

/**
 * One round of kraftwerk sync: commit what changed under the synced roots,
 * fetch, take the remote's commits (fast-forward, or a merge where the
 * remote wins and our side of every file both changed is kept beside it),
 * push. Each step queues with the others (serial), so a click on the git
 * screen never meets a half-done round.
 */
async function syncNow(repo: Repo): Promise<void> {
  const st0 = await gitStatus(true);
  if (st0.error || !st0.repoRoot) return;
  const changed = (st0.files ?? []).filter((f) => f.syncable).map((f) => f.path);
  if (changed.length) {
    const id = await readIdentity().catch(() => null);
    const shown = changed.length <= 3 ? changed.join(", ") : `${changed.slice(0, 3).join(", ")} and ${changed.length - 3} more`;
    const msg = `kraftwerk sync: ${shown}${id ? ` (${id.handle}@${id.machine})` : ""}`;
    const c = await serial(() => commitNow(changed, msg, "sync"));
    if (c.ok) gitState().lastAutoCommit = new Date().toISOString();
    else gitState().lastError = c.error;
  }
  if (!(await gitFetch()).ok) return;
  const st = await gitStatus(true);
  if (st.error || !st.repoRoot) return;
  if (st.upstream && st.behind) {
    const merged = st.ahead ? await serial(() => mergeTheirs(repo, st.upstream!)) : await gitPull();
    if (!merged.ok) return;
  }
  const after = await gitStatus(true);
  if (after.error) return;
  if (!after.upstream || after.ahead) await gitPush();
}

/**
 * Merge the remote's branch, the remote winning: `-X theirs` settles the
 * hunks both sides touched, and what that cannot (one side deleted, the other
 * changed) takes the remote's side by hand. Then every file both sides
 * changed whose result is not our version gets our version beside it, as a
 * second commit. Only the remote's history is taken as it is; ours is kept
 * in full — in history, and in the copies.
 */
async function mergeTheirs(repo: Repo, upstream: string): Promise<{ ok: boolean; error?: string }> {
  const { repoRoot } = repo;
  const fail = (error: string) => {
    gitState().lastError = error;
    touched();
    return { ok: false, error };
  };
  const ours = (await git(["rev-parse", "HEAD"], repoRoot)).stdout.trim();
  const base = (await git(["merge-base", "HEAD", upstream], repoRoot)).stdout.trim();
  if (!ours || !base) return fail("kraftwerk sync: the local and remote histories share nothing — merge them in a terminal once");
  const mine = new Set(lines(await git(["diff", "--name-only", "--no-renames", base, ours], repoRoot)));
  const both = lines(await git(["diff", "--name-only", "--no-renames", base, upstream], repoRoot)).filter((p) => mine.has(p));
  const env = await authorEnv(repoRoot, "sync");
  const msg = "kraftwerk sync: the remote's changes taken in (where both changed a file, the remote's version wins)";
  const m = await git(["merge", "--no-edit", "--no-ff", "-X", "theirs", "-m", msg, upstream], repoRoot, NET_TIMEOUT, env);
  if (!m.ok) {
    const unmerged = lines(await git(["diff", "--name-only", "--diff-filter=U"], repoRoot));
    if (unmerged.length === 0) {
      await git(["merge", "--abort"], repoRoot);
      return fail(`kraftwerk sync could not merge: ${m.stderr || m.stdout.trim() || "unknown error"}`);
    }
    for (const p of unmerged) {
      const stages = lines(await git(["ls-files", "-u", "--", literal(p)], repoRoot)).map((l) => l.split(/\s+/)[2]);
      const r = stages.includes("3")
        ? await git(["checkout", "--theirs", "--", literal(p)], repoRoot).then(() => git(["add", "--", literal(p)], repoRoot))
        : await git(["rm", "-q", "--", literal(p)], repoRoot);
      if (!r.ok) {
        await git(["merge", "--abort"], repoRoot);
        return fail(`kraftwerk sync could not settle ${p}: ${r.stderr}`);
      }
    }
    const done = await git(["commit", "--no-edit", "-m", msg], repoRoot, LOCAL_TIMEOUT, env);
    if (!done.ok) {
      await git(["merge", "--abort"], repoRoot);
      return fail(`kraftwerk sync could not finish the merge: ${done.stderr || done.stdout.trim()}`);
    }
  }
  // Our side of each file both changed, where the result is not it — named after the account when the daemon knows it.
  const id = await readIdentity().catch(() => null);
  const who = syncAuthor()?.name || id?.handle || "";
  const kept: SyncConflict[] = [];
  const at = new Date().toISOString();
  for (const p of both) {
    const oursBlob = (await git(["rev-parse", "--verify", "-q", `${ours}:${p}`], repoRoot)).stdout.trim();
    if (!oursBlob) continue; // we deleted it: nothing of ours to keep
    const now = (await git(["rev-parse", "--verify", "-q", `HEAD:${p}`], repoRoot)).stdout.trim();
    if (now === oursBlob) continue;
    const copy = conflictPath(p, who, (c) => existsSync(path.join(repoRoot, c)));
    if (!(await blobToFile(repoRoot, oursBlob, copy))) continue;
    if ((await git(["add", "--", literal(copy)], repoRoot)).ok) kept.push({ path: p, copy, by: who, at });
  }
  if (kept.length) {
    const c = await git(
      ["commit", "-m", `kraftwerk sync: kept ${who || "this machine"}'s version of ${kept.length} file${kept.length === 1 ? "" : "s"} beside the remote's`, "--", ...kept.map((k) => literal(k.copy))],
      repoRoot,
      LOCAL_TIMEOUT,
      env,
    );
    if (!c.ok) return fail(`kraftwerk sync kept copies but could not commit them: ${c.stderr || c.stdout.trim()}`);
  }
  gitState().lastPull = at;
  gitState().lastError = undefined;
  touched();
  return { ok: true };
}
