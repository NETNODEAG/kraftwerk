import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Who and where this kraftwerk is: ~/.kraftwerk/identity.json, one per
 * machine (every workspace here shares it).
 *
 *   { "handle": "lukas", "machine": "mbp", "previous": ["lukas@old-name"] }
 *
 * The identity string is `handle@machine`. A workspace is git-shared, its
 * run state is not, so a routine names the one identity that fires it
 * (`runs_on:` in routines.yml) — without that every clone would fire it.
 *
 * Defaults come from the OS (user name, host name without its domain) and
 * are written the first time they are read: macOS changes the host name
 * with the network, and an identity that drifts with it would silently stop
 * every routine assigned to this machine. Renaming appends the retired pair
 * to `previous`, so routines that still name it can be found and healed.
 */

export interface Identity {
  handle: string;
  machine: string;
  /** Retired `handle@machine` pairs, oldest first. */
  previous: string[];
}

/** One half of an identity: lowercase, no "@". */
export const IDENTITY_PART_RE = /^[a-z0-9._-]+$/;
/** How many retired pairs are kept. */
const MAX_PREVIOUS = 10;

// Resolved on every use, not at import: a test swaps HOME after some module already imported this one.
const identityFile = (): string => path.join(os.homedir(), ".kraftwerk", "identity.json");

/** A free-form name as an identity half: lowercase, anything outside [a-z0-9._-] becomes "-". */
function sanitize(raw: string, fallback: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return s || fallback;
}

/** The OS user name. */
export function defaultHandle(): string {
  let name = "";
  try {
    name = os.userInfo().username;
  } catch {
    name = process.env.USER ?? process.env.USERNAME ?? "";
  }
  return sanitize(name, "user");
}

/** The host name, lowercased, without `.local` or a domain; anything outside [a-z0-9-] becomes "-". */
export function defaultMachine(hostname = os.hostname()): string {
  const host = hostname.toLowerCase().split(".")[0] ?? "";
  const s = host.replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  return s || "machine";
}

/** Why a handle or machine name is refused, or undefined when it is fine. */
export function identityPartError(label: "handle" | "machine", value: string): string | undefined {
  if (!value) return `${label} must not be empty`;
  if (value.includes("@")) return `${label} must not contain "@" (the identity is handle@machine)`;
  if (!IDENTITY_PART_RE.test(value)) return `${label} must be lowercase letters, digits, ".", "_" or "-"`;
  return undefined;
}

/** `handle@machine` with both halves well-formed: what `runs_on:` must look like. */
export function isIdentityString(value: string): boolean {
  const parts = value.split("@");
  return parts.length === 2 && IDENTITY_PART_RE.test(parts[0]) && IDENTITY_PART_RE.test(parts[1]);
}

export const identityString = (id: Pick<Identity, "handle" | "machine">): string => `${id.handle}@${id.machine}`;

async function write(id: Identity): Promise<void> {
  const file = identityFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  // A temp name per write: two writers in flight must not rename each other's file.
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(id, null, 2) + "\n");
  await fs.rename(tmp, file);
}

/**
 * This machine's identity. A missing file gets the OS defaults, written so
 * they stay put; a damaged field falls back to its default without being
 * written over (a person may be halfway through editing the file).
 */
export async function readIdentity(): Promise<Identity> {
  let raw: Partial<Identity> | null = null;
  try {
    raw = JSON.parse(await fs.readFile(identityFile(), "utf8")) as Partial<Identity>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") raw = {};
  }
  const handle = typeof raw?.handle === "string" && !identityPartError("handle", raw.handle) ? raw.handle : defaultHandle();
  const machine = typeof raw?.machine === "string" && !identityPartError("machine", raw.machine) ? raw.machine : defaultMachine();
  const previous = Array.isArray(raw?.previous) ? raw.previous.filter((p): p is string => typeof p === "string" && isIdentityString(p)) : [];
  const id = { handle, machine, previous };
  if (raw === null) await write(id).catch(() => {});
  return id;
}

/** This machine's `handle@machine`. */
export async function localIdentity(): Promise<string> {
  return identityString(await readIdentity());
}

/** Change the handle and/or machine name; the pair it replaces goes to `previous`. */
export async function setIdentity(change: { handle?: string; machine?: string }): Promise<Identity> {
  for (const label of ["handle", "machine"] as const) {
    const v = change[label];
    if (v === undefined) continue;
    const err = identityPartError(label, v);
    if (err) throw new Error(err);
  }
  const cur = await readIdentity();
  const next: Identity = { handle: change.handle ?? cur.handle, machine: change.machine ?? cur.machine, previous: cur.previous };
  const before = identityString(cur);
  const after = identityString(next);
  if (before !== after) {
    next.previous = [...cur.previous.filter((p) => p !== before && p !== after), before].slice(-MAX_PREVIOUS);
  }
  await write(next);
  return next;
}
