import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import path from "node:path";
import { escapeHtml, resolveVibeable, runningDevPort, safeVibeableSlug, type Resolved } from "../core/vibeables.js";

/**
 * An app's preview over HTTP: /vibeables/<slug>/… serves its files, or
 * proxies to its dev server while one runs (WebSocket upgrades included, for
 * HMR). Everything is sandboxed by header. The app itself — folders,
 * config, dev processes, file watching — is vibeables.ts.
 */

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
  const devPort = runningDevPort(slug);
  if (devPort !== undefined) return proxyToDev(req, res, url, slug, devPort);
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
      // Relative, so it holds under a /w/<slug> prefix too.
      res.writeHead(302, { location: `${url.pathname.split("/").pop()}/${url.search}`, "cache-control": "no-store" });
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
 * is how Vite-style HMR reaches the pane. Anything else is closed (the
 * server's own socket, /api/ws, is handled before this).
 */
export function proxyUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const seg = url.pathname.split("/");
  const slug = seg[1] === "vibeables" ? decodeURIComponent(seg[2] ?? "") : "";
  const port = slug ? runningDevPort(slug) : undefined;
  if (port === undefined) return void socket.destroy();
  const upstream = net.connect(port, "127.0.0.1", () => {
    const lines = [`${req.method} ${devPath(url, slug)} HTTP/1.1`];
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      lines.push(`${k}: ${k === "host" ? `127.0.0.1:${port}` : Array.isArray(v) ? v.join(", ") : v}`);
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
