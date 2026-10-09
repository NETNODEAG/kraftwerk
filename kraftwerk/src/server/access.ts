import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import type { AccessConfig } from "../config.js";

/**
 * Cloudflare Access token verification for requests that arrive via the
 * public hostname. Access authenticates the browser at Cloudflare's edge and
 * forwards a signed JWT per request in Cf-Access-Jwt-Assertion; the signing
 * keys are public at https://<team>.cloudflareaccess.com/cdn-cgi/access/certs.
 * Verifying the token here means the inspector, which has no login of its
 * own, does not have to trust that the policy in the dashboard still exists.
 *
 * Dependency-free: RS256 over node:crypto. Keys are cached per team and
 * refetched when a token names an unknown key id (rotation), at most once
 * per REFETCH_INTERVAL so a flood of bogus tokens cannot hammer Cloudflare.
 */

export const ACCESS_HEADER = "cf-access-jwt-assertion";

const KEY_TTL = 60 * 60 * 1000;
const REFETCH_INTERVAL = 10 * 1000;
const FETCH_TIMEOUT = 5_000;

interface CachedKeys {
  keys: Map<string, KeyObject>;
  fetchedAt: number;
  /** When a token last named a key id we did not have (refetch throttle). */
  missedAt: number;
}

const cache = new Map<string, CachedKeys>();

export type AccessResult = { ok: true; email?: string } | { ok: false; reason: string };

/** Team domain Access issues tokens for. Tests override the certs location. */
export function teamDomain(team: string): string {
  return `https://${team}.cloudflareaccess.com`;
}

function certsUrl(team: string): string {
  return process.env.KRAFTWERK_ACCESS_CERTS_URL || `${teamDomain(team)}/cdn-cgi/access/certs`;
}

async function fetchKeys(team: string): Promise<Map<string, KeyObject>> {
  const res = await fetch(certsUrl(team), { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!res.ok) throw new Error(`certs endpoint answered ${res.status}`);
  const body = (await res.json()) as { keys?: Array<Record<string, unknown>> };
  const keys = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (typeof jwk.kid !== "string" || jwk.kty !== "RSA") continue;
    try {
      keys.set(jwk.kid, createPublicKey({ key: jwk as never, format: "jwk" }));
    } catch {
      // One malformed key must not take the rest down.
    }
  }
  return keys;
}

async function keyFor(team: string, kid: string): Promise<KeyObject | undefined> {
  const now = Date.now();
  let entry = cache.get(team);
  if (!entry || now - entry.fetchedAt > KEY_TTL) {
    entry = { keys: await fetchKeys(team), fetchedAt: now, missedAt: 0 };
    cache.set(team, entry);
  }
  const hit = entry.keys.get(kid);
  if (hit) return hit;
  if (now - entry.missedAt < REFETCH_INTERVAL) return undefined;
  entry.missedAt = now;
  entry.keys = await fetchKeys(team);
  entry.fetchedAt = now;
  return entry.keys.get(kid);
}

function decodeSegment(seg: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verify one Access token against the team's keys, the application's
 * audience and the clock. Returns a reason instead of throwing so the
 * caller can answer 401 with it; a certs fetch failure is a reason too
 * (fail closed).
 */
export async function verifyAccessToken(token: string, access: AccessConfig): Promise<AccessResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [h, p, s] = parts;
  const header = decodeSegment(h);
  const payload = decodeSegment(p);
  if (!header || !payload) return { ok: false, reason: "malformed token" };
  if (header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "unsupported token" };

  let key: KeyObject | undefined;
  try {
    key = await keyFor(access.team, header.kid);
  } catch (err) {
    return { ok: false, reason: `cannot fetch Access keys: ${(err as Error).message}` };
  }
  if (!key) return { ok: false, reason: "unknown signing key" };

  let valid = false;
  try {
    valid = verifySignature("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad signature" };

  if (payload.iss !== teamDomain(access.team)) return { ok: false, reason: "wrong issuer" };
  const aud = payload.aud;
  const audOk = Array.isArray(aud) ? aud.includes(access.aud) : aud === access.aud;
  if (!audOk) return { ok: false, reason: "wrong audience" };
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) return { ok: false, reason: "token expired" };
  if (typeof payload.nbf === "number" && payload.nbf > now) return { ok: false, reason: "token not yet valid" };

  return { ok: true, email: typeof payload.email === "string" ? payload.email : undefined };
}

/** Forget cached keys (tests). */
export function resetAccessKeys(): void {
  cache.clear();
}
