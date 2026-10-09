import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setDefaultWorkspace, Workspace } from "../core/workspace.js";
import { cloudGoodbye, startCloudSync, stopCloudSync } from "./cloud.js";
import { disposeAllBackends } from "../core/chat/sessions.js";
import { markWorkspaceStopped, registerInstance, registerWorkspace, unregisterInstance } from "../core/instances.js";
import { startGitSync } from "../core/git.js";
import { disposeAllDevs } from "../core/vibeables.js";
import { proxyUpgrade, serveVibeable } from "./preview.js";
import { startRoutineScheduler } from "../core/routines.js";
import { apiRouter } from "./api/index.js";
import { serveSocket } from "./api/socket.js";
import { acceptWebSocket } from "./ws.js";
import { json } from "./api/router.js";
import { MIME } from "./api/mime.js";
import { getPkgVersion, RESTART_EXIT_CODE } from "./version.js";
import { trustOf, type TrustOptions } from "./trust.js";

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

/** Start the server; resolves once it listens. Runs until the process ends. */
export async function startInspector(opts: InspectorOptions): Promise<http.Server> {
  // Every request, timer and listener below runs in this workspace (see workspace.ts).
  const ws = setDefaultWorkspace(new Workspace({ outputDir: opts.outputDir, root: opts.root }));
  const trustOpts: TrustOptions = { trustLoopback: opts.trustLoopback !== false && !REQUIRE_PAIRING, trustNetwork: TRUST_NETWORK };
  ws.run(() => {
    startRoutineScheduler();
    startGitSync();
  });
  // Chat agent subprocesses must die with the server — signals bypass
  // "exit" handlers, so hook the signals themselves.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      disposeAllBackends();
      disposeAllDevs();
      unregisterInstance();
      markWorkspaceStopped();
      // The cloud goodbye is bounded (cloudGoodbye) and a no-op without cloud:, so the exit stays prompt.
      void cloudGoodbye().finally(() => process.exit(sig === "SIGINT" ? 130 : 143));
    });
  }
  process.once("exit", (code) => {
    disposeAllBackends();
    disposeAllDevs();
    unregisterInstance();
    // A self-restart (new version) is not a stop — the project stays "running".
    if (code !== RESTART_EXIT_CODE) markWorkspaceStopped();
  });
  const server = http.createServer((req, res) => ws.run(() => serve(req, res)));
  const serve = async (req: http.IncomingMessage, res: Res): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!hostAllowed(req)) return json(res, { error: "unexpected Host header" }, 421);
      const trust = await trustOf(req, url, trustOpts);
      if (url.pathname.startsWith("/api/")) {
        const method = req.method ?? "GET";
        if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) json(res, { error: "cross-origin request refused" }, 403);
        else await apiRouter.handle(req, res, url, trust);
      }
      // /vibeables/<slug>/… is an app's own files, served for the preview pane — workspace data, so not for unpaired callers.
      else if (url.pathname === "/vibeables" || url.pathname.startsWith("/vibeables/")) {
        if (trust.kind === "none") json(res, { error: "pair this device first", pair: true }, 401);
        else await serveVibeable(req, res, url);
      }
      // The web UI's shell is public: an unpaired browser needs it to show the pairing screen.
      else await serveStatic(res, opts.staticDir, url.pathname);
    } catch (err) {
      json(res, { error: (err as Error).message }, 500);
    }
  };
  // WebSocket upgrades: the control plane's socket (/api/ws), and a vibeable's dev server (HMR).
  server.on("upgrade", (req, socket, head) => {
    if (!hostAllowed(req)) return void socket.destroy();
    ws.run(() =>
      (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const trust = await trustOf(req, url, trustOpts, true);
        if (trust.kind === "none") return void socket.end("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n");
        if (url.pathname !== "/api/ws") return proxyUpgrade(req, socket, head);
        // A socket is not covered by CORS: a page from another site could open one, so the Origin must be ours.
        if (!sameOrigin(req)) return void socket.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n");
        const conn = acceptWebSocket(req, socket, head);
        if (conn) serveSocket(conn, ws, await getPkgVersion(), trust, () => trustOf(req, url, trustOpts, true));
      })().catch(() => socket.destroy())
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("close", stopCloudSync);
    server.listen(opts.port, INSPECTOR_HOST, () =>
      ws.run(() => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : opts.port;
        void registerInstance(port, ws.root);
        void registerWorkspace(ws.root);
        void getPkgVersion().then((v) => startCloudSync(port, v));
        resolve(server);
      })
    );
  });
}
