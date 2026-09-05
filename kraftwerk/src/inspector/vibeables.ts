import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, promises as fs, watch, type FSWatcher } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { parse } from "yaml";
import { resolveProject, vibeablesRootFor, type Project } from "../config.js";
import { getProjectRoot } from "./context.js";
import { newestMtime } from "./mtime.js";

/**
 * Vibeables: small applications built live in a chat. The agent edits the
 * folder, the user watches the result in a preview pane next to the thread
 * — lovable-style, but for whatever ad-hoc software the user needs: a
 * dashboard, a slideshow, a tracker with its own backend.
 *
 * A vibeable is one folder under the vibeables root (`vibeables.root` in
 * kraftwerk.yml, default kraftwerk-data/vibeables/). Like agents and knowledge it is part
 * of the workspace: versioned by the workspace git, no repository of its
 * own. The folder is the registry — whatever directory is under the root
 * is a vibeable, whoever created it.
 *
 * Two ways to run one, chosen by the folder itself:
 *
 * - static (default): the inspector serves the folder at /vibeables/<slug>/
 *   — index.html in, no build step. A file watcher tells the pane to reload.
 * - dev: `vibeable.yml` names a `dev` command (npm run dev, node server.js).
 *   The inspector spawns it with PORT set and the pane embeds that server;
 *   anything with a build tool, a backend or a database lives here.
 *
 * Static files go out under a CSP sandbox: the code is what the agent
 * wrote, and it must not act on the inspector API as the user. Nothing here
 * has a shell in the middle except the dev command, which is the user's own
 * choice in their own workspace.
 */

export interface VibeableConfig {
  /** Command that starts a dev server; gets PORT in its environment. */
  dev?: string;
  /** Port the dev command listens on. Default: a free port, passed as PORT. */
  port?: number;
  /** Folder served in static mode, relative to the vibeable. Default: the vibeable itself. */
  dir?: string;
}

export interface VibeableInfo {
  /** Folder name under the root; the id everywhere. */
  slug: string;
  /** Absolute path of the folder. */
  path: string;
  /** index.html exists in the served folder, so the static preview renders something. */
  hasIndex: boolean;
  /** Dev command from vibeable.yml, when declared. */
  dev?: string;
  /** Set when vibeable.yml exists but is unusable. */
  configError?: string;
  /** Newest change inside the folder (node_modules and dot entries excluded). */
  updatedAt?: string;
}

export interface VibeablesView {
  enabled: boolean;
  root?: string;
  vibeables: VibeableInfo[];
  /** Set when the feature is off or the root cannot be read. */
  error?: string;
}

export interface VibeableDev {
  command: string;
  port: number;
  /** The process is alive. */
  running: boolean;
  /** The server answered HTTP on its port. */
  ready: boolean;
  pid?: number;
  startedAt: string;
  /** Set once the process ended. */
  exitCode?: number | null;
  /** Last lines of stdout + stderr. */
  log: string[];
}

export interface VibeableStatus {
  slug: string;
  /** Absolute folder path. */
  path: string;
  /** Absolute folder served in static mode. */
  dir: string;
  /** What the pane shows right now: the dev server once it runs, the static folder otherwise. */
  mode: "static" | "dev";
  /** Static preview url, relative to the inspector. */
  url: string;
  config: VibeableConfig;
  /** Set when vibeable.yml exists but is unusable; static mode still works. */
  configError?: string;
  dev?: VibeableDev;
}

export type VibeableEvent =
  | { type: "change"; files: string[] }
  | { type: "dev"; dev: VibeableDev }
  | { type: "error"; message: string };

export const VIBEABLE_CONFIG_FILE = "vibeable.yml";

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function safeVibeableSlug(slug: string): string {
  if (!SLUG_RE.test(slug) || slug === "." || slug === "..") throw new Error(`invalid vibeable name "${slug}"`);
  return slug;
}

/* ---------- starter ---------- */

