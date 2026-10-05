import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { resolveProject } from "../config.js";
import { getProjectRoot } from "./context.js";
import { listProjects, openProjects, safeProjectSlug } from "./projects.js";
import { moveToTrash } from "./trash.js";

/**
 * Files: the material of the work, any format, as plain folders. Two
 * owners, by how long a file lives:
 *
 *   kraftwerk-data/files/                    workspace files: shared, outlive any project
 *   kraftwerk-data/projects/<slug>/files/    a project's files: briefing, drafts, deliverables
 *
 * Agents own none (they link folders; see agentFilesContext). Being plain
 * folders, agents read and write them like any directory, the workspace
 * git keeps their history, and a delete goes to the trash. Files over
 * LOCAL_OVER_BYTES stay out of git: listed in the root's own .gitignore,
 * shown as "local only". Knowledge is separate: a file becomes evidence in
 * a bundle's references/ through "learn from this" (later).
 */

export const WORKSPACE_FILES_DIR = "kraftwerk-data/files";
export const PROJECT_FILES_DIR = "files";
/** Bigger files stay local: kept out of the workspace git. */
export const LOCAL_OVER_BYTES = 25 * 1024 * 1024;
/** Upload cap: a guard against a runaway request, not a policy. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const IGNORE_HEAD = "# kraftwerk: files over 25 MB stay local (not in git)";

/** "workspace" or "project:<slug>". */
export type FilesScope = string;

export interface FileEntry {
  name: string;
  /** Path inside the scope's root, forward slashes. */
  path: string;
  type: "dir" | "file";
  size?: number;
  modifiedAt: string;
  /** dirs: files below it (recursive, capped). */
  count?: number;
  mime?: string;
  /** Over the size limit: kept out of git. */
  local?: boolean;
}

export interface FilesListing {
  scope: FilesScope;
  label: string;
  /** The folder, inside the root ("" = the root). */
  path: string;
  /** The root relative to the workspace, for the agent and the UI. */
  root: string;
  entries: FileEntry[];
}

export interface FilesScopeInfo {
  scope: FilesScope;
  label: string;
  root: string;
  count: number;
  status?: string;
}

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".xml": "text/xml; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

export const mimeOf = (name: string): string => MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";

/** The root folder of a scope, its display label, and the root relative to the workspace. */
export async function scopeRoot(scope: FilesScope): Promise<{ abs: string; rel: string; label: string; workspace: string }> {
  const project = await resolveProject(getProjectRoot());
  const workspace = project.root;
  if (scope === "workspace") {
    const abs = path.join(workspace, WORKSPACE_FILES_DIR);
    return { abs, rel: WORKSPACE_FILES_DIR, label: "Workspace", workspace };
  }
  const m = /^project:(.+)$/.exec(scope);
  if (!m) throw new Error(`invalid files scope "${scope}"`);
  const slug = safeProjectSlug(m[1]);
  const opened = await openProjects();
  if (!opened.root) throw new Error(opened.error ?? "projects are off");
  const dir = path.join(opened.root, slug);
  if (!(await fs.stat(path.join(dir, "project.yml")).catch(() => null))) throw new Error(`no project "${slug}"`);
  const abs = path.join(dir, PROJECT_FILES_DIR);
  const title = (await listProjects()).projects.find((p) => p.slug === slug)?.title ?? slug;
  return { abs, rel: path.relative(workspace, abs).split(path.sep).join("/"), label: title, workspace };
}

/** A path inside a root: no escaping it, no hidden segments (.gitignore and friends are kraftwerk's). */
function inside(root: string, rel: string): string {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (clean.split("/").some((s) => s === ".." || (s.startsWith(".") && s !== ""))) throw new Error("invalid path");
  const abs = path.resolve(root, clean);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("invalid path");
  return abs;
}

const toPosix = (p: string) => p.split(path.sep).join("/");

/** Number of files below a folder, stopping at `cap`. */
async function countFiles(dir: string, cap = 5000): Promise<number> {
  let n = 0;
  const walk = async (d: string): Promise<void> => {
    if (n >= cap) return;
    const kids = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const k of kids) {
      if (k.name.startsWith(".")) continue;
      if (k.isDirectory()) await walk(path.join(d, k.name));
      else if (k.isFile()) n++;
      if (n >= cap) return;
    }
  };
  await walk(dir);
  return n;
}

/* ---------- local-only (over the size limit) ---------- */

async function readIgnore(root: string): Promise<string[]> {
  const raw = await fs.readFile(path.join(root, ".gitignore"), "utf8").catch(() => "");
  return raw.split("\n").filter((l) => l.startsWith("/"));
}

