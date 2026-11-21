import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { CloudError, signinExchange, signinUrl, signinVerify, type CloudUser } from "../core/cloud.js";
import { log } from "../core/log.js";
import { machineLink } from "./cloud.js";

/**
 * People signing in to a workspace's UI — kraftwerk.yml `users: cloud`.
 *
 * The browser on this machine is sent to the cloud (/signin), where the
 * account confirms; the cloud sends it back to /auth/callback with a
 * one-time code, which this daemon redeems with the machine's own secret
 * (core/cloud.ts signinExchange). The answer — the account's uuid, email,
 * handle and role on the workspace — becomes a session:
 *
 *   cookie   kw_user (HttpOnly, SameSite=Lax), per origin: <slug>.localhost
 *            is its own, the path form /w/<slug>/ shares localhost's
 *   at rest  ~/.kraftwerk/user-sessions.json, the cookie only as its sha256,
 *            so a daemon restart signs nobody out
 *   scope    one session may hold several workspaces (the path form): each
 *            is signed in to on its own, by the same account
 *   lifetime 30 days; every 15 minutes the cloud is asked again whether
 *            the account is still on the workspace (removing a member
 *            reaches the UI they are signed in to). A cloud that cannot be
 *            reached keeps the session as it is
 *
 * The state of a sign-in in flight is bound to the browser that started it
 * (the kw_signin cookie) and lives ten minutes.
 *
 * `kraftwerk join` skips the round through the cloud: the link it was run
 * with already proved the account (the cloud claimed this machine for it),
 * so the daemon asks the cloud once more who that account is on the
 * workspace (signinVerify) and hands the browser it opens a one-time
 * /auth/handoff link — single use, five minutes — that becomes the session.
 */

export const USER_COOKIE = "kw_user";
const STATE_COOKIE = "kw_signin";
const SESSION_TTL_MS = 30 * 24 * 3600_000;
const STATE_TTL_MS = 10 * 60_000;
const DEFAULT_RECHECK_MS = 15 * 60_000;
let recheckMs = DEFAULT_RECHECK_MS;

/** How often a signed-in person is checked with the cloud again — tests shorten it; no argument restores the default. */
export function setUserRecheck(ms?: number): void {
  recheckMs = ms ?? DEFAULT_RECHECK_MS;
}

export interface SignedIn {
  user: CloudUser;
  role: "owner" | "member";
}

interface Session {
  user: CloudUser;
  createdAt: number;
  /** Per ws_ id: the role, and when the cloud last confirmed it. */
  workspaces: Record<string, { role: "owner" | "member"; checkedAt: number }>;
}

const HANDOFF_TTL_MS = 5 * 60_000;
const handoffs = new Map<string, { workspaceId: string; user: CloudUser; role: "owner" | "member"; at: number }>();

/**
 * A one-time sign-in for `accountId` on `workspaceId`, confirmed by the cloud
 * now: the token for /auth/handoff?t=…. Null when the cloud does not confirm.
 */
export async function issueHandoff(workspaceId: string, accountId: string): Promise<string | null> {
  const link = machineLink();
  if (!link) return null;
  let r: { user: CloudUser; role: "owner" | "member" };
  try {
    r = await signinVerify(link.url, link.creds, workspaceId, accountId, link.version);
  } catch {
    return null;
  }
  for (const [k, h] of handoffs) if (Date.now() - h.at > HANDOFF_TTL_MS) handoffs.delete(k);
  const token = randomBytes(32).toString("base64url");
  handoffs.set(hash(token), { workspaceId, user: r.user, role: r.role, at: Date.now() });
  return token;
}

interface Pending {
  workspaceId: string;
  redirect: string;
  next: string;
  at: number;
}

const file = (): string => path.join(os.homedir(), ".kraftwerk", "user-sessions.json");
const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

let sessions: Map<string, Session> | null = null;
let loadedFrom = "";
const pending = new Map<string, Pending>();
const rechecks = new Map<string, Promise<void>>();

async function load(): Promise<Map<string, Session>> {
  // HOME may change between tests; a different file is a different store.
  if (sessions && loadedFrom === file()) return sessions;
  loadedFrom = file();
  sessions = new Map();
  try {
    const raw = JSON.parse(await fs.readFile(loadedFrom, "utf8")) as Record<string, Session>;
    const now = Date.now();
    for (const [k, s] of Object.entries(raw)) if (s?.user?.id && now - s.createdAt < SESSION_TTL_MS) sessions.set(k, s);
  } catch {}
  return sessions;
}

let writing: Promise<void> = Promise.resolve();
function save(): Promise<void> {
  const target = loadedFrom;
  const data = JSON.stringify(Object.fromEntries(sessions ?? []), null, 2) + "\n";
  writing = writing.then(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, target);
  }).catch((err) => log("warn", "users", `could not store the sign-in sessions: ${(err as Error).message}`));
  return writing;
}

