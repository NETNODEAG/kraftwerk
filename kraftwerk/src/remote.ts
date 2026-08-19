import { spawnSync } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Remote workflow sources: run workflows straight from a git repository
 * without vendoring them ("kraftwerk run --from github:org/repo tagline ...").
 *
 * Spec forms:
 *   github:org/repo          shorthand for https://github.com/org/repo.git
 *   github:org/repo@ref      branch, tag, or commit
 *   https://.../repo.git     any https git remote (also with @ref)
 *   git@host:org/repo.git    any ssh git remote (also with @ref)
 *
 * Clones land shallow in ~/.cache/kraftwerk/remotes/<slug>; an existing
 * clone is refreshed with fetch + reset. Offline with an existing clone
 * degrades to a warning and uses the cached state.
 */

export interface RemoteSource {
  /** Absolute directory of the (refreshed) clone — the project root to discover in. */
  dir: string;
  url: string;
  ref?: string;
}

export function isRemoteSpec(spec: string): boolean {
  return /^github:|^https:\/\/|^git@/.test(spec);
}

function parseSpec(spec: string): { url: string; ref?: string } {
  // @ref suffix: split on the last @ that isn't part of git@host.
  let rest = spec;
  let ref: string | undefined;
  const at = rest.lastIndexOf("@");
  if (at > rest.indexOf(":") && at > 0) {
    ref = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  if (rest.startsWith("github:")) {
    const orgRepo = rest.slice("github:".length).replace(/\/+$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(orgRepo)) {
      throw new Error(`Invalid github: source "${spec}" — expected github:org/repo[@ref]`);
    }
    return { url: `https://github.com/${orgRepo}.git`, ref };
  }
  return { url: rest, ref };
}

const slugify = (s: string): string =>
  s.replace(/^https:\/\/|^git@|\.git$/g, "").replace(/[^A-Za-z0-9._-]+/g, "-");

function git(args: string[], cwd?: string): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stderr || r.stdout || "").trim() };
}

/** Clone or refresh the spec's repository; returns the local project dir. */
export async function resolveRemote(spec: string): Promise<RemoteSource> {
  const { url, ref } = parseSpec(spec);
  const cacheRoot = path.join(os.homedir(), ".cache", "kraftwerk", "remotes");
  const dir = path.join(cacheRoot, slugify(url) + (ref ? `-${slugify(ref)}` : ""));
  await mkdir(cacheRoot, { recursive: true });

  const cloned = (await stat(path.join(dir, ".git")).catch(() => null)) !== null;
  if (!cloned) {
    const args = ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), url, dir];
    const r = git(args);
    if (!r.ok) throw new Error(`git clone ${url} failed:\n${r.out}`);
  } else {
    const fetched = git(["fetch", "--depth", "1", "origin", ...(ref ? [ref] : [])], dir);
    if (fetched.ok) {
      const target = ref ? "FETCH_HEAD" : "origin/HEAD";
      const reset = git(["reset", "--hard", target], dir);
      if (!reset.ok) git(["reset", "--hard", "FETCH_HEAD"], dir);
    } else {
      console.error(`Warning: ${url} not reachable — using the cached state.`);
    }
  }
  return { dir, url, ref };
}
