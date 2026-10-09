import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

/**
 * A workspace the inspector serves: its root (where kraftwerk.yml lives),
 * its output dir (runs/, chats/, notifications), and whatever state the
 * domain modules keep for it — chat sessions, caches, dev servers, timers.
 *
 * Domain code does not take the workspace as a parameter; it asks for the
 * current one (`currentWorkspace()`, or `workspaceRoot()` in context.ts).
 * The current workspace is the one the caller runs in (`ws.run(fn)`): the
 * server runs every request in its workspace, and everything started from
 * there — timers, child-process callbacks, event listeners — keeps it,
 * because AsyncLocalStorage follows the async chain. Outside any run, the
 * process default applies (`setDefaultWorkspace`), which is what a
 * single-workspace process (`kraftwerk ui`, the CLI) relies on.
 *
 * State that belongs to a workspace lives in a `perWorkspace` slot, never
 * in a module-level variable: one process may serve several workspaces.
 */
export class Workspace {
  readonly root: string;
  readonly outputDir: string;
  private readonly slots = new Map<object, unknown>();

  /** `root` defaults to the parent of the output dir (wrong for nested output dirs — pass it when known). */
  constructor(opts: { outputDir: string; root?: string }) {
    this.outputDir = path.resolve(opts.outputDir);
    this.root = opts.root ? path.resolve(opts.root) : path.dirname(this.outputDir);
    known.add(this);
  }

  /** Run `fn` (and everything it starts) in this workspace. */
  run<T>(fn: () => T): T {
    return storage.run(this, fn);
  }

  slot<T>(key: object, init: () => T): T {
    if (!this.slots.has(key)) this.slots.set(key, init());
    return this.slots.get(key) as T;
  }

  peek<T>(key: object): T | undefined {
    return this.slots.get(key) as T | undefined;
  }
}

const storage = new AsyncLocalStorage<Workspace>();
const known = new Set<Workspace>();
let fallback: Workspace | null = null;

/** The workspace a single-workspace process serves; used outside any `ws.run`. */
export function setDefaultWorkspace(ws: Workspace): Workspace {
  fallback = ws;
  return ws;
}

export function currentWorkspace(): Workspace {
  const ws = storage.getStore() ?? fallback;
  if (!ws) throw new Error("inspector context not initialized");
  return ws;
}

export interface PerWorkspace<T> {
  /** The current workspace's value, created on first use. */
  (): T;
  /** Every workspace that created a value, with it (sweeps and shutdown: run per workspace, `ws.run(...)`). */
  entries(): Array<[Workspace, T]>;
}

/** Module state kept once per workspace: `const chats = perWorkspace(() => new Map())`, then `chats()`. */
export function perWorkspace<T>(init: () => T): PerWorkspace<T> {
  const key = {};
  const get = (() => currentWorkspace().slot(key, init)) as PerWorkspace<T>;
  get.entries = () => [...known].flatMap((ws): Array<[Workspace, T]> => (ws.peek<T>(key) === undefined ? [] : [[ws, ws.peek<T>(key) as T]]));
  return get;
}
