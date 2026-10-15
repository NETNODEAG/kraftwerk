import { promises as fs } from "node:fs";
import os from "node:os";
import { resolveWorkspace } from "../config.js";
import {
  claimUrlFor,
  machineCloud,
  machineGoodbye,
  machineHeartbeat,
  machineRegister,
  machineUnlink,
  retiredCloudDir,
  unknownMachine,
  type Credentials,
  type CloudUrlSource,
  type MachineWorkspace,
} from "../core/cloud.js";
import { identityString, readIdentity } from "../core/identity.js";
import { machineCredentials } from "./relay.js";

/**
 * The machine client: the daemon registers THIS MACHINE with the kraftwerk
 * cloud once and heartbeats while it runs; the workspaces it serves ride
 * along as children of that record (see core/cloud.ts for the contract and
 * the settings). One per process, and only the daemon starts it
 * (startMachineCloud from `kraftwerk daemon`): a standalone `kraftwerk ui`
 * and test fixtures never talk to the cloud.
 *
 *   start      ensure the machine key (relay.json, relay stays off), drop the
 *              retired per-workspace identities (~/.kraftwerk/cloud/), and,
 *              unless cloud.json or KRAFTWERK_CLOUD_URL=off says no, register
 *              — anonymous: the answer carries a claim code until someone
 *              claims the machine (`kraftwerk login`, or the code in the UI)
 *   heartbeat  every `interval` the cloud asked for; the workspace list rides
 *              along whenever it changed (opened, closed, vetoed, claimed).
 *              A claim made in the cloud arrives in the answer
 *   privacy    while unclaimed, entries carry name/slug/ws-id only — no
 *              roots; once claimed, roots too
 *   recovery   a cloud that no longer knows the machine (data reset) gets a
 *              fresh registration; a cloud that is down is retried at the
 *              same cadence and never affects the UI
 *   goodbye    on shutdown (bounded), and when `kraftwerk cloud off` reaches
 *              the running daemon
 */

export type CloudState = "off" | "connecting" | "connected" | "error";

export interface CloudStatus {
  url: string;
  state: CloudState;
  /** Why it is off, when it is. */
  reason?: string;
  /** Where the URL came from (env, cloud.json, a deprecated kraftwerk.yml cloud.url, the default). */
  source?: CloudUrlSource;
  /** Last error message while registering or heartbeating. */
  error?: string;
  /** The machine's id in the cloud (its relay id). */
  id?: string;
  /** This machine's handle@machine. */
  machine?: string;
  /** Email of the account that claimed the machine; null while unclaimed. */
  account?: string | null;
  /** Effective seconds between heartbeats (what the cloud asked for). */
  interval?: number;
  /** Last successful register or heartbeat. */
  lastSeen?: string;
  /** XXXX-XXXX that claims this machine in the cloud; null once claimed. */
  claimCode?: string | null;
  /** The cloud page that claims this machine after sign-in. */
  claimUrl?: string | null;
  /** Workspaces reported (vetoed ones left out). */
  workspaces?: number;
}

/** What the daemon serves right now. */
export type WorkspaceSource = () => Array<{ root: string; slug: string; name: string }>;

const DEFAULT_INTERVAL = 60;
const STANDALONE: CloudStatus = { url: "", state: "off", reason: "only the daemon registers this machine with the cloud (`kraftwerk daemon start`)" };

const m = {
  status: { ...STANDALONE } as CloudStatus,
  creds: null as Credentials | null,
  registered: false,
  timer: null as NodeJS.Timeout | null,
  started: false,
  owner: null as unknown,
  source: (() => []) as WorkspaceSource,
  version: "",
  /** The workspace list the cloud last acknowledged, as JSON: sent again only when it differs. */
  reported: "",
  /** One round at a time: a timer tick, a sync from the CLI and a workspace change never overlap. */
  lock: Promise.resolve() as Promise<unknown>,
  warned: new Set<string>(),
};

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = m.lock.then(fn, fn);
  m.lock = run.catch(() => {});
  return run;
}

export const cloudStatus = (): CloudStatus => m.status;

