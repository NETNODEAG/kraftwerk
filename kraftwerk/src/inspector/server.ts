import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setOutputDir, getOutputDir } from "./context.js";
import { listRuns, getRun, readRunFile } from "./runs.js";
import { listWorkflows, getWorkflow } from "./workflows.js";
import { dockerStatus, triggerRun, stopRun } from "./runner.js";
import {
  cancelChat,
  createChat,
  getChat,
  listChats,
  postMessage,
  resolvePermission,
  subscribeChat,
} from "./chat/sessions.js";
import type { ChatAgentId, ChatScope } from "./chat/types.js";
import {
  bundleDetail,
  conceptDetail,
  createBundle,
  knowledgeIndex,
  putConcept,
  verifyFromUi,
} from "./knowledge.js";
import {
  deleteMember,
  getMember,
  listMembers,
  saveMember,
  teamRoot,
  type SaveMemberInput,
} from "./team.js";
import {
  deleteRoutine,
  routineStatuses,
  runRoutineNow,
  saveRoutine,
  startRoutineScheduler,
  type SaveRoutineInput,
} from "./routines.js";

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
  // A late error on an SSE response must not try to write headers again.
  if (res.headersSent) return void res.end();
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

  // GET/POST /api/knowledge — bundle index / create a bundle
  if (seg.length === 2 && seg[1] === "knowledge") {
    if (method === "GET") return json(res, await knowledgeIndex());
    if (method === "POST") {
      let body: { name?: string };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, { error: "invalid JSON body" }, 400);
      }
      try {
        return json(res, await createBundle(String(body.name ?? "").trim()));
      } catch (err) {
        return json(res, { error: (err as Error).message }, 400);
      }
    }
  }

  // GET /api/knowledge/:bundle — concepts + log
  if (seg.length === 3 && seg[1] === "knowledge" && method === "GET") {
    try {
      const detail = await bundleDetail(decodeURIComponent(seg[2]));
      return detail ? json(res, detail) : json(res, { error: "not found" }, 404);
    } catch {
      return json(res, { error: "invalid bundle name" }, 400);
    }
  }

  // GET/POST /api/knowledge/:bundle/concept?id=... — read / write one concept
  if (seg.length === 4 && seg[1] === "knowledge" && seg[3] === "concept") {
    const bundle = decodeURIComponent(seg[2]);
    if (method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      try {
        const concept = await conceptDetail(bundle, id);
        return concept ? json(res, concept) : json(res, { error: "not found" }, 404);
      } catch (err) {
        return json(res, { error: (err as Error).message }, 400);
      }
    }
    if (method === "POST") {
      let body: { id?: string; content?: string };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, { error: "invalid JSON body" }, 400);
      }
      if (!body.id || !body.content?.trim()) {
        return json(res, { error: "id and content are required" }, 400);
      }
      try {
        return json(res, await putConcept(bundle, body.id, body.content));
      } catch (err) {
        return json(res, { error: (err as Error).message }, 400);
      }
    }
  }

  // POST /api/knowledge/:bundle/verify — human verification from the UI
  if (seg.length === 4 && seg[1] === "knowledge" && seg[3] === "verify" && method === "POST") {
    let body: { id?: string };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, { error: "invalid JSON body" }, 400);
    }
    if (!body.id) return json(res, { error: "id is required" }, 400);
    try {
      return json(res, await verifyFromUi(decodeURIComponent(seg[2]), body.id));
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET/POST /api/team — member list / create a member
  if (seg.length === 2 && seg[1] === "team") {
    if (method === "GET") {
      return json(res, { root: await teamRoot(), members: await listMembers() });
    }
    if (method === "POST") {
      try {
        const body = JSON.parse(await readBody(req)) as SaveMemberInput;
        return json(res, await saveMember({ ...body, slug: undefined }));
      } catch (err) {
        return json(res, { error: (err as Error).message }, 400);
      }
    }
  }

  // GET/POST /api/team/:slug/routines — list (with run state) / upsert
  if (seg.length === 4 && seg[1] === "team" && seg[3] === "routines") {
    const slug = decodeURIComponent(seg[2]);
    try {
      if (method === "GET") return json(res, { routines: await routineStatuses(slug) });
      if (method === "POST") {
        const body = JSON.parse(await readBody(req)) as SaveRoutineInput;
        return json(res, await saveRoutine(slug, body));
      }
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // DELETE /api/team/:slug/routines/:id | POST /api/team/:slug/routines/:id/run
  if (seg.length >= 5 && seg[1] === "team" && seg[3] === "routines") {
    const slug = decodeURIComponent(seg[2]);
    const id = decodeURIComponent(seg[4]);
    try {
      if (seg.length === 5 && method === "DELETE") {
        await deleteRoutine(slug, id);
        return json(res, { ok: true });
      }
      if (seg.length === 6 && seg[5] === "run" && method === "POST") {
        return json(res, await runRoutineNow(slug, id));
      }
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET/PUT/DELETE /api/team/:slug
  if (seg.length === 3 && seg[1] === "team") {
    const slug = decodeURIComponent(seg[2]);
    try {
      if (method === "GET") {
        const member = await getMember(slug);
        return member ? json(res, member) : json(res, { error: "not found" }, 404);
      }
      if (method === "PUT") {
        const body = JSON.parse(await readBody(req)) as SaveMemberInput;
        return json(res, await saveMember({ ...body, slug }));
      }
      if (method === "DELETE") {
        await deleteMember(slug);
        return json(res, { ok: true });
      }
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET/POST /api/chats
  if (seg.length === 2 && seg[1] === "chats") {
    if (method === "GET") return json(res, { chats: await listChats() });
    if (method === "POST") {
      let body: {
        agent?: string;
        scope?: { kind?: string; runId?: string; bundle?: string; member?: string };
      };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, { error: "invalid JSON body" }, 400);
      }
      let agent = body.agent as ChatAgentId;
      let scope: ChatScope;
      if (body.scope?.kind === "team" && body.scope.member) {
        // Team sessions run on the member's configured harness.
        const member = await getMember(body.scope.member).catch(() => null);
        if (!member) return json(res, { error: "team agent not found" }, 404);
        scope = { kind: "team", member: member.slug };
        agent = member.harness;
      } else if (body.scope?.kind === "run" && body.scope.runId) {
        scope = { kind: "run", runId: body.scope.runId };
      } else if (body.scope?.kind === "kraftwerk") {
        scope = { kind: "kraftwerk" };
      } else if (body.scope?.kind === "knowledge") {
        scope = { kind: "knowledge", ...(body.scope.bundle ? { bundle: body.scope.bundle } : {}) };
      } else {
        scope = { kind: "general" };
      }
      if (!["claude", "codex", "pi"].includes(agent)) {
        return json(res, { error: "agent must be claude, codex, or pi" }, 400);
      }
      try {
        return json(res, await createChat({ agent, scope }));
      } catch (err) {
        return json(res, { error: (err as Error).message }, 400);
      }
    }
  }

  // GET /api/chats/:id
  if (seg.length === 3 && seg[1] === "chats" && method === "GET") {
    try {
      const chat = await getChat(seg[2]);
      return chat ? json(res, chat) : json(res, { error: "not found" }, 404);
    } catch {
      return json(res, { error: "invalid chat id" }, 400);
    }
  }

  // GET /api/chats/:id/events?after=N — SSE stream of thread events.
  if (seg.length === 4 && seg[1] === "chats" && seg[3] === "events" && method === "GET") {
    const afterSeq = Number(url.searchParams.get("after") ?? "0") || 0;
    const send = (ev: { seq: number }) => {
      res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    let unsubscribe: (() => void) | null = null;
    try {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      unsubscribe = await subscribeChat(seg[2], afterSeq, send);
    } catch {
      return void res.end();
    }
    if (!unsubscribe) return void res.end();
    const heartbeat = setInterval(() => res.write(":hb\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe?.();
    });
    return;
  }

  // POST /api/chats/:id/{message,permission,cancel}
  if (seg.length === 4 && seg[1] === "chats" && method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw);
    } catch {
      return json(res, { error: "invalid JSON body" }, 400);
    }
    try {
      let result: { error?: string };
      if (seg[3] === "message") {
        const text = String(body.text ?? "").trim();
        if (!text) return json(res, { error: "text is required" }, 400);
        result = await postMessage(seg[2], text);
      } else if (seg[3] === "permission") {
        result = await resolvePermission(
          seg[2],
          String(body.requestId ?? ""),
          body.optionId == null ? null : String(body.optionId)
        );
      } else if (seg[3] === "cancel") {
        result = await cancelChat(seg[2]);
      } else {
        return json(res, { error: "not found" }, 404);
      }
      return result.error ? json(res, result, 409) : json(res, { ok: true });
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
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
  startRoutineScheduler();
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
