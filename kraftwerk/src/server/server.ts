import { promises as fs } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { setDefaultWorkspace, Workspace } from "../core/workspace.js";
import { cloudGoodbye, cloudGoodbyeAll, startCloudSync, stopCloudSync } from "./cloud.js";
import { disposeAllBackends, disposeWorkspaceBackends } from "../core/chat/sessions.js";
import { markWorkspaceStopped, registerInstance, registerWorkspace, unregisterInstance } from "../core/instances.js";
import { startGitSync, stopGitSync } from "../core/git.js";
import { disposeAllDevs, disposeWorkspaceDevs } from "../core/vibeables.js";
import { proxyUpgrade, serveVibeable } from "./preview.js";
import { startRoutineScheduler, stopRoutineScheduler } from "../core/routines.js";
import { readWorkspaceDotenv } from "../core/env.js";
import { closeWatches } from "./live.js";
import { MACHINE_PATHS, runInHub } from "./hub-context.js";
import { apiRouter } from "./api/index.js";
import { serveSocket } from "./api/socket.js";
import { acceptWebSocket } from "./ws.js";
import { json } from "./api/router.js";
import { MIME } from "./api/mime.js";
import { getPkgVersion, RESTART_EXIT_CODE } from "./version.js";
import { trustOf, type TrustOptions } from "./trust.js";
import type { Duplex } from "node:stream";
import { targetOf, type Target } from "./target.js";
import { isDir, resolveWorkspace, workspaceSlug } from "../config.js";

export { RESTART_EXIT_CODE };

/**
 * The inspector server: a plain node:http server with no dependencies.
 * Serves the prebuilt SPA (web/dist), an app's files for its preview
 * (/vibeables/…), and the API (/api/…). The API's routes live in api/ — one
 * module per domain, each route named; this file is the HTTP transport
 * around them: who may talk to us, static files, startup and shutdown.
 */

type Res = http.ServerResponse;

import { IN_CONTAINER, INSPECTOR_HOST, LOOPBACK_BIND, LOOPBACK_NAMES } from "./bind.js";

/**
 * Whether the Host header names this server. A loopback bind alone does not
 * keep other sites out: a page on evil.example can re-point that name at
 * 127.0.0.1 after it loaded (DNS rebinding) and then talk to us as if it
 * were same-origin — every check that compares Origin to Host passes,
 * because both say evil.example. So while bound to loopback, only loopback
 * names are served. Bound elsewhere (a container behind a proxy) the name
 * is whatever the proxy forwards, and the proxy is the boundary.
 *
 * A reverse proxy on the same machine talks to the loopback bind with the
 * browser's Host, which is not a loopback name. It says so in
 * X-Forwarded-Host, and that header cannot come from a rebinding page: a
 * browser only sends it after a CORS preflight, which this server never
 * answers, and a form post cannot set headers at all.
 */
function hostAllowed(req: http.IncomingMessage): boolean {
  if (!LOOPBACK_BIND) return true;
  if (forwardedHost(req)) return true;
  const host = req.headers.host;
  if (!host) return true;
  const name = hostnameOf(host);
  return LOOPBACK_NAMES.has(name) || name.endsWith(".localhost");
}

/** First X-Forwarded-Host value, or undefined when no proxy set one. */
function forwardedHost(req: http.IncomingMessage): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0].trim() || undefined;
}

