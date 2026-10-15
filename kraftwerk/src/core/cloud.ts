import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLOUD_DEFAULT_URL } from "../config.js";

/**
 * The kraftwerk cloud, machine side: the settings and the wire contract the
 * daemon's machine client (server/cloud.ts) and the CLI (`kraftwerk cloud`,
 * `login`, `logout`) share.
 *
 * The daemon registers this MACHINE once; the workspaces it serves ride
 * along as children of that record. The machine's id is its relay id (the
 * hash of the X25519 key in ~/.kraftwerk/relay.json) and the proof is the
 * relay secret — the key cannot sign. Nothing here opens the relay link.
 *
 * ~/.kraftwerk/cloud.json — the machine's switch and the cloud's origin:
 *
 *   { "enabled": false, "url": "https://cloud.example.com" }
 *
 * `enabled` absent = on. The origin: KRAFTWERK_CLOUD_URL (env) wins, then
 * cloud.json `url`, then a kraftwerk.yml `cloud.url` of an open workspace
 * (deprecated, one release), then the default. KRAFTWERK_CLOUD_URL=off
 * turns the cloud off for the process (what tests and CI set). kraftwerk.yml
 * `cloud.enabled: false` is a per-workspace veto: that workspace is left out
 * of the machine's reports.
 *
 * The contract (all POST, JSON):
 *
 *   /api/machines/register   {id, key, secret, name, handle, hostname?, platform?, version, interval?, workspaces}
 *                            → {ok, interval, claimCode|null, account|null}   (403: wrong secret)
 *   /api/machines/heartbeat  {id, secret, version?, workspaces?} → {ok, interval, account, claimCode}
 *   /api/machines/goodbye    {id, secret}
 *   /api/machines/unlink     {id, secret} → {ok, claimCode}
 *
 * workspaces: [{id?: "ws_…", name, slug, root?}] — `root` only once the
 * machine is claimed (account set): an unclaimed machine tells the cloud no
 * paths.
 */

export interface CloudFile {
  enabled?: boolean;
  url?: string;
}

/** Where the effective origin came from. */
export type CloudUrlSource = "env" | "cloud.json" | "kraftwerk.yml" | "default";

export interface MachineCloud {
  enabled: boolean;
  url: string;
  source: CloudUrlSource;
  /** Why it is off, when it is. */
  reason?: string;
}

export interface MachineWorkspace {
  id?: string;
  name: string;
  slug: string;
  root?: string;
}

export interface Credentials {
  id: string;
  key: string;
  secret: string;
}

export interface RegisterResponse {
  ok: boolean;
  interval: number;
  claimCode: string | null;
  account: string | null;
}

export interface HeartbeatResponse {
  ok: boolean;
  interval: number;
  account: string | null;
  claimCode: string | null;
}

export interface UnlinkResponse {
  ok: boolean;
  claimCode: string | null;
}

// Resolved on every use, not at import: a test swaps HOME after some module already imported this one.
const kwHome = (): string => path.join(os.homedir(), ".kraftwerk");
export const cloudFilePath = (): string => path.join(kwHome(), "cloud.json");
/** The retired per-workspace identities (before machines): deleted at the daemon's start. */
export const retiredCloudDir = (): string => path.join(kwHome(), "cloud");

export async function readCloudFile(): Promise<CloudFile> {
  try {
    const raw = JSON.parse(await fs.readFile(cloudFilePath(), "utf8")) as Record<string, unknown>;
    return {
      ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
      ...(typeof raw.url === "string" && raw.url ? { url: raw.url.replace(/\/+$/, "") } : {}),
    };
  } catch {
    return {};
  }
}

/** Merge a change into cloud.json (a `url: undefined` leaves the URL as it is). */
export async function writeCloudFile(change: CloudFile): Promise<CloudFile> {
  const cur = await readCloudFile();
  const next: CloudFile = { ...cur, ...(change.enabled !== undefined ? { enabled: change.enabled } : {}), ...(change.url ? { url: change.url.replace(/\/+$/, "") } : {}) };
  const file = cloudFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n");
  await fs.rename(tmp, file);
  return next;
}

