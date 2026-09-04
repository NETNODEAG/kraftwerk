import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fsSync, { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { absolutePath, isDir, resolveProject } from "../config.js";
import { selfCommand } from "./self-command.js";
import type { AgentSummary } from "./agents.js";

/**
 * Two registries under ~/.kraftwerk, two lifecycles:
 *
 * instances/<pid>.json — ephemeral. Every running inspector writes one so
 * other local instances can discover it (the workspace switcher lists
 * running workspaces automatically, no kraftwerk.yml `switcher:` needed).
 * Registered ports are verified by probing /api/meta on read; entries
 * that stop answering are pruned, so crashes leave no ghosts.
 *
 * projects/<hash(root)>.json — durable. One record per project root that
 * ever ran the inspector on this machine, keyed by the root and never
 * pruned automatically. Everything else (name, icon, port) is derived from
 * the root's kraftwerk.yml at read time, so it is always current. A
 * project that is not running can be started again from the switcher or
 * `kraftwerk projects start` — that is what makes a killed UI findable.
 * The record also carries the project's agent roster (written whenever the
 * instance reads it), so the ⌘K palette can list every workspace's agents
 * from a handful of small files without probing anything.
 */

const HOME = path.join(os.homedir(), ".kraftwerk");
const INSTANCES_DIR = path.join(HOME, "instances");
const PROJECTS_DIR = path.join(HOME, "projects");
const LOGS_DIR = path.join(HOME, "logs");

interface InstanceFile {
  pid: number;
  port: number;
  startedAt: string;
  /** Absolute project root this instance serves (absent in pre-0.33 files). */
  root?: string;
}

/** Durable per-project record. The root is the key; everything else derives from it. */
export interface ProjectRecord {
  root: string;
  firstSeen: string;
  lastStarted: string;
  /** Set on clean shutdown; older than lastStarted means the last run died. */
  lastStopped?: string;
  startCount: number;
  /** Active agents, as last seen by the instance serving this root. */
  agents?: AgentSummary[];
}

/** A verified running instance, shaped like a switcher entry. */
export interface DiscoveredInstance {
  name: string;
  url: string;
  icon?: string;
  /** kraftwerk.yml `color`, if set. */
  color?: string;
  /** True when the name comes from kraftwerk.yml (false = folder name). */
  named?: boolean;
  live: true;
  root?: string;
  /** Server process id (what to signal to stop it). */
  pid: number;
}

/**
 * One workspace as the switcher shows it: a known project (running or
 * not) or a running instance the projects registry doesn't know yet.
 */
export interface WorkspaceEntry {
  name: string;
  /** Where the inspector answers (live) or would answer once started. */
  url: string;
  icon?: string;
  /** kraftwerk.yml `color`, if set; the UI derives one from the root otherwise. */
  color?: string;
  /** True when the name comes from kraftwerk.yml, false when it is just the folder name. */
  named?: boolean;
  live: boolean;
  root?: string;
  /** Root with ~ for the home dir — what the UI prints. */
  rootLabel?: string;
  /** False when the root directory is gone (or no longer a project of its own); start is impossible. */
  exists?: boolean;
  lastStarted?: string;
  lastStopped?: string;
}

const selfFile = (): string => path.join(INSTANCES_DIR, `${process.pid}.json`);

let selfPort: number | null = null;
let selfRoot: string | null = null;

const projectKey = (root: string): string =>
  createHash("sha1").update(absolutePath(root)).digest("hex").slice(0, 16);

const projectFile = (root: string): string => path.join(PROJECTS_DIR, `${projectKey(root)}.json`);

/** ~/… for display. */
export const tildify = (p: string): string => {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
};

/* ---------- instances (ephemeral) ---------- */

/** Write this instance's registry file (call once the server listens). */
export async function registerInstance(port: number, root: string): Promise<void> {
  selfPort = port;
  selfRoot = absolutePath(root);
  try {
    await fs.mkdir(INSTANCES_DIR, { recursive: true });
    const rec: InstanceFile = { pid: process.pid, port, startedAt: new Date().toISOString(), root: selfRoot };
    await fs.writeFile(selfFile(), JSON.stringify(rec));
  } catch {} // best-effort — without it discovery just won't see us
}

/** Where this instance answers, as the switcher links it (null before listen). */
export const currentInstanceUrl = (): string | null => (selfPort ? `http://localhost:${selfPort}` : null);

/** Remove this instance's registry file. Sync so exit handlers can call it. */
export function unregisterInstance(): void {
  try {
    fsSync.unlinkSync(selfFile());
  } catch {}
}

/**
 * Probe one registered port: is a kraftwerk inspector answering? `probe=1`
 * tells the other side to skip its own discovery — two instances probing
 * each other's /api/meta must not recurse.
 */
async function probe(port: number): Promise<Omit<DiscoveredInstance, "root" | "pid"> | null> {
  // `listen(port, "localhost")` binds one address family, whichever the
  // resolver returns first (::1 on this platform), so an instance started
  // with KRAFTWERK_UI_HOST=localhost or ::1 is not on 127.0.0.1. A refused
  // connection returns at once, so the second try costs nothing when the
  // first one answers.
  return (await probeAt("127.0.0.1", port)) ?? (await probeAt("[::1]", port));
}

async function probeAt(host: string, port: number): Promise<Omit<DiscoveredInstance, "root" | "pid"> | null> {
  try {
    const r = await fetch(`http://${host}:${port}/api/meta?probe=1`, {
      signal: AbortSignal.timeout(400),
    });
    if (!r.ok) return null;
    const meta = (await r.json()) as {
      version?: string;
      projectName?: string;
      projectIcon?: string;
      projectColor?: string;
      projectNamed?: boolean;
    };
    if (typeof meta.version !== "string") return null; // some other app took the port
    return {
      name: meta.projectName || `localhost:${port}`,
      url: `http://localhost:${port}`,
      icon: meta.projectIcon || undefined,
      color: meta.projectColor || undefined,
      named: typeof meta.projectNamed === "boolean" ? meta.projectNamed : undefined,
      live: true,
    };
  } catch {
    return null;
  }
}

let cache: { at: number; entries: DiscoveredInstance[] } | null = null;

/** All other running instances, verified live. Cached briefly — /api/meta is polled. */
export async function discoverInstances(): Promise<DiscoveredInstance[]> {
  if (cache && Date.now() - cache.at < 5_000) return cache.entries;
  let files: string[];
  try {
    files = await fs.readdir(INSTANCES_DIR);
  } catch {
    return [];
  }
  const probed = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        let rec: InstanceFile;
        try {
          rec = JSON.parse(await fs.readFile(path.join(INSTANCES_DIR, f), "utf8")) as InstanceFile;
        } catch {
          return null;
        }
        if (rec.pid === process.pid || rec.port === selfPort) return null;
        const found = await probe(rec.port);
        if (!found) {
          await fs.unlink(path.join(INSTANCES_DIR, f)).catch(() => {}); // stale — prune
          return null;
        }
        return { ...found, root: rec.root, pid: rec.pid } as DiscoveredInstance;
      })
  );
  const entries = probed
    .filter((e): e is DiscoveredInstance => e != null)
    .sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), entries };
  return entries;
}