/** The open workspaces as the cloud lists them: vetoed ones left out, roots only once claimed. */
async function entries(withRoots: boolean): Promise<{ list: MachineWorkspace[]; ymlUrls: string[] }> {
  const list: MachineWorkspace[] = [];
  const ymlUrls: string[] = [];
  for (const o of m.source()) {
    const ws = await resolveWorkspace(o.root).catch(() => null);
    const c = ws?.config.cloud;
    if (c?.enabled === false) continue;
    if (c?.url) ymlUrls.push(c.url.replace(/\/+$/, ""));
    list.push({ ...(ws?.config.id ? { id: ws.config.id } : {}), name: o.name, slug: o.slug, ...(withRoots ? { root: o.root } : {}) });
  }
  return { list, ymlUrls };
}

const claimed = (): boolean => typeof m.status.account === "string" && m.status.account.length > 0;

function warnYml(cloud: { source: CloudUrlSource; url: string }, ymlUrls: string[]): void {
  if (!ymlUrls.length) return;
  const key = `${cloud.source}:${ymlUrls[0]}`;
  if (m.warned.has(key)) return;
  m.warned.add(key);
  if (cloud.source === "kraftwerk.yml") {
    console.warn(`⚠ kraftwerk.yml cloud.url is deprecated — the cloud is the machine's now: \`kraftwerk cloud on --url ${cloud.url}\` (using ${cloud.url} for now)`);
  } else {
    console.warn(`⚠ kraftwerk.yml cloud.url (${ymlUrls[0]}) is ignored: the machine's cloud is ${cloud.url} (${cloud.source}); remove it from kraftwerk.yml`);
  }
}

async function register(): Promise<boolean> {
  const { list, ymlUrls } = await entries(false);
  const cloud = await machineCloud(ymlUrls);
  warnYml(cloud, ymlUrls);
  if (!cloud.enabled) {
    m.status = { url: cloud.url, state: "off", source: cloud.source, ...(cloud.reason ? { reason: cloud.reason } : {}) };
    return false;
  }
  const identity = await readIdentity();
  try {
    m.creds ??= await machineCredentials();
  } catch (err) {
    m.status = { url: cloud.url, source: cloud.source, state: "error", error: (err as Error).message };
    return false;
  }
  const base = { url: cloud.url, source: cloud.source, id: m.creds.id, machine: identityString(identity) };
  if (m.status.state === "off" || m.status.url !== cloud.url) m.status = { ...base, state: "connecting" };
  try {
    const r = await machineRegister(cloud.url, m.creds, {
      name: identity.machine,
      handle: identity.handle,
      hostname: os.hostname(),
      platform: `${process.platform}-${process.arch}`,
      version: m.version,
    }, list);
    m.registered = true;
    // An unclaimed register carries no roots: the list counts as reported only when that is all the cloud should know.
    m.reported = r.account ? "" : JSON.stringify(list);
    m.status = {
      ...base, state: "connected", account: r.account ?? null, interval: r.interval || DEFAULT_INTERVAL, lastSeen: new Date().toISOString(),
      claimCode: r.claimCode ?? null, claimUrl: claimUrlFor(cloud.url, r.claimCode), workspaces: list.length,
    };
    // Already claimed: the roots follow at once.
    if (claimed()) await heartbeat();
    return true;
  } catch (err) {
    m.registered = false;
    m.status = { ...m.status, ...base, state: "error", error: (err as Error).message };
    return false;
  }
}

async function heartbeat(): Promise<void> {
  if (!m.creds || !m.registered) return;
  const wasClaimed = claimed();
  const { list } = await entries(wasClaimed);
  const now = JSON.stringify(list);
  try {
    const r = await machineHeartbeat(m.status.url, m.creds, { version: m.version, ...(now !== m.reported ? { workspaces: list } : {}) });
    m.reported = now;
    m.status = {
      ...m.status, state: "connected", error: undefined, interval: r.interval || m.status.interval || DEFAULT_INTERVAL, lastSeen: new Date().toISOString(),
      ...(r.account !== undefined ? { account: r.account } : {}),
      ...(r.claimCode !== undefined ? { claimCode: r.claimCode, claimUrl: claimUrlFor(m.status.url, r.claimCode) } : {}),
      workspaces: list.length,
    };
    // Just claimed: the roots go out now, not a whole interval later.
    if (!wasClaimed && claimed()) await heartbeat();
  } catch (err) {
    m.status = { ...m.status, state: "error", error: (err as Error).message };
    if (unknownMachine(err)) {
      m.registered = false;
      if (m.started) await register();
    }
  }
}

