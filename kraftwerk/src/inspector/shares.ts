import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getOutputDir } from "./context.js";

/**
 * Agent shares: one link per agent that a customer can open, sign in to with
 * HTTP Basic, and chat through — without any of the inspector.
 *
 * A share is deliberately thin: a token in the URL, one username and one
 * password, and the agent slug it opens. It is not an account system. The
 * customer gets exactly one agent and its own threads; the admin API, the
 * other agents, the workspace and the settings are not reachable from the
 * share routes at all (see share-server.ts), rather than hidden by a flag.
 *
 * Shares live in `<output>/shares.json`, not in the git-tracked agent
 * definition: a share carries a password hash, and agents/ is committed.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LEN = 64;

export type ShareKind = "agent" | "channel";

export interface Share {
  /** URL token: `/s/<token>`. */
  token: string;
  /**
   * What the link opens. An agent share is a private space: its threads
   * belong to the link and nobody in the workspace posts in them. A channel
   * share hands out the channel's *one* ongoing transcript — everyone on
   * both sides reads the same history, which is the point and also the
   * caveat: give a customer a channel of their own.
   */
  kind: ShareKind;
  /** Slug of that agent or channel. */
  slug: string;
  user: string;
  salt: string;
  hash: string;
  /** Who it was made for ("ACME GmbH"), for the admin's own list. */
  label?: string;
  createdAt: string;
}

/** A share as the admin UI may see it — never the hash. */
export interface SharePublic {
  token: string;
  kind: ShareKind;
  slug: string;
  user: string;
  label?: string;
  createdAt: string;
}

export const toPublic = (s: Share): SharePublic => ({
  token: s.token,
  kind: s.kind ?? "agent",
  slug: s.slug,
  user: s.user,
  ...(s.label ? { label: s.label } : {}),
  createdAt: s.createdAt,
});

const storePath = (): string => path.join(getOutputDir(), "shares.json");

async function readAll(): Promise<Share[]> {
  try {
    const raw = JSON.parse(await fs.readFile(storePath(), "utf8"));
    return Array.isArray(raw) ? (raw as Share[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(shares: Share[]): Promise<void> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  // 0600: the file holds password hashes, and the output directory is not
  // otherwise private.
  await fs.writeFile(file, JSON.stringify(shares, null, 2) + "\n", { mode: 0o600 });
}

export async function listShares(): Promise<SharePublic[]> {
  return (await readAll()).map(toPublic);
}

export async function shareFor(kind: ShareKind, slug: string): Promise<SharePublic | null> {
  const hit = (await readAll()).find((s) => s.slug === slug && (s.kind ?? "agent") === kind);
  return hit ? toPublic(hit) : null;
}

export async function getShare(token: string): Promise<Share | null> {
  // Tokens are compared as opaque strings; a malformed one simply misses.
  return (await readAll()).find((s) => s.token === token) ?? null;
}

const newToken = (): string => randomBytes(18).toString("base64url");

/** A readable password: this gets typed by a person, once, from an email. */
function newPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length])
    .join("")
    .replace(/(.{4})(?=.)/g, "$1-");
}

/**
 * Create the agent's share, or replace it. Replacing rotates both the token
 * and the password, so the old link stops working — that is what revoking
 * access to one customer looks like when there is only one link.
 *
 * The plaintext password is returned once and never stored.
 */
export async function createShare(input: {
  kind: ShareKind;
  slug: string;
  label?: string;
  user?: string;
}): Promise<{ share: SharePublic; password: string }> {
  const password = newPassword();
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN);
  const share: Share = {
    token: newToken(),
    kind: input.kind,
    slug: input.slug,
    user: input.user?.trim() || "customer",
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
    ...(input.label?.trim() ? { label: input.label.trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  const all = (await readAll()).filter(
    (s) => !(s.slug === input.slug && (s.kind ?? "agent") === input.kind)
  );
  all.push(share);
  await writeAll(all);
  return { share: toPublic(share), password };
}

/** Revoke the share. Returns false when there was none. */
export async function deleteShare(kind: ShareKind, slug: string): Promise<boolean> {
  const all = await readAll();
  const left = all.filter((s) => !(s.slug === slug && (s.kind ?? "agent") === kind));
  if (left.length === all.length) return false;
  await writeAll(left);
  return true;
}

/**
 * Check an Authorization header against one share. Constant-time on the
 * hash; the username is compared the same way so a wrong user and a wrong
 * password are indistinguishable from outside.
 */
export async function verifyBasic(share: Share, header: string | undefined): Promise<boolean> {
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  const expectedUser = Buffer.from(share.user, "utf8");
  const gotUser = Buffer.from(user, "utf8");
  const userOk =
    expectedUser.length === gotUser.length && timingSafeEqual(expectedUser, gotUser);
  let hashOk = false;
  try {
    const expected = Buffer.from(share.hash, "base64");
    const got = await scrypt(password, Buffer.from(share.salt, "base64"), KEY_LEN);
    hashOk = expected.length === got.length && timingSafeEqual(expected, got);
  } catch {
    hashOk = false;
  }
  return userOk && hashOk;
}