/** Whether the environment turned the cloud off for this process. */
export const envCloudOff = (): boolean => process.env.KRAFTWERK_CLOUD_URL?.trim().toLowerCase() === "off";

/**
 * The machine's effective cloud. `ymlUrls`: `cloud.url` of open workspaces
 * (deprecated) — used only when neither the environment nor cloud.json names
 * an origin.
 */
export async function machineCloud(ymlUrls: string[] = []): Promise<MachineCloud> {
  const file = await readCloudFile();
  const env = process.env.KRAFTWERK_CLOUD_URL?.trim();
  const [url, source]: [string, CloudUrlSource] =
    env && !envCloudOff() ? [env, "env"] : file.url ? [file.url, "cloud.json"] : ymlUrls[0] ? [ymlUrls[0], "kraftwerk.yml"] : [CLOUD_DEFAULT_URL, "default"];
  const base = { url: url.replace(/\/+$/, ""), source };
  if (envCloudOff()) return { ...base, enabled: false, reason: "KRAFTWERK_CLOUD_URL=off" };
  if (file.enabled === false) return { ...base, enabled: false, reason: "turned off for this machine (`kraftwerk cloud on` turns it on)" };
  return { ...base, enabled: true };
}

export const claimUrlFor = (url: string, code: string | null | undefined): string | null => (code ? `${url}/claim/${encodeURIComponent(code)}` : null);

const REQUEST_TIMEOUT_MS = 8_000;
export const GOODBYE_TIMEOUT_MS = 800;

/** A refused or failed call; `status` is the HTTP status (0: no answer). */
export class CloudError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** The cloud no longer knows this machine (its data was reset): registering again fixes it. */
export const unknownMachine = (err: unknown): boolean =>
  err instanceof CloudError && (err.status === 404 || /unknown machine|not registered/i.test(err.message));

export async function cloudPost<T>(base: string, route: string, body: unknown, opts: { version?: string; timeout?: number } = {}): Promise<T> {
  const url = `${base}${route}`;
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": `kraftwerk/${opts.version ?? "dev"}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeout ?? REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new CloudError((err as Error).message, 0);
  }
  const text = await r.text();
  let data: { error?: string } & T;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new CloudError(`${r.status} from ${url}: not JSON`, r.status);
  }
  if (!r.ok) throw new CloudError(data.error ?? `${r.status} from ${url}`, r.status);
  return data;
}

/** What register says about the machine besides its credentials. */
export interface MachineHello {
  name: string;
  handle: string;
  hostname: string;
  platform: string;
  version: string;
}

export const machineRegister = (base: string, creds: Credentials, hello: MachineHello, workspaces: MachineWorkspace[]): Promise<RegisterResponse> =>
  cloudPost<RegisterResponse>(base, "/api/machines/register", { ...creds, ...hello, workspaces }, { version: hello.version });

export const machineHeartbeat = (base: string, creds: Credentials, extra: { version?: string; workspaces?: MachineWorkspace[] }): Promise<HeartbeatResponse> =>
  cloudPost<HeartbeatResponse>(base, "/api/machines/heartbeat", { id: creds.id, secret: creds.secret, ...extra }, { version: extra.version });

export const machineGoodbye = (base: string, creds: Credentials, version?: string): Promise<unknown> =>
  cloudPost(base, "/api/machines/goodbye", { id: creds.id, secret: creds.secret }, { version, timeout: GOODBYE_TIMEOUT_MS });

export const machineUnlink = (base: string, creds: Credentials, version?: string): Promise<UnlinkResponse> =>
  cloudPost<UnlinkResponse>(base, "/api/machines/unlink", { id: creds.id, secret: creds.secret }, { version });