/** "localhost:1981" → "localhost", "[::1]:1981" → "[::1]"; "" when unparsable. */
function hostnameOf(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

/**
 * Whether a state-changing request came from this UI rather than from some
 * other page the user happens to have open. The inspector has no login of
 * its own: every POST here writes files, commits, pushes, or starts a coding
 * agent, and a cross-site form post needs no preflight to reach us. Browsers
 * attach Origin to every POST/PUT/DELETE, form submissions included, so a
 * mismatch is a forgery. A missing Origin is a non-browser client (curl, a
 * script), which was never the attack this guards against.
 */
function sameOrigin(req: http.IncomingMessage): boolean {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  // A sandboxed iframe or a redirected form sends "null", which matches no host.
  if (origin === "null") return false;
  // A reverse proxy that rewrites Host to the upstream (nginx by default)
  // says who the browser addressed in X-Forwarded-Host. Trusting it is safe
  // here: a browser cannot set that header without a CORS preflight, which
  // this API never answers, and a form post cannot set headers at all.
  const host = forwardedHost(req) || req.headers.host;
  if (!host) return false;
  try {
    // Parse the host under the origin's scheme so a default port written
    // out by the proxy ("kw.example.com:443") compares equal to the
    // browser's Origin, which never carries one.
    const o = new URL(origin);
    return o.host === new URL(`${o.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

async function serveStatic(res: Res, staticDir: string, pathname: string): Promise<void> {
  // SPA: unknown paths fall back to index.html (routing is client-side).
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  let abs = path.resolve(staticDir, rel);
  if (!abs.startsWith(path.resolve(staticDir) + path.sep) && abs !== path.resolve(staticDir)) {
    return json(res, { error: "not found" }, 404);
  }
  let buf = await fs.readFile(abs).catch(() => null);
  if (buf === null) {
    abs = path.join(staticDir, "index.html");
    buf = await fs.readFile(abs).catch(() => null);
  }
  if (buf === null) return json(res, { error: "inspector assets missing" }, 500);
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    // Vite emits content-hashed asset names; index.html must stay fresh.
    "cache-control": abs.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
  });
  res.end(buf);
}

export interface InspectorOptions {
  outputDir: string;
  staticDir: string;
  port: number;
  /** The workspace root (where kraftwerk.yml lives); defaults to the parent of outputDir. */
  root?: string;
  /**
   * A loopback peer is this machine and needs no token (default true).
   * False makes every request pair first — tests, or a hardened setup
   * behind a local reverse proxy that serves the network.
   */
  trustLoopback?: boolean;
}

/** Other peers count as this machine inside a container (the port mapping is the boundary) or when asked to — the behaviour before devices. */
const TRUST_NETWORK = IN_CONTAINER || process.env.KRAFTWERK_UI_TRUST_NETWORK === "1";
/** Every request pairs, this machine's too — behind a local reverse proxy that does not send X-Forwarded-* headers. */
const REQUIRE_PAIRING = process.env.KRAFTWERK_UI_REQUIRE_PAIRING === "1";

/** A workspace a hub serves. */
export interface OpenWorkspace {
  slug: string;
  root: string;
  name: string;
  /** Where it is reached: <slug>.localhost:<port> under a daemon, localhost:<port> standalone. */
  url: string;
  /** Its own port too (kraftwerk.yml `port`), when the hub listens there for it — old links keep working. */
  aliasPort?: number;
  ws: Workspace;
}

/**
 * One HTTP server serving workspaces by slug (see target.ts): a daemon
 * (`kraftwerk daemon`) serves every workspace that is open on the machine,
 * a standalone `kraftwerk ui` exactly one — its default, also reached
 * without a slug, as before. Each open workspace runs in its own Workspace
 * (core/workspace.ts) with its own .env, background jobs (routines, git
 * sync, cloud), registry entry and live state; closing one ends all of that
 * and leaves the others running.
 */
export interface Hub {
  readonly server: http.Server;
  /** The port it listens on. */
  readonly port: number;
  /** Whether it is the machine's daemon (workspaces addressed by slug, none by default). */
  readonly daemon: boolean;
  /** Serve a workspace (idempotent: an open one is returned as it is). */
  open(root: string, opts?: { outputDir?: string }): Promise<OpenWorkspace>;
  /** Stop serving one; false when it was not open. */
  close(root: string): Promise<boolean>;
  list(): OpenWorkspace[];
  /** Close every workspace and the server. */
  stop(): Promise<void>;
}

export interface HubOptions {
  port: number;
  staticDir: string;
  trustLoopback?: boolean;
  /** The machine's daemon: workspaces get `hub` instance files, their own ports as aliases, and no default. */
  daemon?: boolean;
  /** After a workspace opened or closed (the daemon notes what to reopen after a restart). */
  onChange?: (hub: Hub) => void | Promise<void>;
}

const hubs = new Set<Hub>();
let exitHandlers = false;

/** Every hub of this process lets go of its workspaces — on SIGINT/SIGTERM and exit (sync parts only there). */
function installExitHandlers(): void {
  if (exitHandlers) return;
  exitHandlers = true;
  // Something still running for a workspace that was closed (a late callback) finds its state gone and throws
  // "workspace closed". That must not take the other workspaces down with it; anything else still crashes, as by default.
  const closedOnly = (err: unknown): boolean => err instanceof Error && err.message === "workspace closed";
  process.on("unhandledRejection", (err) => {
    if (closedOnly(err)) return;
    throw err;
  });
  process.on("uncaughtException", (err) => {
    if (closedOnly(err)) return;
    console.error(err);
    process.exit(1);
  });
  // Chat agent subprocesses must die with the server — signals bypass "exit" handlers, so hook the signals themselves.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      disposeAllBackends();
      disposeAllDevs();
      // Stamp first: unregistering forgets which workspaces this process served.
      markWorkspaceStopped();
      unregisterInstance();
      // The cloud goodbye is bounded and a no-op without cloud:, so the exit stays prompt.
      void cloudGoodbyeAll().finally(() => process.exit(sig === "SIGINT" ? 130 : 143));
    });
  }
  process.once("exit", (code) => {
    disposeAllBackends();
    disposeAllDevs();
    // A self-restart (new version) is not a stop — the workspaces stay "running".
    if (code !== RESTART_EXIT_CODE) markWorkspaceStopped();
    unregisterInstance();
  });
}

/**
 * Listen on `port`. On the default bind (127.0.0.1) the same port on ::1
 * feeds the same server: macOS resolves localhost and <slug>.localhost to
 * ::1 first, and a client that does not fall back to IPv4 (a native app's
 * HTTP library) would find nothing there. Best effort — without IPv6, or
 * with ::1:port taken, it stays IPv4 only, as before.
 */
async function listen(server: http.Server, port: number): Promise<number> {
  const bound = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, INSPECTOR_HOST, () => {
      server.off("error", reject);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });
  if (INSPECTOR_HOST !== "127.0.0.1") return bound;
  const twin = net.createServer((socket) => server.emit("connection", socket));
  const ok = await new Promise<boolean>((resolve) => {
    twin.once("error", () => resolve(false));
    twin.listen(bound, "::1", () => resolve(true));
  });
  if (!ok) return bound;
  twin.on("error", () => {});
  // Closing the server stops the twin from taking connections at once (its "close" event waits for open ones).
  const close = server.close.bind(server);
  server.close = ((cb?: (err?: Error) => void) => {
    twin.close();
    return close(cb);
  }) as typeof server.close;
  return bound;
}

/**
 * A small page at a daemon's own address: the open workspaces, each a link —
 * <slug>.localhost on this machine, the path form on the address a paired
 * device used (it cannot resolve <slug>.localhost).
 */
function hubPage(req: http.IncomingMessage, res: Res, open: OpenWorkspace[]): void {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  // Behind a proxy on this machine the browser's name is the forwarded one.
  const host = hostnameOf(forwardedHost(req) ?? req.headers.host ?? "");
  const local = LOOPBACK_NAMES.has(host) || host.endsWith(".localhost");
  const rows = open.length
    ? open.map((o) => `<li><a href="${esc(local ? `${o.url}/` : `/w/${o.slug}/`)}">${esc(o.name)}</a> <code>${esc(o.slug)}</code></li>`).join("")
    : "<li>No workspace is open. Run <code>kraftwerk ui</code> in a workspace folder.</li>";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><meta charset="utf-8"><title>kraftwerk</title><style>body{font:15px/1.6 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#1b1b1f}code{color:#46464f}</style><h1>kraftwerk</h1><ul>${rows}</ul>`);
}

export async function startHub(opts: HubOptions): Promise<Hub> {
  const trustOpts: TrustOptions = { trustLoopback: opts.trustLoopback !== false && !REQUIRE_PAIRING, trustNetwork: TRUST_NETWORK };
  const bySlug = new Map<string, OpenWorkspace>();
  const aliasServers = new Map<string, http.Server>();
  /** The workspace reached without a slug on the hub's own port (standalone: the one it serves). */
  let fallback: OpenWorkspace | undefined;
  /** Open sockets and the workspace each was opened for: closing that workspace closes them. */
  const sockets = new Set<{ slug?: string; close: () => void }>();
  const version = await getPkgVersion();
  installExitHandlers();

  /** Which open workspace a request is for: its slug, else the port it came in on, else the default. */
  const pick = (target: Target, portDefault: OpenWorkspace | undefined): OpenWorkspace | undefined =>
    target.slug !== undefined ? bySlug.get(target.slug) : portDefault;

  const handler = (portDefault: () => OpenWorkspace | undefined) => async (req: http.IncomingMessage, res: Res): Promise<void> => {
    try {
      if (!hostAllowed(req)) return json(res, { error: "unexpected Host header" }, 421);
      const target = targetOf(req, new URL(req.url ?? "/", "http://localhost"));
      const open = pick(target, portDefault());
      if (target.slug !== undefined && !open) return json(res, { error: `no workspace "${target.slug}" here` }, 404);
      const { url } = target;
      const trust = await trustOf(req, url, trustOpts);
      const run = <T>(fn: () => T): T => runInHub(hub, () => (open ? open.ws.run(fn) : fn()));
      if (url.pathname.startsWith("/api/")) {
        const method = req.method ?? "GET";
        if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) return json(res, { error: "cross-origin request refused" }, 403);
        if (!open && !MACHINE_PATHS.test(url.pathname)) {
          return json(res, { error: "name a workspace: <slug>.localhost or /w/<slug>/", workspaces: [...bySlug.keys()] }, 404);
        }
        return await run(() => apiRouter.handle(req, res, url, trust));
      }
      // /vibeables/<slug>/… is an app's own files, served for the preview pane — workspace data, so not for unpaired callers.
      if (url.pathname === "/vibeables" || url.pathname.startsWith("/vibeables/")) {
        if (trust.kind === "none") return json(res, { error: "pair this device first", pair: true }, 401);
        if (!open) return json(res, { error: "name a workspace: <slug>.localhost or /w/<slug>/" }, 404);
        return await run(() => serveVibeable(req, res, url));
      }
      // A daemon's own address lists its workspaces; anywhere else, the web UI's shell (public: an unpaired browser needs it to pair).
      if (!open && (url.pathname === "/" || url.pathname === "/index.html")) return hubPage(req, res, [...bySlug.values()]);
      await serveStatic(res, opts.staticDir, url.pathname);
    } catch (err) {
      json(res, { error: (err as Error).message }, 500);
    }
  };

  // WebSocket upgrades: the control plane's socket (/api/ws), and a vibeable's dev server (HMR).
  const upgrade = (portDefault: () => OpenWorkspace | undefined) => (req: http.IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (!hostAllowed(req)) return void socket.destroy();
    (async () => {
      const target = targetOf(req, new URL(req.url ?? "/", "http://localhost"));
      const open = pick(target, portDefault());
      if (target.slug !== undefined && !open) return void socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n");
      const { url } = target;
      const trust = await trustOf(req, url, trustOpts, true);
      if (trust.kind === "none") return void socket.end("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n");
      if (url.pathname !== "/api/ws") {
        if (!open) return void socket.destroy();
        // The dev server's HMR socket: what it sees is the path without the workspace prefix.
        req.url = url.pathname + url.search;
        return runInHub(hub, () => open.ws.run(() => proxyUpgrade(req, socket, head)));
      }
      // A socket is not covered by CORS: a page from another site could open one, so the Origin must be ours.
      if (!sameOrigin(req)) return void socket.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n");
      const conn = acceptWebSocket(req, socket, head);
      if (!conn) return;
      // The connection's workspace is the one it was opened for; a message may name another (`ws`).
      // Looked up per message: a workspace closed meanwhile is not served, a reopened one is the new one.
      const own = open?.slug;
      const resolve = (slug?: string): Workspace | undefined => bySlug.get(slug ?? own ?? "")?.ws;
      const entry = { slug: own, close: () => conn.close(4404, "workspace closed") };
      sockets.add(entry);
      conn.onClose(() => sockets.delete(entry));
      runInHub(hub, () => serveSocket(conn, resolve, version, trust, () => trustOf(req, url, trustOpts, true), hub));
    })().catch(() => socket.destroy());
  };

  const server = http.createServer(handler(() => fallback));
  server.on("upgrade", upgrade(() => fallback));
  const port = await listen(server, opts.port);
  server.once("close", () => {
    for (const s of aliasServers.values()) s.close();
  });

  const hub: Hub = {
    server,
    port,
    daemon: !!opts.daemon,
    list: () => [...bySlug.values()],
    // One open or close at a time: two overlapping opens of a root (the daemon reopening while `kraftwerk ui`
    // asks, two clicks) must find each other, not make two copies of the workspace.
    open: (root, o = {}) => serial(() => openNow(root, o)),
    close: (root) => serial(() => closeNow(root)),
    async stop() {
      // Closing for good, not one by one: what was open stays noted for the next start.
      const notify = opts.onChange;
      opts.onChange = undefined;
      for (const o of [...bySlug.values()]) await hub.close(o.root);
      opts.onChange = notify;
      hubs.delete(hub);
      // A connected browser tab (its socket, a keep-alive connection) must not hold the stop open.
      for (const s of [...sockets]) s.close();
      const closing = new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections();
      for (const s of aliasServers.values()) s.closeAllConnections();
      await closing;
    },
  };

  let lock: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = lock.then(fn, fn);
    lock = run.catch(() => {});
    return run;
  }

  /** Tell the daemon what is open; a failure there is reported, the workspace stays as it is. */
  async function noteChange(): Promise<void> {
    try {
      await opts.onChange?.(hub);
    } catch (err) {
      console.error(`kraftwerk: could not note the open workspaces: ${(err as Error).message}`);
    }
  }

  async function openNow(root: string, o: { outputDir?: string }): Promise<OpenWorkspace> {
    // A folder that is gone (or a kraftwerk.yml that does not parse) is refused, not served as an empty workspace.
    if (!(await isDir(path.resolve(root)))) throw new Error(`no such folder: ${root}`);
    const ws0 = await resolveWorkspace(root);
    const abs = ws0.root;
    const already = [...bySlug.values()].find((x) => x.root === abs);
    if (already) return already;
    const slug = workspaceSlug(ws0);
    const clash = bySlug.get(slug);
    if (clash) throw new Error(`slug "${slug}" is already served for ${clash.root} — set \`slug:\` in one of the two kraftwerk.yml files`);
    const ws = new Workspace({ outputDir: o.outputDir ?? ws0.outputDir, root: abs, slug, env: readWorkspaceDotenv(abs) });
    const name = ws0.config.name ?? path.basename(abs);
    const entry: OpenWorkspace = { slug, root: abs, name, ws, url: opts.daemon ? `http://${slug}.localhost:${port}` : `http://localhost:${port}` };
    // A daemon also listens on the workspace's own port, so its old address keeps working — when that port is free.
    const own = ws0.config.port;
    if (opts.daemon && own && own !== port) {
      const alias = http.createServer(handler(() => entry));
      alias.on("upgrade", upgrade(() => entry));
      try {
        entry.aliasPort = await listen(alias, own);
        aliasServers.set(abs, alias);
      } catch {
        alias.close();
      }
    }
    bySlug.set(slug, entry);
    if (!opts.daemon) fallback ??= entry;
    runInHub(hub, () =>
      ws.run(() => {
        startRoutineScheduler();
        startGitSync();
        // Best-effort, in the background: none of them may hold up (or, failing, break) the open.
        void registerInstance(entry.aliasPort ?? port, abs, opts.daemon ? { hub: true, slug, url: entry.url } : {}).catch(() => {});
        void registerWorkspace(abs).catch(() => {});
        void startCloudSync(entry.url, version).catch(() => {});
      }),
    );
    await noteChange();
    return entry;
  }

  async function closeNow(root: string): Promise<boolean> {
    const abs = path.resolve(root);
    const entry = [...bySlug.values()].find((x) => x.root === abs);
    if (!entry) return false;
    bySlug.delete(entry.slug);
    if (fallback === entry) fallback = undefined;
    for (const s of [...sockets]) if (s.slug === entry.slug) s.close();
    const alias = aliasServers.get(abs);
    alias?.close();
    alias?.closeAllConnections();
    aliasServers.delete(abs);
    await runInHub(hub, () =>
      entry.ws.run(async () => {
        stopRoutineScheduler();
        stopGitSync();
        closeWatches();
        disposeWorkspaceBackends();
        disposeWorkspaceDevs();
        await cloudGoodbye();
        stopCloudSync();
      }),
    );
    unregisterInstance(abs);
    markWorkspaceStopped(abs);
    entry.ws.close();
    await noteChange();
    return true;
  }
  hubs.add(hub);
  return hub;
}

/**
 * A standalone server for one workspace (`kraftwerk ui`, tests): a hub
 * serving it as its default, reached with or without its slug. Resolves
 * once it listens.
 */
export async function startInspector(opts: InspectorOptions): Promise<http.Server> {
  const hub = await startHub({ port: opts.port, staticDir: opts.staticDir, trustLoopback: opts.trustLoopback });
  const open = await hub.open(opts.root ?? path.dirname(path.resolve(opts.outputDir)), { outputDir: opts.outputDir });
  // Code that runs outside any request (the CLI side of this process) still finds its workspace.
  setDefaultWorkspace(open.ws);
  hub.server.once("close", () => void hub.stop());
  return hub.server;
}
