import fsSync, { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Instance registry: every running inspector writes a small json file to
 * ~/.kraftwerk/instances/<pid>.json so other local instances can discover
 * it — the workspace switcher lists running workspaces automatically, no
 * kraftwerk.yml `switcher:` config needed. Registered ports are verified
 * by probing /api/meta on read (fresh name/icon, detects port reuse);
 * entries that stop answering are pruned, so crashes leave no ghosts.
 */

const DIR = path.join(os.homedir(), ".kraftwerk", "instances");

interface InstanceFile {
  pid: number;
  port: number;
  startedAt: string;
}

/** A verified running instance, shaped like a switcher entry. */
export interface DiscoveredInstance {
  name: string;
  url: string;
  icon?: string;
  live: true;
}

const selfFile = (): string => path.join(DIR, `${process.pid}.json`);

let selfPort: number | null = null;

/** Write this instance's registry file (call once the server listens). */
export async function registerInstance(port: number): Promise<void> {
  selfPort = port;
  try {
    await fs.mkdir(DIR, { recursive: true });
    const rec: InstanceFile = { pid: process.pid, port, startedAt: new Date().toISOString() };
    await fs.writeFile(selfFile(), JSON.stringify(rec));
  } catch {} // best-effort — without it discovery just won't see us
}

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
async function probe(port: number): Promise<DiscoveredInstance | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/meta?probe=1`, {
      signal: AbortSignal.timeout(400),
    });
    if (!r.ok) return null;
    const meta = (await r.json()) as { version?: string; projectName?: string; projectIcon?: string };
    if (typeof meta.version !== "string") return null; // some other app took the port
    return {
      name: meta.projectName || `localhost:${port}`,
      url: `http://localhost:${port}`,
      icon: meta.projectIcon || undefined,
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
    files = await fs.readdir(DIR);
  } catch {
    return [];
  }
  const probed = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        let rec: InstanceFile;
        try {
          rec = JSON.parse(await fs.readFile(path.join(DIR, f), "utf8")) as InstanceFile;
        } catch {
          return null;
        }
        if (rec.pid === process.pid || rec.port === selfPort) return null;
        const found = await probe(rec.port);
        if (!found) {
          await fs.unlink(path.join(DIR, f)).catch(() => {}); // stale — prune
          return null;
        }
        return found;
      })
  );
  const entries = probed
    .filter((e): e is DiscoveredInstance => e != null)
    .sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), entries };
  return entries;
}
