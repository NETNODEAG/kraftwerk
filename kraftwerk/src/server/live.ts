import { watch as watchFs, type FSWatcher } from "node:fs";
import path from "node:path";
import { onChanged } from "../core/changes.js";
import { currentWorkspace, perWorkspace, type Workspace } from "../core/workspace.js";

/**
 * Live data for watching clients: a watch is a route result some client
 * keeps on screen (the rail's agents, the bell's notifications). The server
 * evaluates each distinct watch once — however many clients share it — and
 * pushes it only when it changed:
 *
 * - right after any change made through the API (`touch()` from the router),
 * - when a chat's state changes (turn start/end, a question, an answer),
 * - when a file in the workspace changes (an agent writing files, a run
 *   progressing on disk) — where the platform watches a folder tree
 *   natively (macOS, Windows),
 * - and on the watch's interval, for changes nobody announces. While the
 *   workspace's files are watched that is only a slow safety net
 *   (FALLBACK_MS), so an idle screen costs next to nothing.
 *
 * Evaluation runs in the watch's workspace — bound when the watch is made,
 * so a re-evaluation whatever triggers it (a timer, a change elsewhere)
 * never runs without one. This module knows nothing about routes: the
 * socket hands it an `evaluate` closure.
 */

interface Watcher {
  interval: number;
  push(data: unknown): void;
}

interface Watch {
  evaluate(): Promise<{ ok: boolean; data: unknown }>;
  /** Whether its workspace's files are watched (then the interval is only a safety net). */
  files(): boolean;
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
/** Re-evaluation after file changes: at most this often, however busy the disk (an agent writing code, a run streaming its trace). */
const FILES_THROTTLE_MS = 1000;
/** The interval while the workspace's files are watched: only what no file and no API call announces (a process ending, the clock). */
const FALLBACK_MS = 20_000;

/**
 * Changes that never matter to a watch: version control and build trees,
 * and a chat's transcript growing token by token (its state changes are
 * announced by the chat itself).
 */
const IGNORED = /(^|[/\\])(\.git|node_modules|\.next|\.vite|\.cache|\.turbo|dist|build|target|vendor)([/\\]|$)|(^|[/\\])chats[/\\]chat-[^/\\]+[/\\]events\.jsonl$/;

/** Native recursive folder watching: one cheap OS subscription for the whole tree. Elsewhere (Linux) the intervals do the work. */
const RECURSIVE = process.platform === "darwin" || process.platform === "win32";

interface FilesWatch {
  watchers: FSWatcher[];
  timer?: ReturnType<typeof setTimeout>;
}

const state = perWorkspace(() => ({
  watches: new Map<string, Watch>(),
  touchTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  files: undefined as FilesWatch | undefined,
}));

/** Re-evaluate every watch of the workspace now (each after whatever runs). */
function runAll(s: ReturnType<typeof state>): void {
  for (const w of s.watches.values()) void run(w, undefined).finally(() => schedule(w));
}

/**
 * Watch the workspace's folder tree (and its output dir, when that lies
 * elsewhere) while anyone watches a route there. A watcher that fails (too
 * many open files, the folder gone) is dropped and the intervals take over.
 */
function watchFiles(ws: Workspace, s: ReturnType<typeof state>): void {
  if (!RECURSIVE || s.files) return;
  const files: FilesWatch = { watchers: [] };
  // `name` is relative to the watched folder, so a workspace that itself lives under a "build" folder is not ignored whole.
  const onEvent = (_event: string, name: string | Buffer | null) => {
    if (name && IGNORED.test(String(name))) return;
    if (files.timer || s.files !== files) return;
    files.timer = setTimeout(() => {
      files.timer = undefined;
      if (s.files === files && !ws.closed) runAll(s);
    }, FILES_THROTTLE_MS);
    files.timer.unref?.();
  };
  const dirs = [ws.root];
  if (path.relative(ws.root, ws.outputDir).startsWith("..")) dirs.push(ws.outputDir);
  try {
    for (const dir of dirs) {
      const w = watchFs(dir, { recursive: true, persistent: false }, onEvent);
      w.on("error", () => stopFiles(s, true));
      files.watchers.push(w);
    }
  } catch {
    for (const w of files.watchers) w.close();
    return;
  }
  s.files = files;
}

/** Stop watching the folder tree; `failed` re-times every watch to its own interval at once. */
function stopFiles(s: ReturnType<typeof state>, failed = false): void {
  const files = s.files;
  if (!files) return;
  s.files = undefined;
  clearTimeout(files.timer);
  for (const w of files.watchers) w.close();
  if (failed) for (const w of s.watches.values()) schedule(w);
}

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
  const asked = Math.min(...[...w.watchers].map((x) => x.interval));
  const every = Math.max(MIN_INTERVAL, w.files() ? Math.max(asked, FALLBACK_MS) : asked);
  w.timer = setTimeout(() => void run(w, undefined).finally(() => schedule(w)), every);
  w.timer.unref?.();
}

/**
 * Keep `push` fed with the result of `evaluate` (shared by `key`): now, on
 * every change, and at least every `interval` ms. Returns the unwatch.
 */
export function watch(key: string, evaluate: Watch["evaluate"], interval: number, push: (data: unknown) => void): () => void {
  const s = state();
  const { watches } = s;
  let w = watches.get(key);
  if (!w) {
    const ws = currentWorkspace();
    w = { evaluate: () => ws.run(evaluate), files: () => !!s.files, watchers: new Set() };
    watches.set(key, w);
    watchFiles(ws, s);
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
      // Nobody watches anything here any more: the folder tree need not be watched either.
      if (!watches.size) stopFiles(s);
    } else schedule(current);
  };
}

/** The current workspace closes: its watches stop re-evaluating (their sockets close with it). */
export function closeWatches(): void {
  const s = state();
  for (const w of s.watches.values()) clearTimeout(w.timer);
  s.watches.clear();
  stopFiles(s);
  clearTimeout(s.touchTimer);
  s.touchTimer = undefined;
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
    runAll(s);
  }, TOUCH_DEBOUNCE_MS);
  s.touchTimer.unref?.();
}

// Domain code announces changes without knowing about watches.
onChanged(touch);