/** Keep `rel` out of git (on) or let it back in (off), in the root's own .gitignore. */
async function markLocal(root: string, rel: string, on: boolean): Promise<void> {
  const line = `/${rel}`;
  const lines = await readIgnore(root);
  const has = lines.includes(line);
  if (on === has) return;
  const next = on ? [...lines, line] : lines.filter((l) => l !== line);
  const file = path.join(root, ".gitignore");
  if (next.length === 0) await fs.rm(file, { force: true });
  else await fs.writeFile(file, `${IGNORE_HEAD}\n${next.sort().join("\n")}\n`);
}

/* ---------- reading ---------- */

export async function listScopes(): Promise<FilesScopeInfo[]> {
  const ws = await scopeRoot("workspace");
  const out: FilesScopeInfo[] = [{ scope: "workspace", label: ws.label, root: ws.rel, count: await countFiles(ws.abs) }];
  const projects = await listProjects().catch(() => ({ projects: [] }));
  for (const p of projects.projects) {
    const r = await scopeRoot(`project:${p.slug}`).catch(() => null);
    if (!r) continue;
    out.push({ scope: `project:${p.slug}`, label: p.title, root: r.rel, count: await countFiles(r.abs), status: p.status });
  }
  return out;
}

export async function listFiles(scope: FilesScope, rel = ""): Promise<FilesListing> {
  const root = await scopeRoot(scope);
  const dir = inside(root.abs, rel);
  const st = await fs.stat(dir).catch(() => null);
  if (rel && !st?.isDirectory()) throw new Error(`no folder "${rel}"`);
  const local = new Set(await readIgnore(root.abs));
  const kids = st ? await fs.readdir(dir, { withFileTypes: true }) : [];
  const entries: FileEntry[] = [];
  for (const k of kids) {
    if (k.name.startsWith(".")) continue;
    const abs = path.join(dir, k.name);
    const s = await fs.stat(abs).catch(() => null);
    if (!s) continue;
    const p = toPosix(path.relative(root.abs, abs));
    if (s.isDirectory()) {
      entries.push({ name: k.name, path: p, type: "dir", modifiedAt: s.mtime.toISOString(), count: await countFiles(abs, 1000) });
    } else if (s.isFile()) {
      // A big file dropped in by hand (Finder, an agent) is kept out of git the moment it is seen.
      const big = s.size > LOCAL_OVER_BYTES;
      if (big && !local.has(`/${p}`)) await markLocal(root.abs, p, true);
      entries.push({ name: k.name, path: p, type: "file", size: s.size, modifiedAt: s.mtime.toISOString(), mime: mimeOf(k.name), ...(big ? { local: true } : {}) });
    }
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "dir" ? -1 : 1));
  return { scope, label: root.label, path: toPosix(path.relative(root.abs, dir)), root: root.rel, entries };
}

/** A file to stream to the browser. */
export async function openFile(scope: FilesScope, rel: string): Promise<{ stream: Readable; size: number; mime: string; name: string }> {
  const root = await scopeRoot(scope);
  const abs = inside(root.abs, rel);
  const st = await fs.stat(abs).catch(() => null);
  if (!st?.isFile()) throw new Error(`no file "${rel}"`);
  return { stream: createReadStream(abs), size: st.size, mime: mimeOf(abs), name: path.basename(abs) };
}

/* ---------- writing ---------- */

/** A name for an upload: no folders, no control characters, no leading dot. */
function cleanName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f/]/g, "").trim().replace(/^\.+/, "");
  if (!base) throw new Error("invalid file name");
  return base.slice(0, 200);
}

/** "report.pdf" taken -> "report (2).pdf". */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 2; await fs.stat(path.join(dir, candidate)).then(() => true, () => false); n++) candidate = `${stem} (${n})${ext}`;
  return candidate;
}

