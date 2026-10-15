import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * The machine's kraftwerk daemon: one process (`kraftwerk daemon`) serving
 * every open workspace, each by its slug (`<slug>.localhost:<port>`,
 * `/w/<slug>/`). It writes ~/.kraftwerk/daemon.json while it runs, so the CLI
 * (`kraftwerk ui`) and other kraftwerks (the switcher's start/stop) hand
 * workspaces to it instead of starting a server of their own. The file
 * outlives the daemon on purpose: it lists what was open, and the next start
 * (a reboot, a self-update) opens it again. Whether a daemon runs is told by
 * asking it (findDaemon), never by the file alone.
 */

export const DAEMON_PORT = 1980;

export interface DaemonFile {
  pid: number;
  port: number;
  startedAt: string;
  /** The supervisor around it (`kraftwerk daemon stop` signals that one, so it does not start the daemon again). */
  supervisor?: number;
  version?: string;
  /** The roots it serves — reopened when the daemon starts again (a restart, a self-update). */
  open?: string[];
}

const daemonFile = (): string => path.join(os.homedir(), ".kraftwerk", "daemon.json");

const startedAt = new Date().toISOString();

let version: string | undefined;
/** The version the running daemon writes into its file (status shows it: the install may be newer than what runs). */
export const setDaemonVersion = (v: string): void => {
  version = v;
};

/** Where a daemon in the background (`kraftwerk daemon start`, the login item) writes what it says. */
export const daemonLogPath = (): string => path.join(os.homedir(), ".kraftwerk", "logs", "daemon.log");

export async function writeDaemonFile(port: number, open: string[]): Promise<void> {
  await fs.mkdir(path.dirname(daemonFile()), { recursive: true });
  const tmp = `${daemonFile()}.${process.pid}.tmp`;
  const supervisor = Number(process.env.KRAFTWERK_SUPERVISOR_PID) || undefined;
  await fs.writeFile(tmp, JSON.stringify({ pid: process.pid, port, startedAt, open, ...(supervisor ? { supervisor } : {}), ...(version ? { version } : {}) } satisfies DaemonFile));
  await fs.rename(tmp, daemonFile());
}

/** What the last daemon served, to open again; [] without a file. */
export async function lastOpenRoots(): Promise<string[]> {
  try {
    const rec = JSON.parse(await fs.readFile(daemonFile(), "utf8")) as DaemonFile;
    return Array.isArray(rec.open) ? rec.open.filter((r) => typeof r === "string") : [];
  } catch {
    return [];
  }
}

/** The daemon file as the last daemon left it; null without one. */
export async function readDaemonFile(): Promise<DaemonFile | null> {
  try {
    return JSON.parse(await fs.readFile(daemonFile(), "utf8")) as DaemonFile;
  } catch {
    return null;
  }
}

/**
 * How long a daemon may take to answer before it counts as not there. A
 * daemon under load (agents at work, a busy machine) can take a second or
 * two; 0.8 s once read such a one as stopped.
 */
const ANSWER_MS = 3000;

/** The running daemon (its file, and a hub that answers on its port), or null. */
export async function findDaemon(timeoutMs = ANSWER_MS): Promise<{ pid: number; port: number } | null> {
  const rec = await readDaemonFile();
  if (!rec) return null;
  try {
    // Every kraftwerk server answers /api/hub; only the daemon says it is one (a standalone `kraftwerk ui` may sit on that port now).
    const r = await fetch(`http://127.0.0.1:${rec.port}/api/hub`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = r.ok ? ((await r.json()) as { daemon?: unknown }) : null;
    return body?.daemon === true ? { pid: rec.pid, port: rec.port } : null;
  } catch {
    return null;
  }
}

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, it is just not ours to signal.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

const portTaken = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (taken: boolean) => {
      sock.destroy();
      resolve(taken);
    };
    sock.setTimeout(1000, () => done(true)); // accepted nothing yet, refused nothing either: something holds it
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });

export type DaemonState = { state: "running" | "busy"; pid: number; port: number } | { state: "stopped" };

/**
 * Whether a daemon runs, telling a slow one from a stopped one: "busy" is a
 * daemon whose process lives and whose port is taken but that did not answer
 * in time. A busy daemon is never "stopped" — starting another would only
 * crash on the taken port, and restarting it would interrupt its agents.
 */
export async function daemonState(timeoutMs = ANSWER_MS): Promise<DaemonState> {
  const found = await findDaemon(timeoutMs);
  if (found) return { state: "running", ...found };
  const rec = await readDaemonFile();
  if (rec && pidAlive(rec.pid) && (await portTaken(rec.port))) return { state: "busy", pid: rec.pid, port: rec.port };
  return { state: "stopped" };
}

/** Ask the daemon to open or close a workspace (this machine's request: local trust). */
export async function daemonCall<T>(port: number, verb: "open" | "close", root: string): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const r = await fetch(`http://127.0.0.1:${port}/api/hub/${verb}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ root }),
    signal: AbortSignal.timeout(30_000),
  });
  return { ok: r.ok, status: r.status, data: (await r.json().catch(() => ({}))) as T & { error?: string } };
}
