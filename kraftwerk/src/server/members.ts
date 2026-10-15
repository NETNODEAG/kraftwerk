import { createHash, randomBytes } from "node:crypto";
import { CloudError, memberVerify, type MemberVerdict } from "../core/cloud.js";
import { machineLink, servedWorkspace } from "./cloud.js";

/**
 * Remote members: people who joined a workspace by invite in the cloud and
 * have no clone of it. They hold a workspace-scoped member token (`kwm_…`)
 * and reach the workspace through the relay: their app opens the encrypted
 * channel (server/relay.ts) and, as its first sealed message, presents
 *
 *   → {t:"auth", memberToken: "kwm_…", workspaceId: "ws_…"}
 *   ← {t:"auth", ok: true, member: {email, handle, role}, workspace: {id, slug, name}}
 *   ← {t:"auth", ok: false, error}                      and the channel closes
 *
 * instead of a paired device's token. This daemon asks the cloud
 * (/api/members/verify, with the machine's credentials) and caches the
 * answer per (token, workspace) for five minutes — short, because revoking
 * a member kills their tokens in the cloud at once, and the cache is all
 * that keeps them in until it expires:
 *
 *   fresh        within the TTL the cache answers, the cloud is not asked
 *   expired      a live session re-verifies lazily with its next request
 *   unreachable  the cloud down, a 5xx, no machine client: a cached entry is
 *                KEPT and used (stale); without one the session is refused
 *   revoked      404 (unknown or revoked token) or 403 (this machine does not
 *                host the workspace) drops the entry, and the session with it
 *
 * A session is scoped to that one workspace: the relay tags each of its
 * requests with the session's random id (MEMBER_HEADER), which only this
 * process knows, and trust.ts turns the tag into `member` trust; server.ts
 * and router.ts refuse everything outside the workspace. Paired devices are
 * untouched — machine-wide, as before.
 */

export type Member = MemberVerdict;

/** The header the relay puts on a member session's requests (a client's own is dropped). */
export const MEMBER_HEADER = "x-kraftwerk-member";

const DEFAULT_TTL_MS = 5 * 60_000;
let ttlMs = DEFAULT_TTL_MS;

/** How long a verified answer counts as fresh — tests shorten it; no argument restores the default. */
export function setMemberCacheTtl(ms?: number): void {
  ttlMs = ms ?? DEFAULT_TTL_MS;
}

interface Cached {
  member: Member;
  at: number;
}

/** By sha256(token) + workspace: the cache keeps no token in the clear. */
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Verdict>>();

/** Forget every cached answer (tests). */
export function forgetMemberCache(): void {
  cache.clear();
}

export type Verdict =
  | { ok: true; member: Member; stale?: true }
  /** `drop`: the cloud said no (the session ends); otherwise it could not be asked. */
  | { ok: false; error: string; drop: boolean };

const keyOf = (token: string, workspaceId: string): string => `${createHash("sha256").update(token).digest("hex")}\0${workspaceId}`;

const ROLES = new Set(["owner", "member"]);

function asMember(v: unknown): Member | null {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.email !== "string" || typeof o.handle !== "string" || !ROLES.has(String(o.role))) return null;
  return { email: o.email, handle: o.handle, role: o.role as Member["role"] };
}

/** Whether `token` is a member of `workspaceId`: the cache within its TTL, else the cloud. */
export function verifyMember(token: string, workspaceId: string): Promise<Verdict> {
  const key = keyOf(token, workspaceId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve({ ok: true, member: hit.member });
  const running = inflight.get(key);
  if (running) return running;
  const run = (async (): Promise<Verdict> => {
    const stale = (why: string): Verdict => {
      const kept = cache.get(key);
      return kept ? { ok: true, member: kept.member, stale: true } : { ok: false, error: why, drop: false };
    };
    const link = machineLink();
    if (!link) return stale("this machine is not connected to the kraftwerk cloud — members cannot be verified");
    try {
      const member = asMember(await memberVerify(link.url, link.creds, token, workspaceId, link.version));
      if (!member) return stale("the cloud's answer about the member was not understood");
      cache.set(key, { member, at: Date.now() });
      return { ok: true, member };
    } catch (err) {
      const status = err instanceof CloudError ? err.status : 0;
      if (status === 401 || status === 403 || status === 404) {
        cache.delete(key);
        const why = status === 403 ? "this machine does not host that workspace" : "unknown or revoked member token";
        return { ok: false, error: `${why}${(err as Error).message ? ` (${(err as Error).message})` : ""}`, drop: true };
      }
      return stale(`could not reach the kraftwerk cloud to verify the member: ${(err as Error).message}`);
    }
  })();
  inflight.set(key, run);
  void run.finally(() => inflight.delete(key));
  return run;
}

/* ---------- sessions ---------- */

interface Session {
  token: string;
  workspaceId: string;
  slug: string;
  name: string;
  member: Member;
}

const sessions = new Map<string, Session>();

const WS_ID = /^ws_[A-Za-z0-9_-]{1,64}$/;

/**
 * A member's hello: verify the token for the workspace, find the workspace
 * this daemon serves under that id, and open a session. Its id is what the
 * relay tags the session's requests with.
 */
export async function openMemberSession(
  token: unknown,
  workspaceId: unknown,
): Promise<{ ok: true; id: string; member: Member; workspace: { id: string; slug: string; name: string } } | { ok: false; error: string }> {
  if (typeof token !== "string" || !token.startsWith("kwm_") || token.length > 512) return { ok: false, error: "memberToken must be a kwm_… member token" };
  if (typeof workspaceId !== "string" || !WS_ID.test(workspaceId)) return { ok: false, error: "workspaceId must be a ws_… workspace id" };
  const v = await verifyMember(token, workspaceId);
  if (!v.ok) return { ok: false, error: v.error };
  const ws = await servedWorkspace(workspaceId);
  if (!ws) return { ok: false, error: "this machine does not serve that workspace right now" };
  const id = randomBytes(24).toString("base64url");
  sessions.set(id, { token, workspaceId, slug: ws.slug, name: ws.name, member: v.member });
  return { ok: true, id, member: v.member, workspace: { id: workspaceId, slug: ws.slug, name: ws.name } };
}

/** The session behind a request's tag, or undefined. */
export function memberSession(id: string): { member: Member; workspaceId: string; slug: string } | undefined {
  const s = sessions.get(id);
  return s ? { member: s.member, workspaceId: s.workspaceId, slug: s.slug } : undefined;
}

/**
 * Before each of a session's requests: still a member? Within the TTL this
 * is the cache; past it, the cloud (a cloud that cannot be reached keeps the
 * cached answer). A refusal ends the session.
 */
export async function checkMemberSession(id: string): Promise<{ ok: true } | { ok: false; error: string; ended: boolean }> {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: "the member session ended", ended: true };
  const v = await verifyMember(s.token, s.workspaceId);
  if (!v.ok && v.drop) {
    sessions.delete(id);
    return { ok: false, error: v.error, ended: true };
  }
  if (!v.ok) return { ok: false, error: v.error, ended: false };
  s.member = v.member;
  // The workspace may have been reopened under another slug meanwhile.
  const ws = await servedWorkspace(s.workspaceId);
  if (ws) s.slug = ws.slug;
  return { ok: true };
}

export function closeMemberSession(id: string): void {
  sessions.delete(id);
}