/** Stream an upload into a folder; a name already taken gets " (2)". */
export async function saveUpload(scope: FilesScope, dirRel: string, name: string, body: Readable): Promise<FileEntry> {
  const root = await scopeRoot(scope);
  const dir = inside(root.abs, dirRel);
  await fs.mkdir(dir, { recursive: true });
  const final = await freeName(dir, cleanName(name));
  const abs = path.join(dir, final);
  const tmp = path.join(dir, `.upload-${process.pid}-${Date.now()}`);
  let size = 0;
  body.on("data", (c: Buffer) => {
    size += c.length;
    if (size > MAX_UPLOAD_BYTES) body.destroy(new Error("file too large"));
  });
  try {
    await pipeline(body, createWriteStream(tmp));
    if (size === 0) throw new Error("empty file");
    await fs.rename(tmp, abs);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  const p = toPosix(path.relative(root.abs, abs));
  if (size > LOCAL_OVER_BYTES) await markLocal(root.abs, p, true);
  return { name: final, path: p, type: "file", size, modifiedAt: new Date().toISOString(), mime: mimeOf(final), ...(size > LOCAL_OVER_BYTES ? { local: true } : {}) };
}

export async function makeFolder(scope: FilesScope, rel: string): Promise<FileEntry> {
  const root = await scopeRoot(scope);
  const abs = inside(root.abs, rel);
  if (abs === root.abs) throw new Error("folder name is required");
  if (await fs.stat(abs).catch(() => null)) throw new Error(`"${path.basename(abs)}" already exists`);
  await fs.mkdir(abs, { recursive: true });
  return { name: path.basename(abs), path: toPosix(path.relative(root.abs, abs)), type: "dir", modifiedAt: new Date().toISOString(), count: 0 };
}

/** Rename or move inside the scope. Refused when the target exists. */
export async function moveFile(scope: FilesScope, fromRel: string, toRel: string): Promise<void> {
  const root = await scopeRoot(scope);
  const from = inside(root.abs, fromRel);
  const to = inside(root.abs, toRel);
  if (from === root.abs || to === root.abs) throw new Error("invalid path");
  const st = await fs.stat(from).catch(() => null);
  if (!st) throw new Error(`no file "${fromRel}"`);
  if (await fs.stat(to).catch(() => null)) throw new Error(`"${toRel}" already exists`);
  if (st.isDirectory() && (to + path.sep).startsWith(from + path.sep)) throw new Error("cannot move a folder into itself");
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  if (st.isFile() && st.size > LOCAL_OVER_BYTES) {
    await markLocal(root.abs, toPosix(path.relative(root.abs, from)), false);
    await markLocal(root.abs, toPosix(path.relative(root.abs, to)), true);
  }
}

/** Move a file or folder to the trash (trash/files/<workspace | projects/slug>/<path>). */
export async function deleteFile(scope: FilesScope, rel: string): Promise<void> {
  const root = await scopeRoot(scope);
  const abs = inside(root.abs, rel);
  if (abs === root.abs) throw new Error("invalid path");
  const st = await fs.stat(abs).catch(() => null);
  if (!st) throw new Error(`no file "${rel}"`);
  const p = toPosix(path.relative(root.abs, abs));
  const owner = scope === "workspace" ? "workspace" : `projects/${scope.slice("project:".length)}`;
  await moveToTrash("files", `${owner}/${p}`, abs);
  if (st.isFile() && st.size > LOCAL_OVER_BYTES) await markLocal(root.abs, p, false);
}

/* ---------- context for agents ---------- */

/** "files/ (23 files; recent: designs/home-v3.png 2026-10-05, …)" — where the files are, not every file. */
export async function filesSummary(scope: FilesScope, recent = 5): Promise<{ root: string; count: number; recent: { path: string; at: string }[] } | null> {
  const root = await scopeRoot(scope).catch(() => null);
  if (!root) return null;
  const all: { path: string; at: string }[] = [];
  const walk = async (d: string): Promise<void> => {
    if (all.length > 5000) return;
    for (const k of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (k.name.startsWith(".")) continue;
      const abs = path.join(d, k.name);
      if (k.isDirectory()) await walk(abs);
      else if (k.isFile()) {
        const s = await fs.stat(abs).catch(() => null);
        if (s) all.push({ path: toPosix(path.relative(root.abs, abs)), at: s.mtime.toISOString() });
      }
    }
  };
  await walk(root.abs);
  all.sort((a, b) => b.at.localeCompare(a.at));
  return { root: root.rel, count: all.length, recent: all.slice(0, recent) };
}

/** The "## Files" block of a session's context: the folder to use, what is in it lately. */
export async function filesContext(scope: FilesScope, heading: string, intro: string): Promise<string> {
  const s = await filesSummary(scope);
  if (!s) return "";
  const recent = s.recent.map((r) => `  - ${r.path} (${r.at.slice(0, 10)})`).join("\n");
  return (
    `## ${heading}\n${intro} ${s.root}/ — ${s.count} file${s.count === 1 ? "" : "s"}` +
    (recent ? `, most recently changed:\n${recent}\n` : " (empty so far)\n") +
    `Read and write them there like any folder; put what you produce for the user in ${s.root}/deliverables/. ` +
    `Files over 25 MB stay out of git automatically. Delete nothing there unless asked.`
  );
}
