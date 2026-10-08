import { perWorkspace } from "./workspace.js";

/**
 * Live data for watching clients: a watch is a route result some client
 * keeps on screen (the rail's agents, the bell's notifications). The server
 * evaluates each distinct watch once — however many clients share it — and
 * pushes it only when it changed:
 *
 * - right after any change made through the API (`touch()` from the router),
 * - when a chat's state changes (turn start/end, a question, an answer),
 * - and on the watch's interval, for changes nobody announces (an agent
 *   writing files, a run progressing on disk).
 *
 * Evaluation runs in the watch's workspace. This module knows nothing about
 * routes: the socket hands it an `evaluate` closure.
 */

interface Watcher {
  interval: number;
  push(data: unknown): void;
}

interface Watch {
  evaluate(): Promise<{ ok: boolean; data: unknown }>;
  watchers: Set<Watcher>;
  /** The last pushed JSON, to push changes only. */
  last?: string;
  timer?: ReturnType<typeof setTimeout>;
  /** The evaluation in flight, and the one waiting behind it. */
  running?: Promise<void>;
  queued?: { promise: Promise<void>; forced: Set<Watcher> };
}

const MIN_INTERVAL = 1000;
const TOUCH_DEBOUNCE_MS = 60;

const state = perWorkspace(() => ({ watches: new Map<string, Watch>(), touchTimer: undefined as ReturnType<typeof setTimeout> | undefined }));

/**
 * Evaluate after whatever evaluation is in flight (it may predate the
 * change that asked for this one). Requests that arrive while one waits
 * share it. Changed data goes to every watcher; `force` watchers (just
 * joined) get it even unchanged.
 */
function run(w: Watch, force: Watcher | undefined): Promise<void> {
  if (w.queued) {
    if (force) w.queued.forced.add(force);
    return w.queued.promise;
  }
  const forced = new Set<Watcher>(force ? [force] : []);
  const promise = (w.running ?? Promise.resolve()).then(async () => {
    w.queued = undefined;
    try {
      const r = await w.evaluate();
      // A failed evaluation keeps the last good value on every client.
      if (!r.ok) return;
      const json = JSON.stringify(r.data) ?? "null";
      const changed = json !== w.last;
      w.last = json;
      for (const x of w.watchers) if (changed || forced.has(x)) x.push(r.data);
    } catch {}
  });
  w.queued = { promise, forced };
  w.running = promise;
  return promise;
}

function schedule(w: Watch): void {
  clearTimeout(w.timer);
  if (!w.watchers.size) return;
  const every = Math.max(MIN_INTERVAL, Math.min(...[...w.watchers].map((x) => x.interval)));
  w.timer = setTimeout(() => void run(w, undefined).finally(() => schedule(w)), every);
  w.timer.unref?.();
}

/**
 * Keep `push` fed with the result of `evaluate` (shared by `key`): now, on
 * every change, and at least every `interval` ms. Returns the unwatch.
 */
export function watch(key: string, evaluate: Watch["evaluate"], interval: number, push: (data: unknown) => void): () => void {
  const { watches } = state();
  let w = watches.get(key);
  if (!w) {
    w = { evaluate, watchers: new Set() };
    watches.set(key, w);
  }
  const watcher: Watcher = { interval, push };
  w.watchers.add(watcher);
  // A new watcher gets the current value at once, changed or not.
  void run(w, watcher).finally(() => schedule(w));
  const current = w;
  return () => {
    current.watchers.delete(watcher);
    if (!current.watchers.size) {
      clearTimeout(current.timer);
      if (watches.get(key) === current) watches.delete(key);
    } else schedule(current);
  };
}

/** Something changed: re-evaluate every watch of this workspace soon (debounced). */
export function touch(): void {
  // Outside any workspace (a unit test, a CLI command) nobody can be watching.
  let s: ReturnType<typeof state>;
  try {
    s = state();
  } catch {
    return;
  }
  if (!s.watches.size || s.touchTimer) return;
  s.touchTimer = setTimeout(() => {
    s.touchTimer = undefined;
    for (const w of s.watches.values()) void run(w, undefined).finally(() => schedule(w));
  }, TOUCH_DEBOUNCE_MS);
  s.touchTimer.unref?.();
}