/* ---------- projects (durable) ---------- */

async function readProject(file: string): Promise<ProjectRecord | null> {
  try {
    const rec = JSON.parse(await fs.readFile(file, "utf8")) as Partial<ProjectRecord>;
    if (typeof rec.root !== "string") return null;
    return {
      root: rec.root,
      firstSeen: rec.firstSeen ?? rec.lastStarted ?? "",
      lastStarted: rec.lastStarted ?? rec.firstSeen ?? "",
      lastStopped: rec.lastStopped,
      startCount: rec.startCount ?? 1,
      ...(Array.isArray(rec.agents) ? { agents: rec.agents } : {}),
    };
  } catch {
    return null;
  }
}

/** Upsert the project record for a root (call on every inspector start). */
export async function registerProject(root: string): Promise<void> {
  const abs = absolutePath(root);
  const now = new Date().toISOString();
  try {
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
    const prev = await readProject(projectFile(abs));
    const rec: ProjectRecord = {
      root: abs,
      firstSeen: prev?.firstSeen || now,
      lastStarted: now,
      startCount: (prev?.startCount ?? 0) + 1,
      ...(prev?.agents ? { agents: prev.agents } : {}),
    };
    await fs.writeFile(projectFile(abs), JSON.stringify(rec, null, 2));
  } catch {} // best-effort, like the instance file
}

let syncedAgents = "";

/**
 * Write the roster into the project's record. Called on every roster read
 * (the UI polls it, routines tick it), so a record only changes when the
 * roster did. Roots with no record (a CLI run in a project that never
 * started the inspector) are left alone.
 */
