import { promises as fs } from "node:fs";
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

interface DaemonFile {
  pid: number;
  port: number;
  startedAt: string;
  /** The roots it serves — reopened when the daemon starts again (a restart, a self-update). */
  open?: string[];
}

const daemonFile = (): string => path.join(os.homedir(), ".kraftwerk", "daemon.json");

const startedAt = new Date().toISOString();

export async function writeDaemonFile(port: number, open: string[]): Promise<void> {
  await fs.mkdir(path.dirname(daemonFile()), { recursive: true });
  const tmp = `${daemonFile()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ pid: process.pid, port, startedAt, open } satisfies DaemonFile));
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

/** The running daemon (its file, and a hub that answers on its port), or null. */
export async function findDaemon(): Promise<{ pid: number; port: number } | null> {
  let rec: DaemonFile;
  try {
    rec = JSON.parse(await fs.readFile(daemonFile(), "utf8")) as DaemonFile;
  } catch {
    return null;
  }
  try {
    // Every kraftwerk server answers /api/hub; only the daemon says it is one (a standalone `kraftwerk ui` may sit on that port now).
    const r = await fetch(`http://127.0.0.1:${rec.port}/api/hub`, { signal: AbortSignal.timeout(800) });
    const body = r.ok ? ((await r.json()) as { daemon?: unknown }) : null;
    return body?.daemon === true ? { pid: rec.pid, port: rec.port } : null;
  } catch {
    return null;
  }
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