/** The files a fresh vibeable starts with: a page that renders, and the config template. */
export function vibeableStarter(name: string): Record<string, string> {
  const title = name.trim() || "vibeable";
  return {
    "index.html":
      `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n` +
      `  <title>${escapeHtml(title)}</title>\n  <link rel="stylesheet" href="./style.css">\n</head>\n<body>\n  <main>\n    <h1>${escapeHtml(title)}</h1>\n` +
      `    <p>This vibeable is live. Tell the agent what to build and watch it change here.</p>\n  </main>\n  <script type="module" src="./app.js"></script>\n</body>\n</html>\n`,
    "style.css":
      // Explicit colours: the pane is white, and a `light dark` scheme would paint light text on it in dark mode.
      `:root { color-scheme: light; font-family: system-ui, sans-serif; background: #fff; color: #1b1b1f; }\n` +
      `body { margin: 0; min-height: 100vh; display: grid; place-items: center; }\n` +
      `main { padding: 32px; max-width: 60ch; }\nh1 { font-weight: 500; }\np { color: #46464f; }\n`,
    "app.js": `// Plain ES module; relative imports and CDN imports (https://esm.sh/...) work.\nconsole.log("${title.replace(/["\\]/g, "")} ready");\n`,
    [VIBEABLE_CONFIG_FILE]:
      `# vibeable.yml — how kraftwerk previews this app. Everything is optional.\n` +
      `# Without a dev command the folder is served as-is (index.html, no build step).\n#\n` +
      `# dev: npm run dev        # command that starts a dev server; it gets PORT in its environment\n` +
      `# port: 5173              # the port that command listens on, when it ignores PORT\n` +
      `# dir: dist               # folder to serve in static mode (default: this folder)\n`,
    // Nested .gitignore: an npm install inside the app must not flood the workspace git.
    ".gitignore": "node_modules/\n.env\n",
    "README.md": `# ${title}\n\nBuilt live as a kraftwerk vibeable. Open it from a chat in the inspector; \`index.html\` is the entry.\n`,
  };
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/* ---------- root + listing ---------- */

/** Resolve the project and its vibeables block. `off` when the feature is not on. */
export async function openVibeables(): Promise<{ project?: Project; root?: string; off?: boolean; error?: string }> {
  let project: Project;
  try {
    project = await resolveProject(getProjectRoot());
  } catch (err) {
    return { error: (err as Error).message };
  }
  const root = vibeablesRootFor(project);
  if (!root) return { off: true, error: "vibeables are off (enable them in settings or add `vibeables:` to kraftwerk.yml)" };
  return { project, root };
}

/** Make sure the root exists; runs when the feature is switched on. */
export async function ensureVibeablesRoot(): Promise<void> {
  const opened = await openVibeables();
  if (opened.root) await fs.mkdir(opened.root, { recursive: true });
}

/** Read vibeable.yml; a missing file is an empty config, a broken one is reported and ignored. */
async function readConfig(dir: string): Promise<{ config: VibeableConfig; error?: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, VIBEABLE_CONFIG_FILE), "utf8");
  } catch {
    return { config: {} };
  }
  try {
    const data = (parse(raw) ?? {}) as Record<string, unknown>;
    if (typeof data !== "object" || Array.isArray(data)) throw new Error("must be a mapping");
    const config: VibeableConfig = {};
    if (data.dev !== undefined) {
      if (typeof data.dev !== "string" || !data.dev.trim()) throw new Error("dev must be a command string");
      config.dev = data.dev.trim();
    }
    if (data.port !== undefined) {
      if (!Number.isInteger(data.port) || (data.port as number) < 1 || (data.port as number) > 65535) throw new Error("port must be 1–65535");
      config.port = data.port as number;
    }
    if (data.dir !== undefined) {
      if (typeof data.dir !== "string" || !data.dir.trim()) throw new Error("dir must be a folder path");
      const abs = path.resolve(dir, data.dir);
      if (abs !== dir && !abs.startsWith(dir + path.sep)) throw new Error("dir must be inside the vibeable");
      config.dir = data.dir.trim();
    }
    return { config };
  } catch (err) {
    return { config: {}, error: `${VIBEABLE_CONFIG_FILE}: ${(err as Error).message}` };
  }
}

interface Resolved {
  slug: string;
  dir: string;
  servedDir: string;
  config: VibeableConfig;
  configError?: string;
}

/** The folder behind a slug, or throw `no vibeable "<slug>"`. */
export async function resolveVibeable(slug: string): Promise<Resolved> {
  safeVibeableSlug(slug);
  const opened = await openVibeables();
  if (!opened.root) throw new Error(opened.error ?? "vibeables are off");
  const dir = path.join(opened.root, slug);
  const st = await fs.stat(dir).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`no vibeable "${slug}"`);
  const { config, error } = await readConfig(dir);
  return { slug, dir, servedDir: path.resolve(dir, config.dir ?? "."), config, configError: error };
}