export async function syncProjectAgents(root: string, agents: AgentSummary[]): Promise<void> {
  const key = `${root}\n${JSON.stringify(agents)}`;
  if (key === syncedAgents) return;
  try {
    const file = projectFile(root);
    const rec = await readProject(file);
    if (!rec) return;
    await fs.writeFile(file, JSON.stringify({ ...rec, agents }, null, 2));
    syncedAgents = key;
  } catch {}
}

/** Stamp lastStopped on clean shutdown. Sync so exit handlers can call it. */
export function markProjectStopped(): void {
  if (!selfRoot) return;
  try {
    const file = projectFile(selfRoot);
    const rec = JSON.parse(fsSync.readFileSync(file, "utf8")) as ProjectRecord;
    rec.lastStopped = new Date().toISOString();
    fsSync.writeFileSync(file, JSON.stringify(rec, null, 2));
  } catch {}
}

/** All known projects, most recently started first. */
export async function listProjects(): Promise<ProjectRecord[]> {
  let files: string[];
  try {
    files = await fs.readdir(PROJECTS_DIR);
  } catch {
    return [];
  }
  const recs = await Promise.all(
    files.filter((f) => f.endsWith(".json")).map((f) => readProject(path.join(PROJECTS_DIR, f)))
  );
  return recs
    .filter((r): r is ProjectRecord => r != null)
    .sort((a, b) => b.lastStarted.localeCompare(a.lastStarted));
}

/** Drop a project record (the root itself is untouched). */
export async function forgetProject(root: string): Promise<boolean> {
  try {
    await fs.unlink(projectFile(root));
    return true;
  } catch {
    return false;
  }
}

/**
 * Name, icon and port a root would run with right now — read from its
 * kraftwerk.yml. `exists` is false when the directory is gone or when the
 * project resolves to an ancestor (its kraftwerk.yml was removed, or it
 * sits inside another project): resolveProject walks up and never fails,
 * so without this check a stale record would wear its parent's identity.
 */
async function describeRoot(
  root: string
): Promise<{ name: string; icon?: string; color?: string; named: boolean; port: number; exists: boolean }> {
  const fallback = { name: path.basename(root), named: false, port: 1981, exists: false };
  if (!(await isDir(root))) return fallback;
  try {
    const project = await resolveProject(root);
    if (path.resolve(project.root) !== path.resolve(root)) return fallback;
    return {
      name: project.config.name ?? path.basename(project.root),
      named: !!project.config.name,
      icon: project.config.icon || undefined,
      color: project.config.color || undefined,
      port: project.config.port ?? 1981,
      exists: true,
    };
  } catch {
    return fallback;
  }
}

let wsCache: { at: number; entries: WorkspaceEntry[] } | null = null;

/**
 * The switcher's view: every known project joined with the live instances,
 * plus running instances with no project record yet. The calling instance
 * itself is left out. Live entries first, then by last start. Cached like
 * discoverInstances — /api/meta is polled and this stats every root.
 */
export async function discoverWorkspaces(): Promise<WorkspaceEntry[]> {
  if (wsCache && Date.now() - wsCache.at < 5_000) return wsCache.entries;
  const [projects, live] = await Promise.all([listProjects(), discoverInstances()]);
  const liveByRoot = new Map(live.filter((i) => i.root).map((i) => [i.root!, i]));
  const consumed = new Set<DiscoveredInstance>();

  const entries = (
    await Promise.all(
      projects
        .filter((p) => p.root !== selfRoot)
        .map(async (p): Promise<WorkspaceEntry> => {
          const base = { root: p.root, rootLabel: tildify(p.root), lastStarted: p.lastStarted, lastStopped: p.lastStopped };
          let running = liveByRoot.get(p.root);
          let d: Awaited<ReturnType<typeof describeRoot>> | undefined;
          if (!running) {
            d = await describeRoot(p.root);
            // A pre-0.33 inspector still serving this root registered no
            // root — match it by the port the root would use, else the
            // switcher shows the same project twice (live + stopped).
            running = live.find((i) => !i.root && i.url === `http://localhost:${d!.port}`);
          }
          if (running) {
            consumed.add(running);
            // An instance from before 0.38 answers without color/named — read them from its root.
            if (running.named === undefined) d = await describeRoot(p.root);
            return {
              ...base,
              name: running.name,
              url: running.url,
              icon: running.icon,
              color: running.color ?? d?.color,
              named: running.named ?? d?.named,
              live: true,
              exists: true,
            };
          }
          return { ...base, name: d!.name, url: `http://localhost:${d!.port}`, icon: d!.icon, color: d!.color, named: d!.named, live: false, exists: d!.exists };
        })
    )
  ).concat(
    await Promise.all(
      live
        .filter((i) => !consumed.has(i))
        .map(async (i): Promise<WorkspaceEntry> => ({
          name: i.name,
          url: i.url,
          icon: i.icon,
          color: i.color,
          named: i.named,
          live: true,
          root: i.root,
          rootLabel: i.root ? tildify(i.root) : undefined,
          exists: i.root ? await isDir(i.root) : undefined,
        }))
    )
  );
  entries.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return (b.lastStarted ?? "").localeCompare(a.lastStarted ?? "") || a.name.localeCompare(b.name);
  });
  wsCache = { at: Date.now(), entries };
  return entries;
}

