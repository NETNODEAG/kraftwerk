import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cloudFor, resolveWorkspace } from "../config.js";
import { workspaceRoot } from "../core/context.js";
import { perWorkspace, workspaceOpen } from "../core/workspace.js";
import { listAgents, toSummary } from "../core/agents.js";
import { listChannels, toChannelSummary } from "../core/channels.js";
import { tildify } from "../core/instances.js";

/**
 * The cloud manager client: kraftwerk.yml `cloud:` makes this instance
 * register with the kraftwerk cloud when the inspector starts and heartbeat
 * while it runs — the same record ~/.kraftwerk/instances holds locally,
 * kept on a server so an admin (and, with an account token, the user)
 * sees every instance across machines.
 *
 * Identity: the first registration hands out an id + secret, stored under
 * ~/.kraftwerk/cloud/<hash(url, root)>.json and presented on every later
 * call, so a restart updates the record instead of creating a new one.
 * When the cloud does not recognise the id (data reset) it hands out a
 * fresh one and the file is rewritten.
 *
 * Everything is best-effort: a cloud that is down never affects the UI.
 * The status is reported in /api/meta so the UI can show it.
 */

export type CloudState = "off" | "connecting" | "connected" | "error";

export interface CloudStatus {
  url: string;
  state: CloudState;
  /** Last error message while connecting or heartbeating. */
  error?: string;
  /** Instance id in the cloud once registered. */
  id?: string;
  /** Email of the linked kraftwerk account, when a token was presented and accepted. */
  account?: string | null;
  /** Effective seconds between heartbeats (the cloud may raise the configured one). */
  interval?: number;
  lastSeen?: string;
  /** XXXX-XXXX the user types into the cloud UI to claim this instance; null once claimed. */
  claimCode?: string | null;
  /** The cloud page that claims this instance after sign-in. */
  claimUrl?: string | null;
}

interface Identity {
  id: string;
  secret: string;
}

interface RegisterResponse {
  id: string;
  secret: string;
  interval: number;
  account: string | null;
  claimCode?: string | null;
  created: boolean;
}

interface HeartbeatResponse {
  ok: true;
  interval: number;
  account?: string | null;
  claimCode?: string | null;
}

const claimUrlFor = (url: string, code: string | null | undefined): string | null => (code ? `${url}/claim/${encodeURIComponent(code)}` : null);

const REQUEST_TIMEOUT_MS = 8_000;
const GOODBYE_TIMEOUT_MS = 800;

/** The client's state, one per workspace: each served workspace registers and heartbeats on its own. */
const client = perWorkspace(() => ({
  status: { url: "", state: "off" } as CloudStatus,
  identity: null as Identity | null,
  timer: null as NodeJS.Timeout | null,
  stopped: false,
  lastRoster: "",
  /** Where this workspace is reached on this machine, as the cloud lists it. */
  selfUrl: "",
  selfVersion: "",
  startedAt: new Date().toISOString(),
}));

export const cloudStatus = (): CloudStatus => client().status;

const cloudDir = (): string => path.join(os.homedir(), ".kraftwerk", "cloud");
const identityFile = (url: string, root: string): string =>
  path.join(cloudDir(), `${createHash("sha1").update(`${url}\n${root}`).digest("hex").slice(0, 16)}.json`);

async function readIdentity(file: string): Promise<Identity | null> {
  try {
    const rec = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Identity>;
    return typeof rec.id === "string" && typeof rec.secret === "string" ? { id: rec.id, secret: rec.secret } : null;
  } catch {
    return null;
  }
}

async function writeIdentity(file: string, url: string, root: string, id: Identity): Promise<void> {
  try {
    await fs.mkdir(cloudDir(), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ ...id, url, root, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  } catch {} // best-effort — the next start registers again
}

/** The agents and channels of this workspace, as the cloud lists them. */
async function roster(): Promise<{ agents: unknown[]; channels: unknown[] }> {
  const [agents, channels] = await Promise.all([
    listAgents().then((l) => l.map(toSummary)).catch(() => []),
    listChannels().then((l) => l.map(toChannelSummary)).catch(() => []),
  ]);
  return { agents, channels };
}

async function post<T>(url: string, body: unknown, timeout = REQUEST_TIMEOUT_MS): Promise<T> {
  const c = client();
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": `kraftwerk/${c.selfVersion}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  let data: { error?: string } & T;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${r.status} from ${url}: not JSON`);
  }
  if (!r.ok) throw new Error(data.error ?? `${r.status} from ${url}`);
  return data;
}