/** One round: register when not registered, else heartbeat. */
const round = (): Promise<void> => serial(async () => {
  if (!m.started) return;
  if (m.registered) await heartbeat();
  else await register();
});

function schedule(): void {
  if (m.timer) clearTimeout(m.timer);
  m.timer = null;
  if (!m.started || m.status.state === "off") return;
  const seconds = m.status.interval && m.status.interval > 0 ? m.status.interval : DEFAULT_INTERVAL;
  m.timer = setTimeout(async () => {
    m.timer = null;
    await round();
    schedule();
  }, seconds * 1000);
  m.timer.unref();
}

/**
 * Start the machine client (the daemon, once its workspaces are open).
 * Resolves after the first registration attempt; the heartbeat runs on its
 * own afterwards. A second start in the same process is ignored.
 */
export async function startMachineCloud(opts: { version: string; workspaces: WorkspaceSource; owner?: unknown }): Promise<CloudStatus> {
  if (m.started) return m.status;
  m.started = true;
  m.owner = opts.owner ?? null;
  m.source = opts.workspaces;
  m.version = opts.version;
  m.status = { url: "", state: "off" };
  // The per-workspace identities of before (one record per workspace) are retired with the machine record.
  await fs.rm(retiredCloudDir(), { recursive: true, force: true }).catch(() => {});
  // The machine's id exists from the daemon's first start on, with the relay still off.
  m.creds = await machineCredentials().catch(() => null);
  await serial(register);
  schedule();
  return m.status;
}

/**
 * Settings changed (`kraftwerk cloud on|off`, a URL): turn the client on or
 * off to match; off says goodbye first. Without a started client (a
 * standalone server) nothing happens.
 */
export async function applyMachineCloud(): Promise<CloudStatus> {
  if (!m.started) return m.status;
  const cloud = await machineCloud((await entries(false)).ymlUrls);
  if (!cloud.enabled || (m.registered && cloud.url !== m.status.url)) {
    await serial(async () => {
      if (m.registered && m.creds) await machineGoodbye(m.status.url, m.creds, m.version).catch(() => {});
      m.registered = false;
      m.reported = "";
    });
  }
  if (!cloud.enabled) {
    if (m.timer) clearTimeout(m.timer);
    m.timer = null;
    m.status = { url: cloud.url, state: "off", source: cloud.source, ...(cloud.reason ? { reason: cloud.reason } : {}) };
    return m.status;
  }
  if (!m.registered) await serial(register);
  schedule();
  return m.status;
}

/** A round now (the CLI's `login` waits for a claim): registers when needed, else heartbeats. */
export async function syncMachineCloud(): Promise<CloudStatus> {
  if (!m.started) return m.status;
  if (m.status.state === "off") return applyMachineCloud();
  await round();
  schedule();
  return m.status;
}

/** Release the claim (`kraftwerk logout`): the cloud hands out a fresh claim code. */
export async function unlinkMachineCloud(): Promise<CloudStatus> {
  if (!m.started || m.status.state === "off") return m.status;
  return serial(async () => {
    if (!m.registered) await register();
    if (!m.creds || !m.registered) throw new Error(m.status.error ?? "not registered with the cloud");
    const r = await machineUnlink(m.status.url, m.creds, m.version);
    // The next heartbeat sends the list again — without roots now.
    m.reported = "";
    m.status = { ...m.status, account: null, claimCode: r.claimCode ?? null, claimUrl: claimUrlFor(m.status.url, r.claimCode) };
    return m.status;
  });
}

/**
 * Stop the client and tell the cloud the machine is going away (bounded:
 * an exit handler waits for this). `owner`: only the client that owner
 * started (a hub stopping in a test leaves another's alone).
 */
export async function stopMachineCloud(owner?: unknown): Promise<void> {
  if (!m.started || (owner !== undefined && owner !== m.owner)) return;
  m.started = false;
  if (m.timer) clearTimeout(m.timer);
  m.timer = null;
  const { creds, registered } = m;
  const url = m.status.url;
  m.registered = false;
  m.reported = "";
  m.status = { ...STANDALONE };
  if (registered && creds && url) await machineGoodbye(url, creds, m.version).catch(() => {});
}