/* ---------- admin view ---------- */

export type WorkspaceState = "running" | "stopped" | "died" | "missing" | "orphaned";

/** A workspace with everything the admin screen shows. */
export interface WorkspaceDetail extends WorkspaceEntry {
  /** The instance answering this request. */
  current?: boolean;
  /** kraftwerk.yml present in the root itself (not inherited from an ancestor). */
  hasConfig?: boolean;
  /** The root directory itself is gone (vs. still there but no longer a project). */
  dirGone?: boolean;
  state: WorkspaceState;
  firstSeen?: string;
  startCount?: number;
  counts?: { agents: number; workflows: number; runs: number; chats: number };
}

const countDirs = async (dir: string, marker?: string): Promise<number> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
    if (!marker) return dirs.length;
    const flags = await Promise.all(dirs.map((d) => fs.stat(path.join(dir, d.name, marker)).then(() => true, () => false)));
    return flags.filter(Boolean).length;
  } catch {
    return 0;
  }
};

const countEntries = async (dir: string): Promise<number> => {
  try {
    return (await fs.readdir(dir)).filter((n) => !n.startsWith(".")).length;
  } catch {
    return 0;
  }
};

/**
 * Every workspace including this one, with config presence, counts of
 * what lives in the root, and a single derived state. Not cached — the
 * admin screen polls slowly and wants fresh counts.
 */
export async function listWorkspacesDetailed(): Promise<WorkspaceDetail[]> {
  const others = await discoverWorkspaces();
  const all: WorkspaceEntry[] = [...others];
  if (selfRoot && selfPort) {
    const d = await describeRoot(selfRoot);
    const rec = await readProject(projectFile(selfRoot));
    all.unshift({
      name: d.name,
      icon: d.icon,
      color: d.color,
      named: d.named,
      url: `http://localhost:${selfPort}`,
      live: true,
      root: selfRoot,
      rootLabel: tildify(selfRoot),
      exists: true,
      lastStarted: rec?.lastStarted,
      lastStopped: rec?.lastStopped,
    });
  }
  return Promise.all(
    all.map(async (e): Promise<WorkspaceDetail> => {
      const current = !!selfRoot && e.root === selfRoot;
      const base: WorkspaceDetail = { ...e, current, state: e.live ? "running" : "stopped" };
      if (!e.root) return base;
      const rec = await readProject(projectFile(e.root));
      base.firstSeen = rec?.firstSeen;
      base.startCount = rec?.startCount;
      // "missing" = the folder is gone; "orphaned" = it is still there but
      // no longer a project of its own (kraftwerk.yml removed, or it now
      // resolves to an ancestor). Both are removable from the registry.
      const dirGone = !(await isDir(e.root));
      base.dirGone = dirGone;
      if (!e.live) {
        if (dirGone) base.state = "missing";
        else if (e.exists === false) base.state = "orphaned";
        else if (!(rec?.lastStopped && rec.lastStarted && rec.lastStopped >= rec.lastStarted)) base.state = "died";
      }
      if (e.exists === false) {
        base.hasConfig = false;
        return base;
      }
      try {
        const project = await resolveProject(e.root);
        base.hasConfig = !!project.configPath && path.dirname(project.configPath) === path.resolve(e.root);
        const [agents, workflows, runs, chats] = await Promise.all([
          countDirs(path.resolve(project.root, project.config.agents ?? "agents"), "agent.yml"),
          project.workflowsRoot ? countDirs(project.workflowsRoot, "workflow.yml") : Promise.resolve(0),
          countDirs(path.join(project.outputDir, "runs")),
          countEntries(path.join(project.outputDir, "chats")),
        ]);
        base.counts = { agents, workflows, runs, chats };
      } catch {
        base.hasConfig = false;
      }
      return base;
    })
  );
}