/** Register (or re-register) this instance. Returns false when the cloud refused or is unreachable. */
async function register(): Promise<boolean> {
  const c = client();
  const project = await resolveWorkspace(workspaceRoot()).catch(() => null);
  const cloud = project ? cloudFor(project) : undefined;
  if (!project || !cloud) return false;
  const file = identityFile(cloud.url, project.root);
  c.identity ??= await readIdentity(file);
  const { agents, channels } = await roster();
  c.lastRoster = JSON.stringify({ agents, channels });
  const body = {
    ...(c.identity ?? {}),
    name: project.config.name ?? path.basename(project.root),
    icon: project.config.icon ?? "",
    color: project.config.color ?? "",
    root: project.root,
    rootLabel: tildify(project.root),
    hostname: os.hostname(),
    platform: `${process.platform}-${process.arch}`,
    version: c.selfVersion,
    url: c.selfUrl,
    // Part of the cloud's register contract; always "" since the Cloudflare Tunnel was removed (0.65).
    publicUrl: "",
    agents,
    channels,
    interval: cloud.interval,
    startedAt: c.startedAt,
    ...(cloud.token ? { accountToken: cloud.token } : {}),
  };
  try {
    const r = await post<RegisterResponse>(`${cloud.url}/api/instances/register`, body);
    if (!c.identity || c.identity.id !== r.id || c.identity.secret !== r.secret) {
      c.identity = { id: r.id, secret: r.secret };
      await writeIdentity(file, cloud.url, project.root, c.identity);
    }
    c.status = {
      url: cloud.url, state: "connected", id: r.id, account: r.account, interval: r.interval, lastSeen: new Date().toISOString(),
      claimCode: r.claimCode ?? null, claimUrl: claimUrlFor(cloud.url, r.claimCode),
    };
    return true;
  } catch (err) {
    c.status = { url: cloud.url, state: "error", error: (err as Error).message, ...(c.identity ? { id: c.identity.id } : {}) };
    return false;
  }
}

async function heartbeat(): Promise<void> {
  const c = client();
  if (!c.identity || c.status.state === "off") return;
  const { agents, channels } = await roster();
  const rosterNow = JSON.stringify({ agents, channels });
  const body = {
    ...c.identity,
    version: c.selfVersion,
    ...(rosterNow !== c.lastRoster ? { agents, channels } : {}),
  };
  try {
    const r = await post<HeartbeatResponse>(`${c.status.url}/api/instances/heartbeat`, body);
    c.lastRoster = rosterNow;
    c.status = {
      ...c.status, state: "connected", error: undefined, interval: r.interval, lastSeen: new Date().toISOString(),
      ...(r.account !== undefined ? { account: r.account } : {}),
      ...(r.claimCode !== undefined ? { claimCode: r.claimCode, claimUrl: claimUrlFor(c.status.url, r.claimCode) } : {}),
    };
  } catch (err) {
    const message = (err as Error).message;
    c.status = { ...c.status, state: "error", error: message };
    // An unknown identity (the cloud lost it) is fixed by registering again, which hands out a new one.
    if (/unknown instance|wrong instance secret|id and secret required/.test(message)) {
      c.identity = null;
      // Not after a goodbye: a stopped client registers nothing again.
      if (!c.stopped && workspaceOpen()) await register();
    }
  }
}

/** Schedule the next tick after the effective interval; a failed cloud is retried at the same cadence. */
function schedule(): void {
  const c = client();
  if (c.stopped) return;
  const seconds = c.status.interval && c.status.interval > 0 ? c.status.interval : 60;
  c.timer = setTimeout(async () => {
    // Stopped (or the workspace closed) while this timer waited, or while the call below ran: no next round.
    if (c.stopped || !workspaceOpen()) return;
    if (c.status.state === "connected" || c.status.state === "error") {
      if (c.identity) await heartbeat();
      else await register();
    }
    if (!c.stopped && workspaceOpen()) schedule();
  }, seconds * 1000);
  c.timer.unref();
}

/**
 * Start the client once the inspector listens. Resolves after the first
 * registration attempt (success or not); the heartbeat loop runs on its
 * own afterwards.
 */
export async function startCloudSync(url: string, version: string): Promise<void> {
  const c = client();
  c.selfUrl = url;
  c.selfVersion = version;
  c.stopped = false;
  const project = await resolveWorkspace(workspaceRoot()).catch(() => null);
  const cloud = project ? cloudFor(project) : undefined;
  if (!cloud) {
    c.status = { url: "", state: "off" };
    return;
  }
  // The workspace may close (or the client stop) while this waits: then it does not register or schedule at all.
  if (c.stopped || !workspaceOpen()) return;
  c.status = { url: cloud.url, state: "connecting", interval: cloud.interval };
  await register();
  if (c.stopped || !workspaceOpen()) return;
  // Until the cloud answers, retry at the configured cadence; once it does, at what it asked for.
  if (c.status.state !== "connected") c.status.interval = cloud.interval;
  schedule();
}

/** Stop the heartbeat loop (server close, tests). */
export function stopCloudSync(): void {
  const c = client();
  c.stopped = true;
  if (c.timer) clearTimeout(c.timer);
  c.timer = null;
}

/**
 * Tell the cloud we are going away, so the record flips to "stopped" now
 * instead of after the grace period. Bounded: an exit handler waits for
 * this, and a slow cloud must not hold the process.
 */
export async function cloudGoodbye(): Promise<void> {
  const c = client();
  stopCloudSync();
  if (!c.identity || c.status.state === "off" || !c.status.url) return;
  try {
    await post(`${c.status.url}/api/instances/goodbye`, c.identity, GOODBYE_TIMEOUT_MS);
  } catch {}
}

/** Every served workspace: stop its heartbeat (the server closes). */
export function stopAllCloudSync(): void {
  for (const [ws] of client.entries()) ws.run(stopCloudSync);
}

/** Every served workspace says goodbye, in parallel (still bounded per workspace). */
export async function cloudGoodbyeAll(): Promise<void> {
  await Promise.all(client.entries().map(([ws]) => ws.run(cloudGoodbye)));
}
