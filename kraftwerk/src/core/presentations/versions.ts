import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDeck, type DeckDoc } from "./deck.js";

/**
 * Earlier versions of a deck, like a document's version history: copies
 * of deck.md in the deck's `.history/` folder, taken before a save
 * replaces it (the editor's saves at most once a minute — it saves while
 * you type) and whenever deck.md changed on disk (an agent, the CLI,
 * another tool). The newest KEEP stay. Works whether or not the
 * workspace commits to git.
 */

export const HISTORY_DIR = ".history";
export const KEEP = 50;
const THROTTLE_MS = 60_000;
const ID_RE = /^\d{8}T\d{6}(\d{3})?Z(-\d+)?$/;

export interface DeckVersion {
  id: string;
  at: string;
  title: string;
  slides: number;
}

const idOf = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1Z");
const atOf = (id: string): string => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z/.exec(id);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7] ?? "000"}Z` : id;
};

async function ids(dir: string): Promise<string[]> {
  const files = await fs.readdir(path.join(dir, HISTORY_DIR)).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(".md") && ID_RE.test(f.slice(0, -3))).map((f) => f.slice(0, -3)).sort().reverse();
}

/**
 * Keep `raw` (the deck as it was) as a version. Skipped when it equals the
 * newest version, and — unless `force` — when the newest is under a minute
 * old (a burst of saves while typing is one version).
 */
export async function snapshot(dir: string, raw: string, force = false): Promise<void> {
  if (!raw.trim()) return;
  const have = await ids(dir);
  const newest = have[0];
  if (newest) {
    const last = await fs.readFile(path.join(dir, HISTORY_DIR, `${newest}.md`), "utf8").catch(() => null);
    if (last === raw) return;
    if (!force && Date.now() - Date.parse(atOf(newest)) < THROTTLE_MS) return;
  }
  await fs.mkdir(path.join(dir, HISTORY_DIR), { recursive: true });
  let id = idOf(new Date());
  for (let n = 2; have.includes(id); n++) id = `${idOf(new Date())}-${n}`;
  await fs.writeFile(path.join(dir, HISTORY_DIR, `${id}.md`), raw);
  for (const old of [id, ...have].slice(KEEP)) await fs.rm(path.join(dir, HISTORY_DIR, `${old}.md`), { force: true });
}

export async function listVersions(dir: string): Promise<DeckVersion[]> {
  const out: DeckVersion[] = [];
  for (const id of await ids(dir)) {
    const raw = await fs.readFile(path.join(dir, HISTORY_DIR, `${id}.md`), "utf8").catch(() => "");
    let title = "";
    let slides = 0;
    try {
      const d = parseDeck(raw);
      title = d.title;
      slides = d.slides.length;
    } catch {
      title = "(cannot be read)";
    }
    out.push({ id, at: atOf(id), title, slides });
  }
  return out;
}

export async function readVersion(dir: string, id: string): Promise<{ id: string; at: string; source: string; deck: DeckDoc }> {
  if (!ID_RE.test(id)) throw new Error(`no version "${id}"`);
  const source = await fs.readFile(path.join(dir, HISTORY_DIR, `${id}.md`), "utf8").catch(() => null);
  if (source === null) throw new Error(`no version "${id}"`);
  return { id, at: atOf(id), source, deck: parseDeck(source) };
}
