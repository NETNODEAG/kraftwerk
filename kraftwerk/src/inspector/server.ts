import { existsSync, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setDefaultWorkspace, Workspace } from "./workspace.js";
import { publicHostFor, resolveProject, tunnelFor, type AccessConfig } from "../config.js";
import { ACCESS_HEADER, verifyAccessToken } from "./access.js";
import { cloudGoodbye, startCloudSync, stopCloudSync } from "./cloud.js";
import { disposeAllBackends } from "./chat/sessions.js";
import { markWorkspaceStopped, registerInstance, registerWorkspace, unregisterInstance } from "./instances.js";
import { startGitSync } from "./git.js";
import { disposeAllDevs, proxyUpgrade, serveVibeable } from "./vibeables.js";
import { startRoutineScheduler } from "./routines.js";
import { apiRouter } from "./api/index.js";
import { serveSocket } from "./api/socket.js";
import { acceptWebSocket } from "./ws.js";
import { json } from "./api/router.js";
import { MIME } from "./api/mime.js";
import { getPkgVersion, RESTART_EXIT_CODE } from "./version.js";

export { RESTART_EXIT_CODE };

/**
 * The inspector server: a plain node:http server with no dependencies.
 * Serves the prebuilt SPA (inspector/dist), an app's files for its preview
 * (/vibeables/…), and the API (/api/…). The API's routes live in api/ — one
 * module per domain, each route named; this file is the HTTP transport
 * around them: who may talk to us, static files, startup and shutdown.
 */

type Res = http.ServerResponse;

/**
 * Interface to bind. Loopback by default: the UI is unauthenticated and its
 * chat runs coding agents against the repo, so it must not appear on the LAN
 * because someone started it on a laptop in a café. Inside a container the
 * default flips to all interfaces — loopback there would make the published
 * port unreachable while the in-container health check keeps passing, and
 * the port mapping (compose publishes to 127.0.0.1) is the boundary anyway.
 * KRAFTWERK_UI_HOST overrides either way.
 */
const IN_CONTAINER = existsSync("/.dockerenv") || existsSync("/run/.containerenv");
const INSPECTOR_HOST = process.env.KRAFTWERK_UI_HOST || (IN_CONTAINER ? "0.0.0.0" : "127.0.0.1");
const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOOPBACK_BIND = LOOPBACK_NAMES.has(INSPECTOR_HOST);

/** Who may reach one server: read from its workspace's kraftwerk.yml at start. */
interface Gate {
  /**
   * The hostname from kraftwerk.yml `public`, when set: the name a tunnel or
   * reverse proxy delivers as Host. A Cloudflare Tunnel forwards the
   * browser's Host untouched and sets no X-Forwarded-Host, so without this
   * the loopback bind would refuse every request that came through it. A
   * rebinding page cannot exploit it: the name is one the operator owns.
   */
  publicHost: string;
  /** Access verification for requests arriving via the public hostname (kraftwerk.yml `tunnel.access`). */
  access?: AccessConfig;
}

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
function hostAllowed(req: http.IncomingMessage, { publicHost }: Gate): boolean {
  if (!LOOPBACK_BIND) return true;
  if (forwardedHost(req)) return true;
  const host = req.headers.host;
  if (!host) return true;
  const name = hostnameOf(host);
  return LOOPBACK_NAMES.has(name) || name.endsWith(".localhost") || (!!publicHost && name === publicHost);
}

/** Whether the browser addressed the public hostname (directly or, via a proxy, in X-Forwarded-Host). */
function viaPublicHost(req: http.IncomingMessage, { publicHost }: Gate): boolean {
  if (!publicHost) return false;
  const host = forwardedHost(req) || req.headers.host;
  return !!host && hostnameOf(host) === publicHost;
}

/**
 * The Access gate: a request that arrived via the public hostname must
 * carry a valid Cloudflare Access token when `tunnel.access` is configured.
 * Requests addressed to a loopback name are the operator's own browser on
 * this machine and pass; bound to loopback, only the tunnel (or a local
 * proxy) can deliver the public name in the first place. Returns the reason
 * to refuse, or undefined to proceed.
 */
async function accessRefusal(req: http.IncomingMessage, gate: Gate): Promise<string | undefined> {
  const { access } = gate;
  if (!access || !viaPublicHost(req, gate)) return undefined;
  const raw = req.headers[ACCESS_HEADER];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) return "Cloudflare Access token missing";
  const result = await verifyAccessToken(token, access);
  return result.ok ? undefined : `Cloudflare Access token refused: ${result.reason}`;
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
  /** Consumer project root; defaults to the parent of outputDir. */
  projectRoot?: string;
}

/** Start the server; resolves once it listens. Runs until the process ends. */
export async function startInspector(opts: InspectorOptions): Promise<http.Server> {
  // Every request, timer and listener below runs in this workspace (see workspace.ts).
  const ws = setDefaultWorkspace(new Workspace({ outputDir: opts.outputDir, root: opts.projectRoot }));
  // Read once: like the port, the public hostname takes effect on restart.
  const project = await resolveProject(ws.root).catch(() => null);
  // This server's own: several servers in one process each guard their own workspace.
  const gate: Gate = { publicHost: (project && publicHostFor(project)) ?? "", access: project ? tunnelFor(project)?.access : undefined };
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
      if (!hostAllowed(req, gate)) return json(res, { error: "unexpected Host header" }, 421);
      const refusal = await accessRefusal(req, gate);
      if (refusal) return json(res, { error: refusal }, 401);
      if (url.pathname.startsWith("/api/")) {
        const method = req.method ?? "GET";
        if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) json(res, { error: "cross-origin request refused" }, 403);
        else await apiRouter.handle(req, res, url);
      }
      // /vibeables/<slug>/… is an app's own files, served for the preview pane.
      else if (url.pathname === "/vibeables" || url.pathname.startsWith("/vibeables/")) await serveVibeable(req, res, url);
      else await serveStatic(res, opts.staticDir, url.pathname);
    } catch (err) {
      json(res, { error: (err as Error).message }, 500);
    }
  };
  // WebSocket upgrades: the control plane's socket (/api/ws), and a vibeable's dev server (HMR).
  server.on("upgrade", (req, socket, head) => {
    if (!hostAllowed(req, gate)) return void socket.destroy();
    ws.run(() =>
      accessRefusal(req, gate).then(
        async (refusal) => {
          if (refusal) return void socket.destroy();
          if (new URL(req.url ?? "/", "http://localhost").pathname !== "/api/ws") return proxyUpgrade(req, socket, head);
          // A socket is not covered by CORS: a page from another site could open one, so the Origin must be ours.
          if (!sameOrigin(req)) return void socket.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n");
          const conn = acceptWebSocket(req, socket, head);
          if (conn) serveSocket(conn, ws, await getPkgVersion());
        },
        () => socket.destroy()
      )
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