async function describe(root: string, slug: string): Promise<VibeableInfo> {
  const dir = path.join(root, slug);
  const { config, error } = await readConfig(dir);
  const served = path.resolve(dir, config.dir ?? ".");
  const [index, st, newest] = await Promise.all([
    fs.stat(path.join(served, "index.html")).catch(() => null),
    fs.stat(dir).catch(() => null),
    newestMtime(dir),
  ]);
  const updated = Math.max(newest, st?.mtimeMs ?? 0);
  return {
    slug,
    path: dir,
    hasIndex: !!index?.isFile(),
    ...(config.dev ? { dev: config.dev } : {}),
    ...(error ? { configError: error } : {}),
    ...(updated ? { updatedAt: new Date(updated).toISOString() } : {}),
  };
}

/** Every folder under the root, alphabetically. Dot folders and odd names are skipped. */
export async function listVibeables(): Promise<VibeablesView> {
  const opened = await openVibeables();
  if (!opened.root) return { enabled: false, vibeables: [], error: opened.error };
  const root = opened.root;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const slugs = entries
    .filter((e) => e.isDirectory() && SLUG_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  return { enabled: true, root, vibeables: await Promise.all(slugs.map((s) => describe(root, s))) };
}

/**
 * Create <root>/<name> with the starter files. The folder is claimed with a
 * plain mkdir first: it fails when anything is there already, so two
 * creates of the same name cannot both win.
 */
export async function createVibeable(name: string): Promise<VibeableInfo> {
  const opened = await openVibeables();
  if (!opened.root) throw new Error(opened.error ?? "vibeables are off");
  const slug = safeVibeableSlug(name.trim());
  const dir = path.join(opened.root, slug);
  await fs.mkdir(opened.root, { recursive: true });
  try {
    await fs.mkdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`"${slug}" already exists under ${opened.root}`);
    throw err;
  }
  for (const [rel, content] of Object.entries(vibeableStarter(slug))) await fs.writeFile(path.join(dir, rel), content);
  return describe(opened.root, slug);
}

/** Delete a vibeable folder. Its history stays in the workspace git. */
export async function deleteVibeable(slug: string): Promise<void> {
  const r = await resolveVibeable(slug);
  await stopDev(slug).catch(() => {});
  dropChannel(slug);
  await fs.rm(r.dir, { recursive: true, force: true });
}

export async function vibeableStatus(slug: string): Promise<VibeableStatus> {
  const r = await resolveVibeable(slug);
  const dev = devView(slug);
  return {
    slug,
    path: r.dir,
    dir: r.servedDir,
    mode: dev?.running ? "dev" : "static",
    url: `/vibeables/${encodeURIComponent(slug)}/`,
    config: r.config,
    ...(r.configError ? { configError: r.configError } : {}),
    ...(dev ? { dev } : {}),
  };
}

/* ---------- static serving ---------- */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/**
 * The document is sandboxed by header, so it also holds when opened in its
 * own tab: scripts and forms work, but the origin is opaque — no cookies,
 * no storage, and no same-origin calls into the inspector API.
 */
const VIBEABLE_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads";

/**
 * Headers every preview response carries. The sandbox makes the document's
 * origin opaque, and an opaque origin fetches module scripts, imports and
 * fetch() in CORS mode — without this allow header the app's own app.js
 * never runs. Allowing any origin is safe: the files are the app's public
 * sources, and the sandbox (not the origin) is what keeps them away from
 * the inspector API.
 */
const PREVIEW_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": VIBEABLE_CSP,
  "access-control-allow-origin": "*",
};

/**
 * GET /vibeables/<slug>/<file>. Dot segments (.env, .git) are never served;
 * a directory answers with its index.html, and a directory url without the
 * trailing slash redirects so the page's relative links resolve.
 */