/* ---------- start a project ---------- */

export interface StartResult {
  ok: boolean;
  url?: string;
  /** True once the new inspector answered its probe within the wait. */
  live?: boolean;
  pid?: number;
  log?: string;
  error?: string;
}

/**
 * Launch `kraftwerk ui` for a root as a detached process (selfCommand:
 * the bin this process runs from), logging to ~/.kraftwerk/logs/<key>.log.
 * The reported pid is the `kraftwerk ui` supervisor, which forwards
 * SIGTERM/SIGINT to its server child, so `kill <pid>` stops the whole UI.
 * Waits up to ~5s for the new inspector to answer so callers can link
 * straight to it.
 */
export async function startProject(root: string): Promise<StartResult> {
  const abs = absolutePath(root);
  const { name, port, exists } = await describeRoot(abs);
  if (!exists) return { ok: false, error: `not a project directory (missing or moved): ${abs}` };
  const url = `http://localhost:${port}`;
  if (abs === selfRoot) return { ok: false, url, live: true, error: "that is this workspace" };

  // Already running, or the port is taken by another kraftwerk?
  cache = wsCache = null;
  const live = await discoverInstances();
  const byRoot = live.find((i) => i.root === abs);
  if (byRoot) return { ok: true, url: byRoot.url, live: true };
  if (port === selfPort) return { ok: false, url, error: `port ${port} is used by this workspace` };
  const byPort = live.find((i) => i.url === url);
  if (byPort) return { ok: false, url, error: `port ${port} is used by "${byPort.name}"` };

  let log: string | undefined;
  let stdio: ("ignore" | number)[] = ["ignore", "ignore", "ignore"];
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    log = path.join(LOGS_DIR, `${projectKey(abs)}.log`);
    const fd = fsSync.openSync(log, "a");
    fsSync.writeSync(fd, `\n--- ${new Date().toISOString()} start ${name} (${abs}) ---\n`);
    stdio = ["ignore", fd, fd];
  } catch {}

  const { cmd, args } = selfCommand(["ui"]);
  let child: ReturnType<typeof spawn>;
  try {
    const env = { ...process.env };
    delete env.KRAFTWERK_UI_SUPERVISED; // the new one runs its own supervisor
    child = spawn(cmd, args, { cwd: abs, detached: true, stdio, env });
    child.unref();
  } catch (err) {
    return { ok: false, url, log, error: (err as Error).message };
  }
  if (typeof stdio[1] === "number") {
    try {
      fsSync.closeSync(stdio[1]);
    } catch {}
  }

  let exited: string | null = null;
  child.once("exit", (code, signal) => {
    exited = signal ? `killed by ${signal}` : `exited with code ${code}`;
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    if (exited) return { ok: false, url, pid: child.pid, log, error: `kraftwerk ui ${exited}` };
    if (await probe(port)) {
      cache = wsCache = null;
      return { ok: true, url, live: true, pid: child.pid, log };
    }
  }
  return { ok: true, url, live: false, pid: child.pid, log };
}

/* ---------- stop a project ---------- */

/**
 * Stop a running workspace: SIGTERM to its server process, which
 * unregisters, stamps lastStopped and exits; the `kraftwerk ui` supervisor
 * follows. Matched by root, or by url for instances from older versions
 * that registered no root. Waits up to ~5s for the port to go quiet.
 */
export async function stopProject(target: { root?: string; url?: string }): Promise<{ ok: boolean; error?: string }> {
  if (target.root && absolutePath(target.root) === selfRoot) {
    return { ok: false, error: "that is this workspace — stop it from its own terminal or pid" };
  }
  cache = wsCache = null;
  const live = await discoverInstances();
  const inst = live.find((i) => (target.root && i.root === absolutePath(target.root)) || (target.url && i.url === target.url));
  if (!inst) return { ok: false, error: "not running" };
  try {
    process.kill(inst.pid, "SIGTERM");
  } catch (err) {
    return { ok: false, error: `could not signal pid ${inst.pid}: ${(err as Error).message}` };
  }
  const port = Number(new URL(inst.url).port);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    if (!(await probe(port))) {
      cache = wsCache = null;
      return { ok: true };
    }
  }
  return { ok: false, error: `pid ${inst.pid} still answers on ${inst.url} after 5s` };
}
