import { readFileSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { snapshot } from "./versions.js";

/**
 * Who has a deck open, and where: each editor (a browser tab, an app)
 * reports its slide and selected box every few seconds; everyone else on
 * the deck sees it live, like the cursors in a shared document. Kept in
 * memory per deck folder — nothing is written, a silent editor drops out
 * after EXPIRE_MS.
 */

export interface Viewer {
  /** The editor's own id (one per tab), not a person: one person may have two tabs open. */
  client: string;
  who: string;
  /** 1-based slide in view, and the box selected there. */
  slide: number;
  slot?: string;
  at: number;
}

export const EXPIRE_MS = 20_000;

const decks = new Map<string, Map<string, Viewer>>();
const listeners = new Map<string, Set<(viewers: Viewer[]) => void>>();

const list = (dir: string): Viewer[] => [...(decks.get(dir)?.values() ?? [])].sort((a, b) => a.who.localeCompare(b.who) || a.client.localeCompare(b.client));

const tell = (dir: string): void => {
  const now = list(dir);
  for (const fn of listeners.get(dir) ?? []) fn(now);
};

/** Drop the editors that stopped reporting; tells the deck's listeners when one went. */
function sweep(dir: string, now = Date.now()): void {
  const m = decks.get(dir);
  if (!m) return;
  let gone = false;
  for (const [k, v] of m) if (now - v.at > EXPIRE_MS) (m.delete(k), (gone = true));
  if (!m.size) decks.delete(dir);
  if (gone) tell(dir);
}

let timer: ReturnType<typeof setInterval> | undefined;
const ensureTimer = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    for (const dir of [...decks.keys()]) sweep(dir);
    if (!decks.size) (clearInterval(timer), (timer = undefined));
  }, 5_000);
  timer.unref?.();
};

/** An editor is here (or moved): its slide and box. Returns everyone on the deck. */
export function touchPresence(dir: string, v: Omit<Viewer, "at">): Viewer[] {
  sweep(dir);
  const m = decks.get(dir) ?? new Map<string, Viewer>();
  decks.set(dir, m);
  const prev = m.get(v.client);
  const next: Viewer = { client: v.client, who: v.who, slide: v.slide, ...(v.slot ? { slot: v.slot } : {}), at: Date.now() };
  m.set(v.client, next);
  ensureTimer();
  if (!prev || prev.slide !== next.slide || prev.slot !== next.slot || prev.who !== next.who) tell(dir);
  return list(dir);
}

/** An editor closed the deck. */
export function leavePresence(dir: string, client: string): void {
  const m = decks.get(dir);
  if (!m?.delete(client)) return;
  if (!m.size) decks.delete(dir);
  tell(dir);
}

export function viewersOf(dir: string): Viewer[] {
  sweep(dir);
  return list(dir);
}

/** Follow who is on the deck: called now and on every arrival, move and departure. */
export function subscribePresence(dir: string, fn: (viewers: Viewer[]) => void): () => void {
  const set = listeners.get(dir) ?? new Set();
  listeners.set(dir, set);
  set.add(fn);
  fn(viewersOf(dir));
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(dir);
  };
}

/* ---------- the deck's files, while someone has it open ---------- */

const fileWatches = new Map<string, { watcher: FSWatcher; notify: Set<() => void>; timer?: ReturnType<typeof setTimeout>; known: string | null }>();

const readDeck = (dir: string): string | null => {
  try {
    return readFileSync(path.join(dir, "deck.md"), "utf8");
  } catch {
    return null;
  }
};

/**
 * Call `notify` soon after a file in the deck's folder changes (an agent
 * writing deck.md, the CLI resolving a comment): one fs.watch per open
 * deck, shared, closed with its last listener. Editors then get the new
 * deck at once instead of on their next poll.
 */
export function watchDeckFiles(dir: string, notify: () => void): () => void {
  let w = fileWatches.get(dir);
  if (!w) {
    try {
      const entry = { watcher: null as unknown as FSWatcher, notify: new Set<() => void>(), timer: undefined as ReturnType<typeof setTimeout> | undefined, known: readDeck(dir) };
      entry.watcher = watch(dir, { persistent: false }, (_event, file) => {
        if (file && !/^(deck\.md|comments\.json)$/.test(String(file))) return;
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          // deck.md changed: the version it replaced goes into the history (a save from the editor kept it already).
          const now = readDeck(dir);
          if (entry.known !== null && now !== null && now !== entry.known) void snapshot(dir, entry.known, true).catch(() => {});
          if (now !== null) entry.known = now;
          for (const fn of entry.notify) fn();
        }, 80);
      });
      entry.watcher.on("error", () => {});
      w = entry;
      fileWatches.set(dir, w);
    } catch {
      return () => {};
    }
  }
  const entry = w;
  entry.notify.add(notify);
  return () => {
    entry.notify.delete(notify);
    if (entry.notify.size) return;
    clearTimeout(entry.timer);
    entry.watcher.close();
    fileWatches.delete(dir);
  };
}