export function cookieOf(req: http.IncomingMessage, name: string): string | undefined {
  const c = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.slice(name.length + 1)) : undefined;
}

const cookie = (name: string, value: string, maxAgeS: number): string => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}`;

/**
 * Whether the request comes from a browser. Browsers say where a fetch came
 * from (Sec-Fetch-Site, -Dest) and call themselves Mozilla/…; Node's fetch
 * (the CLI) sends Sec-Fetch-Mode only, curl none of them.
 */
export const fromBrowser = (req: http.IncomingMessage): boolean =>
  !!(req.headers["sec-fetch-site"] || req.headers["sec-fetch-dest"]) || /^Mozilla\//.test(String(req.headers["user-agent"] ?? ""));

/** Re-ask the cloud about a session's workspace (once at a time); a refusal drops it, an outage keeps it. */
function recheck(key: string, s: Session, workspaceId: string): Promise<void> {
  const k = `${key}\0${workspaceId}`;
  const running = rechecks.get(k);
  if (running) return running;
  const run = (async () => {
    const link = machineLink();
    if (!link) return;
    try {
      const r = await signinVerify(link.url, link.creds, workspaceId, s.user.id, link.version);
      s.user = { id: s.user.id, email: r.user.email, handle: r.user.handle };
      s.workspaces[workspaceId] = { role: r.role, checkedAt: Date.now() };
    } catch (err) {
      const status = err instanceof CloudError ? err.status : 0;
      if (status === 401 || status === 403 || status === 404) {
        delete s.workspaces[workspaceId];
        log("info", "users", `${s.user.handle} is no longer on ${workspaceId}: signed out there`);
      } else return;
    }
    await save();
  })();
  rechecks.set(k, run);
  void run.finally(() => rechecks.delete(k));
  return run;
}

/** Who the request's browser is signed in as on workspace `workspaceId`, or null. */
export async function signedIn(req: http.IncomingMessage, workspaceId: string): Promise<SignedIn | null> {
  const token = cookieOf(req, USER_COOKIE);
  if (!token) return null;
  const all = await load();
  const key = hash(token);
  const s = all.get(key);
  if (!s) return null;
  if (Date.now() - s.createdAt >= SESSION_TTL_MS) {
    all.delete(key);
    await save();
    return null;
  }
  let ws = s.workspaces[workspaceId];
  if (!ws) return null;
  if (Date.now() - ws.checkedAt >= recheckMs) {
    await recheck(key, s, workspaceId);
    ws = s.workspaces[workspaceId];
    if (!ws) return null;
  }
  return { user: s.user, role: ws.role };
}

function redirect(res: http.ServerResponse, location: string, cookies: string[] = []): void {
  res.writeHead(302, { location, "cache-control": "no-store", ...(cookies.length ? { "set-cookie": cookies } : {}) });
  res.end();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A small page for what went wrong, with the way back in. */
function problem(res: http.ServerResponse, status: number, title: string, text: string, retry?: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>kraftwerk — sign in</title>` +
      `<style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 16px}code{font-size:14px}a{color:#5b4bd5}</style>` +
      `<h1>${esc(title)}</h1><p>${esc(text)}</p>${retry ? `<p><a href="${esc(retry)}">sign in again</a></p>` : ""}`,
  );
}

/** A path on this origin to come back to: absolute, no scheme-relative trick. */
const safeNext = (raw: string | null, prefix: string): string => (raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : `${prefix}/`);

export interface SigninTarget {
  /** The workspace's ws_ id (kraftwerk.yml `id`). */
  workspaceId: string | undefined;
  name: string;
  /** "/w/<slug>" in the path form, else "". */
  prefix: string;
}

/**
 * /auth/signin, /auth/callback, /auth/signout for a `users: cloud`
 * workspace. Returns false for any other path.
 */