export async function serveVibeable(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const fail = (status: number, error: string): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ error }));
  };
  if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "method not allowed");
  const seg = url.pathname.split("/").slice(2); // ["", "vibeables", slug, ...rest] → [slug, ...rest]
  let slug: string;
  try {
    slug = safeVibeableSlug(decodeURIComponent(seg[0] ?? ""));
  } catch {
    return fail(404, "not found");
  }
  let r: Resolved;
  try {
    r = await resolveVibeable(slug);
  } catch (err) {
    return fail(404, (err as Error).message);
  }
  // A running dev server owns the whole prefix: the pane and a new tab reach
  // it through the inspector's origin, which is what a container or reverse
  // proxy exposes — a random port on the host is not.
  const dev = devs.get(slug);
  if (dev && dev.exitCode === undefined && dev.child) return proxyToDev(req, res, url, slug, dev.port);
  const rest = seg.slice(1).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return "\0";
    }
  });
  if (rest.some((s) => s.startsWith(".") || s.includes("\0") || s.includes("/") || s.includes("\\"))) return fail(404, "not found");
  let abs = path.resolve(r.servedDir, ...rest);
  if (abs !== r.servedDir && !abs.startsWith(r.servedDir + path.sep)) return fail(404, "not found");
  let st = await fs.stat(abs).catch(() => null);
  if (st?.isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      res.writeHead(302, { location: `${url.pathname}/${url.search}`, "cache-control": "no-store" });
      return void res.end();
    }
    abs = path.join(abs, "index.html");
    st = await fs.stat(abs).catch(() => null);
  }
  if (!st?.isFile()) {
    // A missing index is the normal state while the agent rewrites the app:
    // the pane gets a quiet page, not a JSON error, and reloads on the next change.
    if (rest.length === 0 || rest[rest.length - 1] === "") return placeholder(res, slug);
    return fail(404, "not found");
  }
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "content-length": st.size,
    ...PREVIEW_HEADERS,
  });
  if (req.method === "HEAD") return void res.end();
  const stream = createReadStream(abs);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

function placeholder(res: http.ServerResponse, slug: string): void {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(slug)}</title>` +
    `<style>:root{color-scheme:light;background:#fff;color:#46464f;font:14px/1.5 system-ui,sans-serif}` +
    `body{margin:0;min-height:100vh;display:grid;place-items:center}main{text-align:center;padding:32px}` +
    `b{display:block;color:#1b1b1f;font-size:16px;font-weight:500;margin-bottom:4px}</style></head>` +
    `<body><main><b>${escapeHtml(slug)}</b>no index.html yet — the preview appears as soon as the agent writes one.</main></body></html>`;
  res.writeHead(404, { "content-type": "text/html; charset=utf-8", ...PREVIEW_HEADERS });
  res.end(html);
}

/* ---------- dev proxy ---------- */

/** "/vibeables/<slug>/x/y?q" → "/x/y?q" for the dev server. */
function devPath(url: URL, slug: string): string {
  const prefix = `/vibeables/${encodeURIComponent(slug)}`;
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
  return `${rest || "/"}${url.search}`;
}

/** Hop-by-hop headers must not be forwarded either way. */
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-connection"]);

function proxyToDev(req: http.IncomingMessage, res: http.ServerResponse, url: URL, slug: string, port: number): void {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && v !== undefined) headers[k] = v;
  headers.host = `127.0.0.1:${port}`;
  const up = http.request({ host: "127.0.0.1", port, method: req.method, path: devPath(url, slug), headers }, (r) => {
    const out: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k) && v !== undefined) out[k] = v;
    // The sandbox applies to the dev server's pages like to static files,
    // and the inspector's rule wins over whatever the dev server sent.
    Object.assign(out, PREVIEW_HEADERS);
    if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400 && typeof out.location === "string" && out.location.startsWith("/")) {
      out.location = `/vibeables/${encodeURIComponent(slug)}${out.location}`;
    }
    res.writeHead(r.statusCode ?? 502, out);
    r.pipe(res);
  });
  up.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/html; charset=utf-8", ...PREVIEW_HEADERS });
    }
    res.end(`<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;color:#46464f;padding:24px">dev server not answering: ${escapeHtml(err.message)}</p>`);
  });
  req.pipe(up);
}

/**
 * WebSocket upgrades under /vibeables/<slug>/ go to the dev server too — that
 * is how Vite-style HMR reaches the pane. Anything else is closed: the
 * inspector has no sockets of its own.
 */
