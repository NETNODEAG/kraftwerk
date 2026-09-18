import http from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Frontend-only dev server: `npm run dev` here, with `kraftwerk ui` running
// to answer the API. Unlike the inspector's static proxy, the target follows
// the `kw-target` cookie, so the workspace switcher works in dev: it points
// this one page at another running instance instead of leaving for its UI.
const DEFAULT_TARGET = process.env.KRAFTWERK_API || "http://localhost:1981";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The cookie's instance url, only when it is plain http on loopback — this is a dev proxy, not an open one. */
function targetFor(cookie: string | undefined): URL {
  const raw = /(?:^|;\s*)kw-target=([^;]+)/.exec(cookie ?? "")?.[1];
  try {
    const u = new URL(decodeURIComponent(raw ?? ""));
    if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return u;
  } catch {
    /* no or broken cookie */
  }
  return new URL(DEFAULT_TARGET);
}

function apiProxy(): Plugin {
  return {
    name: "kw-api-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();
        const target = targetFor(req.headers.cookie);
        // Headers pass through untouched: the API's origin check compares
        // Origin to Host, and both stay this dev server's.
        const out = http.request(
          { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers },
          (upstream) => {
            res.writeHead(upstream.statusCode ?? 502, upstream.headers);
            upstream.pipe(res); // unbuffered, so SSE streams through
          }
        );
        out.on("error", (err) => {
          if (res.headersSent) return void res.end();
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `no kraftwerk ui at ${target.origin} (${err.message})` }));
        });
        res.on("close", () => out.destroy());
        req.pipe(out);
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // The build is meant to sit beside the inspector on one server, under /next/.
  base: command === "build" ? "/next/" : "/",
  plugins: [react(), apiProxy()],
  server: { port: 1982 },
}));
