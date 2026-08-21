import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setOutputDir, getOutputDir } from "./context.js";
import { listRuns, getRun, readRunFile } from "./runs.js";
import { listWorkflows, getWorkflow } from "./workflows.js";
import { dockerStatus, triggerRun, stopRun } from "./runner.js";

/**
 * The inspector server: a plain node:http server with no dependencies.
 * Serves the prebuilt SPA (inspector/dist) plus the JSON/file API the
 * frontend polls. Realtime is polling — no daemon, no socket, works on a
 * plain filesystem.
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Text preview payloads are capped; the tail matters most for logs. */
const MAX_TEXT = 400_000;

type Res = http.ServerResponse;

function json(res: Res, body: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function handleApi(req: http.IncomingMessage, res: Res, url: URL): Promise<void> {
  const seg = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = req.method ?? "GET";

  // GET /api/runs
  if (seg.length === 2 && seg[1] === "runs" && method === "GET") {
    return json(res, { outputDir: getOutputDir(), runs: await listRuns() });
  }

  // GET /api/runs/:id
  if (seg.length === 3 && seg[1] === "runs" && method === "GET") {
    try {
      const run = await getRun(seg[2]);
      return run ? json(res, run) : json(res, { error: "not found" }, 404);
    } catch {
      return json(res, { error: "invalid run id" }, 400);
    }
  }

  // GET /api/runs/:id/file?name=...&raw=1
  if (seg.length === 4 && seg[1] === "runs" && seg[3] === "file" && method === "GET") {
    const name = url.searchParams.get("name") ?? "";
    const raw = url.searchParams.get("raw") === "1";
    let file;
    try {
      file = await readRunFile(seg[2], name);
    } catch {
      return json(res, { error: "invalid request" }, 400);
    }
    if (!file) return json(res, { error: "not found" }, 404);

    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    const buf = await fs.readFile(file.absPath);
    if (raw) {
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      return void res.end(buf);
    }
    let text = buf.toString("utf8");
    let truncated = false;
    if (text.length > MAX_TEXT) {
      text = text.slice(-MAX_TEXT);
      truncated = true;
    }
    return json(res, { name, size: file.size, truncated, content: text });
  }

  // POST /api/runs/:id/stop
  if (seg.length === 4 && seg[1] === "runs" && seg[3] === "stop" && method === "POST") {
    return stopRun(seg[2])
      ? json(res, { stopped: true })
      : json(res, { error: "no running sandbox container for this run (local runs cannot be stopped here)" }, 404);
  }

  // GET /api/workflows
  if (seg.length === 2 && seg[1] === "workflows" && method === "GET") {
    return json(res, await listWorkflows());
  }

  // GET /api/workflows/:slug
  if (seg.length === 3 && seg[1] === "workflows" && method === "GET") {
    const wf = await getWorkflow(decodeURIComponent(seg[2]));
    return wf ? json(res, wf) : json(res, { error: "not found" }, 404);
  }

  // GET/POST /api/workflows/:slug/run
  if (seg.length === 4 && seg[1] === "workflows" && seg[3] === "run") {
    if (method === "GET") return json(res, dockerStatus());
    if (method === "POST") {
      const wf = await getWorkflow(decodeURIComponent(seg[2]));
      if (!wf || wf.error || !wf.name) return json(res, { error: "workflow not found or broken" }, 404);
      let body: { request?: string; sandbox?: boolean; ssh?: boolean };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, { error: "invalid JSON body" }, 400);
      }
      const request = (body.request ?? "").trim();
      if (!request) return json(res, { error: "request text is required" }, 400);
      try {
        const { runId } = triggerRun({
          workflowName: wf.name,
          request,
          sandbox: body.sandbox ?? true,
          ssh: !!body.ssh,
        });
        return json(res, { runId });
      } catch (err) {
        return json(res, { error: (err as Error).message }, 503);
      }
    }
  }

  json(res, { error: "not found" }, 404);
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
}

/** Start the server; resolves once it listens. Runs until the process ends. */
export function startInspector(opts: InspectorOptions): Promise<http.Server> {
  setOutputDir(opts.outputDir);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
      else await serveStatic(res, opts.staticDir, url.pathname);
    } catch (err) {
      json(res, { error: (err as Error).message }, 500);
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, () => resolve(server));
  });
}
