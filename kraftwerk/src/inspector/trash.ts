import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveProject } from "../config.js";
import { getProjectRoot } from "./context.js";

/**
 * The trash: what the inspector or the CLI deletes is moved here first and
 * only gone for good once it is deleted from the trash. The trash mirrors
 * the workspace — trash/agents/<slug>, trash/knowledge/<bundle>,
 * trash/projects/<slug>, trash/chats/<id>, … — and every trashed folder
 * carries a small TRASH_FILE saying what it was and where it came from, so
 * it can be put back. The trash is local: it is kept out of the workspace git.
 */

export const TRASH_DIR = "kraftwerk-data/trash";
const TRASH_FILE = ".trashed.json";

/** What can be in the trash; also the folder under trash/ it lands in. */
export type TrashKind = "agents" | "agent-skills" | "projects" | "knowledge" | "vibeables" | "channels" | "repos" | "chats" | "runs" | "files";

export interface TrashEntry {
  /** Path inside the trash, forward slashes — the entry's handle. */
  id: string;
  kind: TrashKind;
  /** The name it had: slug, bundle name, chat id, … (agent skills: "<agent>/<skill>"). */
  name: string;
  /** Where it came from, relative to the workspace root. */
  from: string;
  trashedAt: string;
  /** A single file (not a folder): the entry is a folder holding it under this name. */
  file?: string;
}

async function workspaceRoot(): Promise<string> {
  const project = await resolveProject(getProjectRoot()).catch(() => null);
  return project?.root ?? getProjectRoot();
}

export async function trashRoot(): Promise<string> {
  return path.join(await workspaceRoot(), TRASH_DIR);
}

/** Create the trash and keep it out of the workspace git: a .gitignore of its own ignores everything in it, itself included. */
async function prepare(trash: string): Promise<void> {
  await fs.mkdir(trash, { recursive: true });
  await fs.writeFile(path.join(trash, ".gitignore"), "*\n", { flag: "wx" }).catch(() => {});
}

/** rename, or copy + remove when the two sit on different file systems (a repos root elsewhere). */
async function move(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.cp(from, to, { recursive: true, preserveTimestamps: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

/**
 * Move a folder into the trash under <kind>/<name>. A name already in the
 * trash (deleted before) gets a -2, -3, … suffix; the entry still knows its name.
 */
export async function moveToTrash(kind: TrashKind, name: string, dir: string): Promise<TrashEntry | null> {
  const st = await fs.stat(dir).catch(() => null);
  if (!st) return null;
  const root = await workspaceRoot();
  const trash = path.join(root, TRASH_DIR);
  await prepare(trash);
  const base = path.join(trash, kind, ...name.split("/"));
  let dest = base;
  for (let n = 2; await exists(dest); n++) dest = `${base}-${n}`;
  const entry: TrashEntry = {
    id: path.relative(trash, dest).split(path.sep).join("/"),
    kind,
    name,
    from: path.relative(root, dir).split(path.sep).join("/"),
    trashedAt: new Date().toISOString(),
    // A single file gets a folder of its own in the trash, so it can carry the marker too.
    ...(st.isDirectory() ? {} : { file: path.basename(dir) }),
  };
  await move(dir, entry.file ? path.join(dest, entry.file) : dest);
  await fs.writeFile(path.join(dest, TRASH_FILE), JSON.stringify({ kind, name, from: entry.from, trashedAt: entry.trashedAt, ...(entry.file ? { file: entry.file } : {}) }, null, 2));
  return entry;
}

/** Everything in the trash, newest first. Entries are found by their TRASH_FILE, at any depth. */
export async function listTrash(): Promise<TrashEntry[]> {
  const trash = await trashRoot();
  const out: TrashEntry[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    const raw = await fs.readFile(path.join(dir, TRASH_FILE), "utf8").catch(() => null);
    if (raw !== null) {
      try {
        const m = JSON.parse(raw) as Omit<TrashEntry, "id">;
        out.push({ id: path.relative(trash, dir).split(path.sep).join("/"), kind: m.kind, name: m.name, from: m.from, trashedAt: m.trashedAt, ...(m.file ? { file: m.file } : {}) });
      } catch {
        /* unreadable marker: leave it for a human */
      }
      return;
    }
    if (depth >= 8) return; // files mirror their folders: trash/files/projects/<slug>/a/b/c.pdf
    const kids = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const k of kids) if (k.isDirectory()) await walk(path.join(dir, k.name), depth + 1);
  };
  await walk(trash, 0);
  return out.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
}

async function resolveEntry(id: string): Promise<{ entry: TrashEntry; dir: string }> {
  const trash = await trashRoot();
  const dir = path.resolve(trash, id);
  if (!dir.startsWith(trash + path.sep)) throw new Error("invalid trash entry");
  const entry = (await listTrash()).find((e) => path.resolve(trash, e.id) === dir);
  if (!entry) throw new Error(`nothing in the trash at "${id}"`);
  return { entry, dir };
}

/** Put an entry back where it came from; refused while something else lives there now. */
export async function restoreFromTrash(id: string): Promise<TrashEntry> {
  const { entry, dir } = await resolveEntry(id);
  const target = path.resolve(await workspaceRoot(), entry.from);
  if (await exists(target)) throw new Error(`${entry.from} exists again — rename or remove it first`);
  await fs.rm(path.join(dir, TRASH_FILE), { force: true });
  if (entry.file) {
    await move(path.join(dir, entry.file), target);
    await fs.rm(dir, { recursive: true, force: true });
  } else await move(dir, target);
  await pruneEmpty(path.dirname(dir));
  return entry;
}

/** Delete an entry for good. A chat takes the agents' own transcripts with it. */
export async function purgeFromTrash(id: string): Promise<TrashEntry> {
  const { entry, dir } = await resolveEntry(id);
  if (entry.kind === "chats") {
    const { purgeChatTranscripts } = await import("./chat/sessions.js");
    await purgeChatTranscripts(dir).catch(() => {});
  }
  await fs.rm(dir, { recursive: true, force: true });
  await pruneEmpty(path.dirname(dir));
  return entry;
}

/** Delete everything in the trash for good; returns how many entries went. */
export async function emptyTrash(): Promise<number> {
  const entries = await listTrash();
  for (const e of entries) await purgeFromTrash(e.id);
  return entries.length;
}

/** Remove folders the trash no longer needs (trash/agent-skills/<agent> once its last skill is gone). */
async function pruneEmpty(dir: string): Promise<void> {
  const trash = await trashRoot();
  while (dir.startsWith(trash + path.sep)) {
    if ((await fs.readdir(dir).catch(() => ["?"])).length) return;
    await fs.rmdir(dir).catch(() => {});
    dir = path.dirname(dir);
  }
}