export function proxyUpgrade(req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const seg = url.pathname.split("/");
  const slug = seg[1] === "vibeables" ? decodeURIComponent(seg[2] ?? "") : "";
  const dev = slug ? devs.get(slug) : undefined;
  if (!dev || dev.exitCode !== undefined || !dev.child) return void socket.destroy();
  const upstream = net.connect(dev.port, "127.0.0.1", () => {
    const lines = [`${req.method} ${devPath(url, slug)} HTTP/1.1`];
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      lines.push(`${k}: ${k === "host" ? `127.0.0.1:${dev.port}` : Array.isArray(v) ? v.join(", ") : v}`);
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  const drop = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", drop);
  socket.on("error", drop);
}

/* ---------- live events: file watcher + dev state ---------- */

interface Channel {
  watcher: FSWatcher | null;
  subs: Set<(ev: VibeableEvent) => void>;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

const channels = new Map<string, Channel>();

const IGNORED = /(^|[\\/])(\.git|node_modules|\.cache|\.vite|\.next)([\\/]|$)/;

/**
 * Stream a vibeable's events: file changes (debounced, node_modules and
 * the like excluded) and dev-server state. The watcher exists while
 * someone listens. `fs.watch` recursive covers macOS and Linux on Node 20+;
 * where it cannot watch, the pane still has its manual reload.
 */
export function subscribeVibeable(slug: string, dir: string, fn: (ev: VibeableEvent) => void): () => void {
  let ch = channels.get(slug);
  if (!ch) {
    ch = { watcher: null, subs: new Set(), pending: new Set(), timer: null };
    channels.set(slug, ch);
    const c = ch;
    try {
      c.watcher = watch(dir, { recursive: true, persistent: false }, (_event, filename) => {
        const rel = filename == null ? "" : String(filename);
        if (IGNORED.test(rel)) return;
        c.pending.add(rel);
        if (c.timer) clearTimeout(c.timer);
        c.timer = setTimeout(() => {
          c.timer = null;
          const files = [...c.pending].filter(Boolean).sort();
          c.pending.clear();
          for (const s of c.subs) s({ type: "change", files });
        }, 200);
      });
      c.watcher.on("error", (err) => {
        for (const s of c.subs) s({ type: "error", message: `file watcher stopped: ${err.message}` });
        // Drop the channel: the next subscriber gets a fresh watch() attempt
        // instead of joining a dead one that never reports anything.
        dropChannel(slug);
      });
    } catch (err) {
      dropChannel(slug);
      queueMicrotask(() => fn({ type: "error", message: `cannot watch ${dir}: ${(err as Error).message}` }));
      return () => {};
    }
  }
  ch.subs.add(fn);
  return () => {
    const c = channels.get(slug);
    if (!c) return;
    c.subs.delete(fn);
    if (c.subs.size === 0) {
      if (c.timer) clearTimeout(c.timer);
      c.watcher?.close();
      channels.delete(slug);
    }
  };
}

/** Close a channel's watcher and forget it; subscribers are left to reconnect. */
function dropChannel(slug: string): void {
  const c = channels.get(slug);
  if (!c) return;
  if (c.timer) clearTimeout(c.timer);
  c.watcher?.close();
  channels.delete(slug);
}

function broadcast(slug: string, ev: VibeableEvent): void {
  const c = channels.get(slug);
  if (!c) return;
  for (const s of c.subs) s(ev);
}

/* ---------- dev server ---------- */

interface DevState {
  child: ChildProcess | null;
  command: string;
  port: number;
  ready: boolean;
  startedAt: string;
  exitCode?: number | null;
  log: string[];
}

const devs = new Map<string, DevState>();
const LOG_LINES = 200;
const READY_TIMEOUT = 90_000;

function devView(slug: string): VibeableDev | undefined {
  const d = devs.get(slug);
  if (!d) return undefined;
  return {
    command: d.command,
    port: d.port,
    running: d.exitCode === undefined && d.child !== null,
    ready: d.ready && d.exitCode === undefined,
    ...(d.child?.pid ? { pid: d.child.pid } : {}),
    startedAt: d.startedAt,
    ...(d.exitCode !== undefined ? { exitCode: d.exitCode } : {}),
    log: d.log,
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** Any HTTP answer on the port counts as ready — a 404 from a dev server is still a server. */
function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1_000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

function pushLog(d: DevState, chunk: Buffer): void {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (!line) continue;
    // Strip ANSI colour codes; the pane is not a terminal.
    d.log.push(line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""));
  }
  if (d.log.length > LOG_LINES) d.log.splice(0, d.log.length - LOG_LINES);
}

/**
 * Start the vibeable's dev command. Idempotent while it runs. The child
 * leads its own process group so stopping it also stops what it spawned
 * (npm → vite → esbuild).
 */
/** Starts in flight per slug: two clicks (or two tabs) share one spawn instead of leaking a process. */
const starting = new Map<string, Promise<VibeableStatus>>();

export function startDev(slug: string): Promise<VibeableStatus> {
  const inFlight = starting.get(slug);
  if (inFlight) return inFlight;
  const p = startDevNow(slug).finally(() => starting.delete(slug));
  starting.set(slug, p);
  return p;
}

async function startDevNow(slug: string): Promise<VibeableStatus> {
  const r = await resolveVibeable(slug);
  if (r.configError) throw new Error(r.configError);
  if (!r.config.dev) throw new Error(`no dev command — add \`dev: <command>\` to ${VIBEABLE_CONFIG_FILE}`);
  const existing = devs.get(slug);
  if (existing && existing.exitCode === undefined && existing.child) return vibeableStatus(slug);
  const port = r.config.port ?? (await freePort());
  // The pane reaches the server through /vibeables/<slug>/ on the inspector,
  // so a dev server that emits absolute URLs needs that as its base.
  const basePath = `/vibeables/${encodeURIComponent(slug)}/`;
  const child = spawn(r.config.dev, [], {
    cwd: r.dir,
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      BASE_PATH: basePath,
      PUBLIC_URL: basePath,
      BROWSER: "none",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      CI: process.env.CI ?? "1",
    },
  });
  const d: DevState = { child, command: r.config.dev, port, ready: false, startedAt: new Date().toISOString(), log: [] };
  devs.set(slug, d);
  child.stdout?.on("data", (c: Buffer) => pushLog(d, c));
  child.stderr?.on("data", (c: Buffer) => pushLog(d, c));
  child.on("error", (err) => {
    pushLog(d, Buffer.from(`spawn failed: ${err.message}\n`));
    d.exitCode = null;
    d.ready = false;
    broadcast(slug, { type: "dev", dev: devView(slug)! });
  });
  child.on("exit", (code) => {
    d.exitCode = code;
    d.ready = false;
    pushLog(d, Buffer.from(`[exited with ${code ?? "signal"}]\n`));
    broadcast(slug, { type: "dev", dev: devView(slug)! });
  });
  broadcast(slug, { type: "dev", dev: devView(slug)! });
  // Readiness runs in the background; the pane follows the dev events.
  void (async () => {
    const until = Date.now() + READY_TIMEOUT;
    while (Date.now() < until && d.exitCode === undefined && devs.get(slug) === d) {
      if (await probe(port)) {
        d.ready = true;
        broadcast(slug, { type: "dev", dev: devView(slug)! });
        return;
      }
      await new Promise((res) => setTimeout(res, 500));
    }
  })();
  return vibeableStatus(slug);
}

function killGroup(d: DevState, signal: NodeJS.Signals): void {
  const pid = d.child?.pid;
  if (!pid) return;
  try {
    if (process.platform !== "win32") process.kill(-pid, signal);
    else d.child?.kill(signal);
  } catch {
    try {
      d.child?.kill(signal);
    } catch {}
  }
}

/** SIGTERM the dev process group, SIGKILL what is still there after 3 s. */
export async function stopDev(slug: string): Promise<VibeableStatus> {
  // Kill before resolving: a folder that vanished or a feature switched off
  // must not leave the process running.
  const d = devs.get(slug);
  if (d && d.exitCode === undefined && d.child) {
    const exited = new Promise<void>((resolve) => d.child!.once("exit", () => resolve()));
    killGroup(d, "SIGTERM");
    const timer = setTimeout(() => killGroup(d, "SIGKILL"), 3_000);
    await exited;
    clearTimeout(timer);
  }
  return vibeableStatus(slug);
}

/** Server shutdown: no dev server may outlive the inspector. */
export function disposeAllDevs(): void {
  for (const d of devs.values()) if (d.exitCode === undefined) killGroup(d, "SIGTERM");
}
