import { createHash, randomBytes, randomInt } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Paired devices: other machines — a phone's browser, a native app, a
 * second laptop — that may use this machine's kraftwerk without being on
 * it. One pairing covers every workspace here (the store is per machine,
 * ~/.kraftwerk/devices.json), like the daemon will.
 *
 * Pairing: someone on this machine creates a short-lived one-time code
 * (`kraftwerk devices pair`, or settings in the web UI); the device trades
 * it for its token (POST /api/pair). Tokens are 32 random bytes; the store
 * keeps only their SHA-256, so the file leaks nothing that grants access.
 * Revoking a device deletes its hash: the token stops working at once.
 */

export interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt?: string;
  /** Whether the device gets push notifications (its app registered for them). */
  push?: boolean;
}

/**
 * Where a device's push notifications go: its APNs token and environment, and
 * the key (32 bytes, base64) the device made for this machine — what is pushed
 * is sealed with it, so the relay and Apple carry it without reading it.
 */
export interface PushTarget {
  token: string;
  environment: "sandbox" | "production";
  key: string;
}

interface StoredDevice extends Device {
  tokenHash: string;
  pushTarget?: PushTarget;
}

interface PairCode {
  codeHash: string;
  expiresAt: string;
}

interface Store {
  devices: StoredDevice[];
  codes: PairCode[];
}

/** How long a pairing code works. */
export const PAIR_CODE_TTL_MS = 10 * 60_000;
/** No 0/O, 1/I/L: a code is read off one screen and typed into another. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const TOKEN_PREFIX = "kwd_";
/** lastSeenAt is written at most this often per device. */
const SEEN_EVERY_MS = 60_000;

const storeFile = (): string => path.join(os.homedir(), ".kraftwerk", "devices.json");
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
/** Codes compare case- and separator-insensitively: "abcd-efgh" is ABCDEFGH. */
const normalizeCode = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The store as last read, with the file's mtime: every request checks a token, so the file is re-read only when it changed. */
let cached: { mtimeMs: number; store: Store } | null = null;

async function read(): Promise<Store> {
  const file = storeFile();
  const st = await fs.stat(file).catch(() => null);
  if (!st) return { devices: [], codes: [] };
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.store;
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Store>;
    const store = { devices: Array.isArray(raw.devices) ? raw.devices : [], codes: Array.isArray(raw.codes) ? raw.codes : [] };
    cached = { mtimeMs: st.mtimeMs, store };
    return store;
  } catch {
    return { devices: [], codes: [] };
  }
}

async function write(store: Store): Promise<void> {
  const file = storeFile();
  const now = Date.now();
  store.codes = store.codes.filter((c) => Date.parse(c.expiresAt) > now);
  // Write-then-rename, owner-only: hashes grant nothing, but names and times are nobody else's business.
  // A temp name per write: two writes in flight must not rename each other's file.
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
  cached = null;
}

const LOCK_STALE_MS = 10_000;
let chain: Promise<unknown> = Promise.resolve();

/**
 * Change the store: read it fresh, apply `change`, write it — one change at
 * a time across every process on the machine (the servers of each workspace
 * and the CLI share the file). In-process changes queue; across processes an
 * O_EXCL lock file does, taken over when its holder died (older than 10 s).
 */
function update<T>(change: (store: Store) => T): Promise<T> {
  const run = chain.then(async () => {
    const file = storeFile();
    const lock = `${file}.lock`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    for (let attempt = 0; ; attempt++) {
      try {
        await (await fs.open(lock, "wx")).close();
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        const st = await fs.stat(lock).catch(() => null);
        if (st && Date.now() - st.mtimeMs > LOCK_STALE_MS) await fs.rm(lock, { force: true });
        else if (attempt > 200) throw new Error("the device store is locked — try again");
        else await new Promise((r) => setTimeout(r, 25));
      }
    }
    try {
      cached = null;
      const store = await read();
      const result = change(store);
      await write(store);
      return result;
    } finally {
      await fs.rm(lock, { force: true });
    }
  });
  chain = run.catch(() => {});
  return run;
}

const view = ({ tokenHash: _h, pushTarget, ...d }: StoredDevice): Device => ({ ...d, ...(pushTarget ? { push: true } : {}) });

/** A new one-time pairing code, valid for PAIR_CODE_TTL_MS. Shown once; the store keeps its hash. */
export async function createPairCode(): Promise<{ code: string; expiresAt: string }> {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MS).toISOString();
  await update((store) => store.codes.push({ codeHash: sha256(code), expiresAt }));
  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt };
}

/** Trade a pairing code for a device token. The code works once; a wrong or expired one is refused without saying which. */
export async function redeemPairCode(code: string, name: string): Promise<{ token: string; device: Device }> {
  const hash = sha256(normalizeCode(code));
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const device: StoredDevice = {
    id: randomBytes(6).toString("hex"),
    name: name.trim().slice(0, 60) || "device",
    createdAt: new Date().toISOString(),
    tokenHash: sha256(token),
  };
  const redeemed = await update((store) => {
    const now = Date.now();
    const i = store.codes.findIndex((c) => c.codeHash === hash && Date.parse(c.expiresAt) > now);
    if (i < 0) return false;
    store.codes.splice(i, 1);
    store.devices.push(device);
    return true;
  });
  if (!redeemed) throw new Error("invalid or expired pairing code");
  return { token, device: view(device) };
}

/** The device a token belongs to, or null. Notes when it was last seen (at most once a minute). */
export async function deviceForToken(token: string): Promise<Device | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const store = await read();
  const hash = sha256(token);
  const device = store.devices.find((d) => d.tokenHash === hash);
  if (!device) return null;
  const now = Date.now();
  if (!device.lastSeenAt || now - Date.parse(device.lastSeenAt) > SEEN_EVERY_MS) {
    const seen = new Date(now).toISOString();
    // Applied to the store as it is now, not to the copy read above: a pairing in between must survive.
    await update((fresh) => {
      const d = fresh.devices.find((x) => x.id === device.id);
      if (d) d.lastSeenAt = seen;
    }).catch(() => {});
    return view({ ...device, lastSeenAt: seen });
  }
  return view(device);
}

export async function listDevices(): Promise<Device[]> {
  return (await read()).devices.map(view);
}

/** Unpair a device: its token stops working at once. */
export async function revokeDevice(id: string): Promise<boolean> {
  return update((store) => {
    const before = store.devices.length;
    store.devices = store.devices.filter((d) => d.id !== id);
    return store.devices.length < before;
  });
}

/** Register (or, with null, drop) where a device's push notifications go. */
export async function setDevicePush(id: string, target: PushTarget | null): Promise<boolean> {
  return update((store) => {
    const d = store.devices.find((x) => x.id === id);
    if (!d) return false;
    if (target) d.pushTarget = target;
    else delete d.pushTarget;
    return true;
  });
}

/** Every device that gets push notifications, with where they go. */
export async function pushTargets(): Promise<Array<{ id: string; name: string } & PushTarget>> {
  return (await read()).devices.filter((d) => d.pushTarget).map((d) => ({ id: d.id, name: d.name, ...d.pushTarget! }));
}

/** Apple says a token is gone (the app was deleted): stop pushing to it. */
export async function dropPushToken(token: string): Promise<void> {
  await update((store) => {
    for (const d of store.devices) if (d.pushTarget?.token === token) delete d.pushTarget;
  });
}
