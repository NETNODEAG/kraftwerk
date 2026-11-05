import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveWorkspace } from "../config.js";
import { workspaceRoot } from "./context.js";
import { perWorkspace } from "./workspace.js";

/**
 * The temp folder: where a session's scratch work goes — intermediate
 * results, downloads, build output, a markdown written for a CLI to read —
 * instead of the system's temp dir or, worse, the workspace's files.
 *
 *   kraftwerk-data/temp/<session-id>/   one folder per chat session
 *   <run dir>/temp/                     a workflow run's (inside its mount)
 *
 * Three things make it stick, so it does not depend on an agent reading a
 * sentence: the folder is handed to every spawned agent as TMPDIR (and
 * TMP, TEMP, KRAFTWERK_TEMP), so mktemp, Python's tempfile, Node's
 * os.tmpdir() and the agent's own scratchpad land there by themselves; it
 * sits inside the workspace, so writes there need no approval from the
 * harness; and the session prompt names it next to the files folders,
 * which say in turn that nothing temporary belongs in them.
 *
 * The temp root is local: a .gitignore of its own keeps everything in it
 * out of the workspace git (and `kraftwerk init` lists it too). Nothing in
 * it is a deliverable, so nothing goes to the trash: a chat's folder is
 * removed with the chat, and folders nobody touched for SWEEP_AFTER_MS are
 * swept when a session starts (at most once an hour) or on demand
 * (`kraftwerk temp clean`, DELETE /api/temp).
 */

export const TEMP_DIR = "kraftwerk-data/temp";
/** A folder idle this long is swept. */
export const SWEEP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
/** A session id as a folder name: what newChatId() produces, nothing that could leave the root. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export interface TempEntry {
  /** The folder name: the session's id. */
  id: string;
  /** Relative to the workspace root, forward slashes. */
  path: string;
  files: number;
  bytes: number;
  /** The newest change inside (the folder's own when empty). */
  modifiedAt: string;
}

export interface TempView {
  root: string;
  entries: TempEntry[];
  bytes: number;
}

async function resolvedRoot(): Promise<string> {
  const ws = await resolveWorkspace(workspaceRoot()).catch(() => null);
  return ws?.root ?? workspaceRoot();
}

/** Absolute temp root of the current workspace. */
export async function tempRoot(): Promise<string> {
  return path.join(await resolvedRoot(), TEMP_DIR);
}

/** Create the root and keep it out of the workspace git: a .gitignore of its own ignores everything in it, itself included. */
async function prepare(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, ".gitignore"), "*\n", { flag: "wx" }).catch(() => {});
}

/** The environment that points a process at `dir` for everything temporary. */
export function tempEnv(dir: string): Record<string, string> {
  return { KRAFTWERK_TEMP: dir, TMPDIR: dir, TMP: dir, TEMP: dir };
}

/** Create a folder outside the workspace's temp root (a workflow run's) and return the env for it. */
export async function tempEnvFor(dir: string): Promise<Record<string, string>> {
  await fs.mkdir(dir, { recursive: true });
  return tempEnv(dir);
}

const lastSweep = perWorkspace(() => ({ at: 0 }));

/**
 * A session's own folder, created: absolute path and the path relative to
 * the workspace root (for the prompt). Starting a session is also when
 * folders nobody uses any more are swept, at most once an hour.
 */
export async function sessionTemp(id: string): Promise<{ abs: string; rel: string; env: Record<string, string> }> {
  if (!ID_RE.test(id)) throw new Error("invalid session id");
  const root = await tempRoot();
  await prepare(root);
  const abs = path.join(root, id);
  await fs.mkdir(abs, { recursive: true });
  const sweep = lastSweep();
  if (Date.now() - sweep.at > SWEEP_EVERY_MS) {
    sweep.at = Date.now();
    void cleanTemp({ keep: [id] }).catch(() => {});
  }
  return { abs, rel: `${TEMP_DIR}/${id}`, env: tempEnv(abs) };
}

/** Remove one session's folder for good (nothing there is a deliverable). */
export async function removeSessionTemp(id: string): Promise<void> {
  if (!ID_RE.test(id)) return;
  await fs.rm(path.join(await tempRoot(), id), { recursive: true, force: true });
}

/** Files, bytes and the newest mtime below a folder. */
async function measure(dir: string): Promise<{ files: number; bytes: number; newest: number }> {
  const st = await fs.stat(dir);
  const out = { files: 0, bytes: 0, newest: st.mtimeMs };
  const walk = async (d: string): Promise<void> => {
    if (out.files > 20000) return;
    for (const k of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const abs = path.join(d, k.name);
      if (k.isDirectory()) await walk(abs);
      else if (k.isFile()) {
        const s = await fs.stat(abs).catch(() => null);
        if (!s) continue;
        out.files++;
        out.bytes += s.size;
        if (s.mtimeMs > out.newest) out.newest = s.mtimeMs;
      }
    }
  };
  await walk(dir);
  return out;
}

/** Every session folder in the temp root, newest first. */
export async function listTemp(): Promise<TempView> {
  const root = await tempRoot();
  const kids = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const entries: TempEntry[] = [];
  for (const k of kids) {
    if (!k.isDirectory() || k.name.startsWith(".")) continue;
    const m = await measure(path.join(root, k.name)).catch(() => null);
    if (!m) continue;
    entries.push({ id: k.name, path: `${TEMP_DIR}/${k.name}`, files: m.files, bytes: m.bytes, modifiedAt: new Date(m.newest).toISOString() });
  }
  entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return { root, entries, bytes: entries.reduce((n, e) => n + e.bytes, 0) };
}

/**
 * Remove session folders: all of them, or those idle longer than
 * `olderThanMs` (default SWEEP_AFTER_MS). `keep` names folders that stay
 * whatever their age (the session being started). Returns what went.
 */
export async function cleanTemp(opts: { all?: boolean; olderThanMs?: number; keep?: string[] } = {}): Promise<TempEntry[]> {
  const view = await listTemp();
  const cutoff = Date.now() - (opts.olderThanMs ?? SWEEP_AFTER_MS);
  const keep = new Set(opts.keep ?? []);
  const gone: TempEntry[] = [];
  for (const e of view.entries) {
    if (keep.has(e.id)) continue;
    if (!opts.all && Date.parse(e.modifiedAt) > cutoff) continue;
    await fs.rm(path.join(view.root, e.id), { recursive: true, force: true });
    gone.push(e);
  }
  return gone;
}

/** The "## Temporary files" block of a session's context. */
export function tempContext(rel: string): string {
  return (
    `## Temporary files\n` +
    `Your scratch folder is ${rel}/ — TMPDIR (and KRAFTWERK_TEMP) point there, so \`mktemp\`, Python's tempfile, ` +
    `os.tmpdir() and your own scratchpad land in it by themselves. Put everything that is not a result there: ` +
    `intermediate output, downloads, extracted archives, build output, one-off scripts, a markdown written for a CLI ` +
    `to read. It is private to this session, kept out of git, and removed when the session is deleted or after a week ` +
    `unused — never store anything there you or the user want to keep. The files folders named above hold only what ` +
    `the user keeps: what you produce for them, and the material they gave you. Never create temporary or ` +
    `intermediate files there, and never in the system's temp dir.`
  );
}
