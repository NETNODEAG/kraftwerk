import fs from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { resolveWorkspace, usersMode } from "../config.js";
import { workspaceRoot } from "../core/context.js";
import { git, gitCommit, gitFetch, gitPush, gitStatus, repoRootFor, withoutCredentials, type GitStatus } from "../core/git.js";
import { ApiError } from "./api/router.js";
import { cloudStatus, syncUrl } from "./cloud.js";

/**
 * kraftwerk sync, set up in one go: the workspace's history goes to its own
 * repository in kraftwerk cloud (`<cloud>/git/<id>.git`), and the daemon
 * reaches it with the machine's key (server/cloud.ts → core/git.ts
 * setRemoteAuth) — no token in a URL, no credential helper.
 *
 *   1. needs the workspace in cloud mode on a claimed, connected machine (the
 *      git server lets a machine in by its account's role on the workspace)
 *   2. a git repository at the workspace's root (`git init -b main` when
 *      there is none; a workspace inside a bigger repository is expert mode
 *      and left alone)
 *   3. `git:` on in kraftwerk.yml, `autosync: push` when it was off, so what
 *      is committed goes up by itself
 *   4. the remote: added when there is none; one that already points at the
 *      workspace's cloud repo is fine; one of another provider (expert mode)
 *      is never replaced
 *   5. a first commit of the workspace's files when there is no history yet,
 *      then a push that sets the upstream
 *
 * Safe to run again: each step that is already done is skipped.
 */

export interface SyncSetup {
  ok: boolean;
  /** What was done, in order — for the UI's "done" line. */
  done: string[];
  error?: string;
  status: GitStatus;
}

const answer = async (done: string[], error?: string): Promise<SyncSetup> => ({
  ok: !error,
  done,
  ...(error ? { error } : {}),
  status: await gitStatus(true),
});

export async function setupSync(): Promise<SyncSetup> {
  const done: string[] = [];
  const ws = await resolveWorkspace(workspaceRoot());
  const st = cloudStatus();
  if (!ws.config.id || usersMode(ws.config) !== "cloud") {
    throw new ApiError(409, "kraftwerk sync is part of cloud mode — switch the workspace to cloud first (Settings → local or cloud)");
  }
  if (st.state !== "connected" || !st.account) {
    throw new ApiError(409, "this machine is not connected to kraftwerk cloud with an account yet — finish cloud mode first");
  }
  const url = syncUrl(ws.config.id)!;

  // 2. The repository.
  const root = await repoRootFor(ws.root);
  if (!root) {
    const r = await git(["init", "-q", "-b", "main"], ws.root);
    if (!r.ok) throw new ApiError(500, `git init failed: ${r.stderr}`);
    done.push("started a git repository");
  } else if (path.resolve(root) !== path.resolve(ws.root)) {
    throw new ApiError(409, `the workspace is inside the git repository at ${root} — that is expert mode; set its remote up there`);
  }

  // 3. git: on.
  const configPath = ws.configPath ?? path.join(ws.root, "kraftwerk.yml");
  const doc = parseDocument(ws.configPath ? await fs.readFile(configPath, "utf8") : "");
  const g = ws.config.git;
  if (!g || g.enabled === false) {
    doc.setIn(["git", "enabled"], true);
    if (!g?.autosync) doc.setIn(["git", "autosync"], "push");
    await fs.writeFile(configPath, doc.toString());
    done.push("turned git sync on (autosync: push)");
  }
  const remote = g?.remote ?? "origin";

  // 4. The remote.
  const current = await git(["remote", "get-url", remote], ws.root);
  if (!current.ok) {
    const r = await git(["remote", "add", "--", remote, url], ws.root);
    if (!r.ok) throw new ApiError(500, `git remote add failed: ${r.stderr}`);
    done.push(`added the remote ${remote} → ${url}`);
  } else if (withoutCredentials(current.stdout.trim()) !== url) {
    throw new ApiError(
      409,
      `${remote} already points at ${withoutCredentials(current.stdout.trim())} — your own git provider (expert mode). kraftwerk sync does not replace it; remove that remote first to use kraftwerk sync instead`,
    );
  }

  // 5. History, then up.
  const hasHead = (await git(["rev-parse", "--verify", "-q", "HEAD"], ws.root)).ok;
  if (!hasHead) {
    const files = ((await gitStatus(true)).files ?? []).filter((f) => f.syncable).map((f) => f.path);
    if (files.length === 0) return answer(done, "nothing to commit yet — the workspace has no files git sync takes");
    const c = await gitCommit(files, "kraftwerk sync: the workspace's first commit");
    if (!c.ok) return answer(done, c.error ?? "the first commit failed");
    done.push(`committed ${files.length} file${files.length === 1 ? "" : "s"}`);
  }
  const fetched = await gitFetch();
  if (!fetched.ok) return answer(done, fetched.error ?? "could not reach the cloud repository");
  const now = await gitStatus(true);
  if (now.upstream && !now.ahead) {
    done.push("kraftwerk sync is up to date");
    return answer(done);
  }
  const pushed = await gitPush();
  if (!pushed.ok) {
    return answer(
      done,
      /rejected|non-fast-forward|fetch first/.test(pushed.error ?? "")
        ? "the cloud repository already has other history — pull it in a terminal, then push"
        : (pushed.error ?? "push failed"),
    );
  }
  done.push("pushed to kraftwerk sync");
  return answer(done);
}