export async function handleAuth(req: http.IncomingMessage, res: http.ServerResponse, url: URL, t: SigninTarget): Promise<boolean> {
  const route = url.pathname;
  const signinPath = `${t.prefix}/auth/signin`;
  if (route === "/auth/signin" && (req.method === "GET" || req.method === "HEAD")) {
    if (!t.workspaceId) {
      problem(res, 409, "This workspace has no id", "users: cloud signs people in to a workspace the cloud knows by its id. Add one with `kraftwerk doctor --fix` (it writes id: ws_… into kraftwerk.yml).");
      return true;
    }
    const link = machineLink();
    if (!link) {
      problem(res, 503, "Signing in needs the kraftwerk cloud", "This workspace signs people in with their kraftwerk cloud account, and this machine is not connected to the cloud. Start the daemon (`kraftwerk daemon start`) and check `kraftwerk cloud`.", signinPath);
      return true;
    }
    const host = req.headers.host ?? "localhost";
    const state = randomBytes(24).toString("base64url");
    const back = `http://${host}${t.prefix}/auth/callback`;
    for (const [k, p] of pending) if (Date.now() - p.at > STATE_TTL_MS) pending.delete(k);
    pending.set(state, { workspaceId: t.workspaceId, redirect: back, next: safeNext(url.searchParams.get("next"), t.prefix), at: Date.now() });
    redirect(res, signinUrl(link.url, { workspace: t.workspaceId, machine: link.creds.id, redirect: back, state }), [cookie(STATE_COOKIE, state, STATE_TTL_MS / 1000)]);
    return true;
  }
  if (route === "/auth/handoff" && req.method === "GET") {
    const key = hash(url.searchParams.get("t") ?? "");
    const h = handoffs.get(key);
    handoffs.delete(key);
    if (!h || Date.now() - h.at > HANDOFF_TTL_MS || h.workspaceId !== t.workspaceId) {
      problem(res, 400, "This sign-in link is used up", "It works once, for five minutes, for the workspace it was made for.", signinPath);
      return true;
    }
    const token = await startSession(req, h.workspaceId, h.user, h.role);
    log("info", "users", `${h.user.handle} (${h.user.email}) signed in to ${h.workspaceId} (kraftwerk join)`);
    redirect(res, safeNext(url.searchParams.get("next"), t.prefix), [cookie(USER_COOKIE, token, SESSION_TTL_MS / 1000)]);
    return true;
  }
  if (route === "/auth/callback" && req.method === "GET") {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    const p = pending.get(state);
    if (!p || cookieOf(req, STATE_COOKIE) !== state || Date.now() - p.at > STATE_TTL_MS || p.workspaceId !== t.workspaceId) {
      problem(res, 400, "This sign-in did not start here", "It was started in another browser, took longer than ten minutes, or was used already.", signinPath);
      return true;
    }
    pending.delete(state);
    const link = machineLink();
    if (!link) {
      problem(res, 503, "Signing in needs the kraftwerk cloud", "The machine lost its connection to the cloud meanwhile.", signinPath);
      return true;
    }
    let r;
    try {
      r = await signinExchange(link.url, link.creds, code, p.redirect, link.version);
    } catch (err) {
      problem(res, err instanceof CloudError && err.status >= 400 && err.status < 500 ? 403 : 502, "Signing in did not work", (err as Error).message, signinPath);
      return true;
    }
    if (r.workspaceId !== p.workspaceId) {
      problem(res, 400, "Signing in did not work", "The cloud answered for another workspace.", signinPath);
      return true;
    }
    const token = await startSession(req, r.workspaceId, r.user, r.role);
    log("info", "users", `${r.user.handle} (${r.user.email}) signed in to ${r.workspaceId}`);
    redirect(res, p.next, [cookie(USER_COOKIE, token, SESSION_TTL_MS / 1000), cookie(STATE_COOKIE, "", 0)]);
    return true;
  }
  if (route === "/auth/signout" && req.method === "POST") {
    const token = cookieOf(req, USER_COOKIE);
    // Out of this workspace; the cookie goes once the session holds no other (the path form shares one origin).
    let empty = true;
    if (token) {
      const all = await load();
      const key = hash(token);
      const s = all.get(key);
      if (s && t.workspaceId) delete s.workspaces[t.workspaceId];
      if (s && Object.keys(s.workspaces).length) empty = false;
      else all.delete(key);
      await save();
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", ...(empty ? { "set-cookie": cookie(USER_COOKIE, "", 0) } : {}) });
    res.end(JSON.stringify({ ok: true, signin: signinPath }));
    return true;
  }
  return false;
}

/** The browser's session for `user` with `workspaceId` added: its cookie value. */
async function startSession(req: http.IncomingMessage, workspaceId: string, user: CloudUser, role: "owner" | "member"): Promise<string> {
  const all = await load();
  // The same account signing in to another workspace on this origin keeps one session; anyone else starts afresh.
  const old = cookieOf(req, USER_COOKIE);
  let key = old ? hash(old) : "";
  let token = old ?? "";
  let s = key ? all.get(key) : undefined;
  if (!s || s.user.id !== user.id) {
    token = randomBytes(32).toString("base64url");
    key = hash(token);
    s = { user, createdAt: Date.now(), workspaces: {} };
    all.set(key, s);
  }
  s.user = user;
  s.workspaces[workspaceId] = { role, checkedAt: Date.now() };
  await save();
  return token;
}

/** Forget every session in memory (tests: the next read loads the file again). */
export function forgetUserSessions(): void {
  sessions = null;
  loadedFrom = "";
  pending.clear();
}
