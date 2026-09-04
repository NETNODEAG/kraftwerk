import { existsSync, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setOutputDir, setProjectRoot, getOutputDir, getProjectRoot } from "./context.js";
import { resolveProject } from "../config.js";
import { listRuns, getRun, readRunFile } from "./runs.js";
import { listWorkflows, getWorkflow } from "./workflows.js";
import { dockerStatus, triggerRun, stopRun } from "./runner.js";
import {
  cancelChat,
  createChat,
  deleteChat,
  disposeAllBackends,
  getChat,
  listChats,
  postMessage,
  resolvePermission,
  setChatVibeable,
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
  deleteAgent,
  getAgent,
  listAgents,
  saveAgent,
  setAgentArchived,
  agentsRoot,
  type SaveAgentInput,
} from "./agents.js";
import {
  deleteAgentSkill,
  getSkill,
  listAgentSkills,
  listSkills,
  readSkill,
  saveAgentSkill,
  skillsRoot,
} from "./skills.js";
import {
  discoverWorkspaces,
  forgetProject,
  listWorkspacesDetailed,
  markProjectStopped,
  registerInstance,
  registerProject,
  startProject,
  stopProject,
  tildify,
  unregisterInstance,
} from "./instances.js";
import {
  gitCommit,
  gitDiff,
  gitFetch,
  gitPull,
  gitPush,
  gitStatus,
  startGitSync,
} from "./git.js";
import { getSettings, saveSettings, type SaveSettingsInput } from "./settings.js";
import { addRepo, listRepos, openRepos, removeRepo, updateRepo } from "./repos.js";
import {
  createVibeable,
  deleteVibeable,
  disposeAllDevs,
  listVibeables,
  openVibeables,
  resolveVibeable,
  serveVibeable,
  startDev,
  stopDev,
  subscribeVibeable,
  vibeableStatus,
  type VibeableEvent,
} from "./vibeables.js";
import { searchAgents } from "./search.js";
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

/** Exit code the `kraftwerk ui` supervisor treats as "relaunch me". */
export const RESTART_EXIT_CODE = 75;

/** Whether a supervisor is around to respawn us (set by `kraftwerk ui`). */
const supervised = (): boolean => process.env.KRAFTWERK_UI_SUPERVISED === "1";

/** Package version as it is on disk right now (re-read per call, detects upgrades). */
async function getDiskVersion(): Promise<string> {
  try {
    const raw = await fs.readFile(new URL("../../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "";
  } catch {
    return "";
  }
}

/** Package version this process loaded with, read once. Works from src/ (tsx) and dist/ alike. */
let pkgVersion: string | undefined;
async function getPkgVersion(): Promise<string> {
  pkgVersion ??= await getDiskVersion();
  return pkgVersion;
}

/** Package name from package.json (registry lookups). */
async function getPkgName(): Promise<string> {
  try {
    const raw = await fs.readFile(new URL("../../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { name?: string }).name ?? "";
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

async function handleApi(req: http.IncomingMessage, res: Res, url: URL): Promise<void> {
  const seg = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = req.method ?? "GET";

  if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) {
    return json(res, { error: "cross-origin request refused" }, 403);
  }

  // GET /api/meta — package version + project name ("environment") for the UI.
  // ?probe=1 marks a discovery probe from another instance: answer identity
  // only, skip our own discovery (two instances must not probe each other
  // recursively).
  if (seg.length === 2 && seg[1] === "meta" && method === "GET") {
    const project = await resolveProject(getProjectRoot()).catch(() => null);
    const projectName = project?.config.name ?? (project ? path.basename(project.root) : "");
    const manual = project?.config.switcher ?? [];
    const discovered = url.searchParams.get("probe") === "1" ? [] : await discoverWorkspaces();
    // Manual switcher entries keep their configured name/icon; discovered
    // workspaces that duplicate one (same url, running) only contribute
    // the live flag. Stopped projects never collide — they carry a root,
    // and a manual entry pointing at the same port is just a link.
    const norm = (u: string) => u.replace(/\/+$/, "").replace("127.0.0.1", "localhost").toLowerCase();
    const manualUrls = new Set(manual.map((e) => norm(e.url)));
    const liveUrls = new Set(discovered.filter((d) => d.live).map((d) => norm(d.url)));
    const switcher = [
      ...manual.map((e) => (liveUrls.has(norm(e.url)) ? { ...e, live: true } : e)),
      ...discovered.filter((d) => !(d.live && manualUrls.has(norm(d.url)))),
    ];
    return json(res, {
      version: await getPkgVersion(),
      // A differing disk version means an upgrade landed while this process
      // runs — the UI offers a relaunch when a supervisor can respawn us.
      diskVersion: await getDiskVersion(),
      restartable: supervised(),
      projectName,
      projectIcon: project?.config.icon ?? "",
      projectColor: project?.config.color ?? "",
      projectNamed: !!project?.config.name,
      projectRoot: project?.root ?? getProjectRoot(),
      projectRootLabel: tildify(project?.root ?? getProjectRoot()),
      git: (project?.config.git && project.config.git.enabled !== false) === true,
      repos: (project?.config.repos && project.config.repos.enabled !== false) === true,
      vibeables: (project?.config.vibeables && project.config.vibeables.enabled !== false) === true,
      switcher,
    });
  }

  // GET /api/git — branch, ahead/behind, changed files (the git screen polls
  // this, so it is cached for a beat; ?fresh=1 bypasses the cache).
  if (seg.length === 2 && seg[1] === "git" && method === "GET") {
    return json(res, await gitStatus(url.searchParams.has("fresh")));
  }

  // GET /api/git/diff?path= — unified diff for one file
  if (seg.length === 3 && seg[1] === "git" && seg[2] === "diff" && method === "GET") {
    const file = url.searchParams.get("path");
    if (!file) return json(res, { error: "path required" }, 400);
    return json(res, await gitDiff(file));
  }

  // POST /api/git/commit {paths, message} — stage and commit the selection.
  // Commit and push stay manual; the background timer never writes history.
  if (seg.length === 3 && seg[1] === "git" && seg[2] === "commit" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as { paths?: unknown; message?: unknown };
      const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];
      const message = typeof body.message === "string" ? body.message : "";
      const result = await gitCommit(paths, message);
      return json(res, result, result.ok ? 200 : 409);
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // POST /api/git/{fetch,pull,push}
  if (seg.length === 3 && seg[1] === "git" && method === "POST" && ["fetch", "pull", "push"].includes(seg[2])) {
    const run = seg[2] === "fetch" ? gitFetch : seg[2] === "pull" ? gitPull : gitPush;
    const result = await run();
    return json(res, result, result.ok ? 200 : 409);
  }

  // GET /api/repos — every clone under the repos root, read live from git
  if (seg.length === 2 && seg[1] === "repos" && method === "GET") {
    return json(res, await listRepos());
  }

  // POST /api/repos {url, name?, branch?, depth?} — clone into the root
  if (seg.length === 2 && seg[1] === "repos" && method === "POST") {
    if ((await openRepos()).off) return json(res, { error: "repositories are off" }, 409);
    try {
      const body = JSON.parse(await readBody(req)) as { url?: unknown; name?: unknown; branch?: unknown; depth?: unknown };
      const str = (v: unknown) => (typeof v === "string" ? v : undefined);
      const depth = body.depth === undefined ? undefined : typeof body.depth === "number" ? body.depth : Number.NaN;
      const repo = await addRepo({ url: str(body.url) ?? "", name: str(body.name), branch: str(body.branch), depth });
      return json(res, repo, 201);
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET /api/vibeables — every app folder under the vibeables root | POST {name} — create one with the starter
  if (seg.length === 2 && seg[1] === "vibeables") {
    if (method === "GET") return json(res, await listVibeables());
    if (method === "POST") {
      if ((await openVibeables()).off) return json(res, { error: "vibeables are off" }, 409);
      try {
        const body = JSON.parse(await readBody(req)) as { name?: unknown };
        return json(res, await createVibeable(typeof body.name === "string" ? body.name : ""), 201);
      } catch (err) {
        return json(res, { error: (err as Error).message }, 400);
      }
    }
  }

  const vibeableError = (err: unknown): [number, { error: string }] => {
    const msg = (err as Error).message;
    return [/^no vibeable/.test(msg) ? 404 : /are off/.test(msg) ? 409 : 400, { error: msg }];
  };

  // GET /api/vibeables/<slug> — how the app previews: mode, static url, dev server state | DELETE — remove the folder
  if (seg.length === 3 && seg[1] === "vibeables") {
    try {
      if (method === "GET") return json(res, await vibeableStatus(seg[2]));
      if (method === "DELETE") {
        await deleteVibeable(seg[2]);
        return json(res, { ok: true });
      }
    } catch (err) {
      const [status, body] = vibeableError(err);
      return json(res, body, status);
    }
  }

  // GET /api/vibeables/<slug>/events — SSE: file changes (debounced) and dev-server state
  if (seg.length === 4 && seg[1] === "vibeables" && seg[3] === "events" && method === "GET") {
    let dir: string;
    try {
      dir = (await resolveVibeable(seg[2])).dir;
    } catch (err) {
      const [status, body] = vibeableError(err);
      return json(res, body, status);
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(":ok\n\n");
    const unsubscribe = subscribeVibeable(seg[2], dir, (ev: VibeableEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
    const heartbeat = setInterval(() => res.write(":hb\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return;
  }

  // POST /api/vibeables/<slug>/dev/{start,stop} — the app's dev command
  if (seg.length === 5 && seg[1] === "vibeables" && seg[3] === "dev" && method === "POST") {
    try {
      if (seg[4] === "start") return json(res, await startDev(seg[2]));
      if (seg[4] === "stop") return json(res, await stopDev(seg[2]));
      return json(res, { error: "not found" }, 404);
    } catch (err) {
      const [status, body] = vibeableError(err);
      return json(res, body, status);
    }
  }

  // POST /api/repos/<slug>/update — fetch, fast-forward when clean
  if (seg.length === 4 && seg[1] === "repos" && seg[3] === "update" && method === "POST") {
    try {
      const result = await updateRepo(seg[2]);
      return json(res, result, result.ok ? 200 : result.repo || result.off ? 409 : 404);
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // DELETE /api/repos/<slug>[?force=1] — remove the clone; 409 while it holds unpushed or uncommitted work
  if (seg.length === 3 && seg[1] === "repos" && method === "DELETE") {
    try {
      const force = ["1", "true"].includes(url.searchParams.get("force") ?? "");
      const result = await removeRepo(seg[2], force);
      return json(res, result, result.ok ? 200 : result.conflict || result.off ? 409 : 404);
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET /api/search/agents — active agents of every reachable workspace (the ⌘K palette)
  if (seg.length === 3 && seg[1] === "search" && seg[2] === "agents" && method === "GET") {
    return json(res, await searchAgents());
  }

  // GET /api/projects — every known workspace incl. this one, with state + counts (admin screen)
  if (seg.length === 2 && seg[1] === "projects" && method === "GET") {
    return json(res, await listWorkspacesDetailed());
  }

  // POST /api/projects/start {root} — launch `kraftwerk ui` for a known
  // project as a detached process (the switcher's Start button).
  if (seg.length === 3 && seg[1] === "projects" && seg[2] === "start" && method === "POST") {
    try {
      const { root } = JSON.parse(await readBody(req)) as { root?: string };
      if (!root) return json(res, { error: "root required" }, 400);
      const result = await startProject(root);
      return json(res, result, result.ok ? 200 : 409);
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // POST /api/projects/stop {root | url} — SIGTERM a running workspace's server
  if (seg.length === 3 && seg[1] === "projects" && seg[2] === "stop" && method === "POST") {
    try {
      const target = JSON.parse(await readBody(req)) as { root?: string; url?: string };
      if (!target.root && !target.url) return json(res, { error: "root or url required" }, 400);
      const result = await stopProject(target);
      return json(res, result, result.ok ? 200 : 409);
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // POST /api/projects/forget {root} — drop a project from the registry
  if (seg.length === 3 && seg[1] === "projects" && seg[2] === "forget" && method === "POST") {
    try {
      const { root } = JSON.parse(await readBody(req)) as { root?: string };
      if (!root) return json(res, { error: "root required" }, 400);
      return json(res, { ok: await forgetProject(root) });
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET /api/settings — kraftwerk.yml (parsed + resolved paths) for the settings page
  if (seg.length === 2 && seg[1] === "settings" && method === "GET") {
    return json(res, await getSettings());
  }

  // PUT /api/settings — write the UI-editable subset (name, icon, switcher, git, repos) back
  if (seg.length === 2 && seg[1] === "settings" && method === "PUT") {
    try {
      const input = JSON.parse(await readBody(req)) as SaveSettingsInput;
      return json(res, await saveSettings(input));
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET /api/update-check — ask the npm registry for the latest published version
  if (seg.length === 2 && seg[1] === "update-check" && method === "GET") {
    const name = await getPkgName();
    const current = await getDiskVersion();
    try {
      const r = await fetch(`https://registry.npmjs.org/${name}/latest`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      const latest = ((await r.json()) as { version?: string }).version ?? "";
      return json(res, { name, current, latest });
    } catch {
      return json(res, { name, current, latest: "", error: "npm registry unreachable" }, 502);
    }
  }

  // POST /api/restart — exit with the respawn code; the `kraftwerk ui` supervisor relaunches
  if (seg.length === 2 && seg[1] === "restart" && method === "POST") {
    if (!supervised()) {
      return json(res, { error: "not supervised — restart `kraftwerk ui` manually" }, 400);
    }
    json(res, { ok: true });
    setTimeout(() => {
      disposeAllBackends();
      disposeAllDevs();
      process.exit(RESTART_EXIT_CODE);
    }, 150);
    return;
  }

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

  // GET /api/skills — discovered skills (workspace root + .claude/skills + ~/.claude/skills)
  if (seg.length === 2 && seg[1] === "skills" && method === "GET") {
    const [root, skills] = await Promise.all([skillsRoot(), listSkills()]);
    return json(res, { root, skills });
  }

  // GET /api/skills/:name — one skill with SKILL.md content + bundled files
  if (seg.length === 3 && seg[1] === "skills" && method === "GET") {
    const skill = await getSkill(decodeURIComponent(seg[2]));
    return skill ? json(res, skill) : json(res, { error: "not found" }, 404);
  }

  // GET/POST /api/agents — member list / create a member
  if (seg.length === 2 && seg[1] === "agents") {
    if (method === "GET") {
      return json(res, { root: await agentsRoot(), agents: await listAgents() });
    }
    if (method === "POST") {
      try {
        const body = JSON.parse(await readBody(req)) as SaveAgentInput;
        return json(res, await saveAgent({ ...body, slug: undefined }));
      } catch (err) {
        return json(res, { error: (err as Error).message }, 400);
      }
    }
  }

  // POST /api/agents/:slug/archive — archive/unarchive a member ({ archived: boolean })
  if (seg.length === 4 && seg[1] === "agents" && seg[3] === "archive" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req)) as { archived?: boolean };
      return json(res, await setAgentArchived(decodeURIComponent(seg[2]), body.archived === true));
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET/POST /api/agents/:slug/skills — the agent's own skills / create or update one
  if (seg.length === 4 && seg[1] === "agents" && seg[3] === "skills") {
    const slug = decodeURIComponent(seg[2]);
    try {
      if (method === "GET") return json(res, { skills: await listAgentSkills(slug) });
      if (method === "POST") {
        const body = JSON.parse(await readBody(req)) as { name?: string; content?: string };
        return json(res, await saveAgentSkill(slug, String(body.name ?? ""), String(body.content ?? "")));
      }
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET/DELETE /api/agents/:slug/skills/:name — one agent skill with content / delete
  if (seg.length === 5 && seg[1] === "agents" && seg[3] === "skills") {
    const slug = decodeURIComponent(seg[2]);
    const name = decodeURIComponent(seg[4]);
    try {
      if (method === "GET") {
        const skill = (await listAgentSkills(slug)).find(
          (s) => s.name.toLowerCase() === name.toLowerCase()
        );
        if (!skill) return json(res, { error: "not found" }, 404);
        return json(res, { ...skill, content: await readSkill(skill) });
      }
      if (method === "DELETE") {
        await deleteAgentSkill(slug, name);
        return json(res, { ok: true });
      }
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
  }

  // GET/POST /api/agents/:slug/routines — list (with run state) / upsert
  if (seg.length === 4 && seg[1] === "agents" && seg[3] === "routines") {
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

  // DELETE /api/agents/:slug/routines/:id | POST /api/agents/:slug/routines/:id/run
  if (seg.length >= 5 && seg[1] === "agents" && seg[3] === "routines") {
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

  // GET/PUT/DELETE /api/agents/:slug
  if (seg.length === 3 && seg[1] === "agents") {
    const slug = decodeURIComponent(seg[2]);
    try {
      if (method === "GET") {
        const agent = await getAgent(slug);
        return agent ? json(res, agent) : json(res, { error: "not found" }, 404);
      }
      if (method === "PUT") {
        const body = JSON.parse(await readBody(req)) as SaveAgentInput;
        return json(res, await saveAgent({ ...body, slug }));
      }
      if (method === "DELETE") {
        await deleteAgent(slug);
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
        scope?: { kind?: string; runId?: string; bundle?: string; slug?: string };
      };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, { error: "invalid JSON body" }, 400);
      }
      let agent = body.agent as ChatAgentId;
      let scope: ChatScope;
      if (body.scope?.kind === "agent" && body.scope.slug) {
        // Agent sessions run on the agent's configured harness.
        const def = await getAgent(body.scope.slug).catch(() => null);
        if (!def) return json(res, { error: "agent not found" }, 404);
        scope = { kind: "agent", slug: def.slug };
        agent = def.harness;
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

  // DELETE /api/chats/:id
  if (seg.length === 3 && seg[1] === "chats" && method === "DELETE") {
    try {
      const result = await deleteChat(seg[2]);
      return json(res, result, result.error ? 404 : 200);
    } catch {
      return json(res, { error: "invalid chat id" }, 400);
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

  // POST /api/chats/:id/vibeable {slug | null} — open an app in the chat's preview pane (cwd follows), or close it
  if (seg.length === 4 && seg[1] === "chats" && seg[3] === "vibeable" && method === "POST") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}") as { slug?: unknown };
      const slug = body.slug == null || body.slug === "" ? null : String(body.slug);
      const result = await setChatVibeable(seg[2], slug);
      return result.error ? json(res, { error: result.error }, result.status ?? 400) : json(res, result.meta);
    } catch (err) {
      return json(res, { error: (err as Error).message }, 400);
    }
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
  /** Consumer project root; defaults to the parent of outputDir. */
  projectRoot?: string;
}

/** Start the server; resolves once it listens. Runs until the process ends. */
export function startInspector(opts: InspectorOptions): Promise<http.Server> {
  setOutputDir(opts.outputDir);
  if (opts.projectRoot) setProjectRoot(opts.projectRoot);
  startRoutineScheduler();
  startGitSync();
  // Chat agent subprocesses must die with the server — signals bypass
  // "exit" handlers, so hook the signals themselves.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      disposeAllBackends();
      disposeAllDevs();
      unregisterInstance();
      markProjectStopped();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
  process.once("exit", (code) => {
    disposeAllBackends();
    disposeAllDevs();
    unregisterInstance();
    // A self-restart (new version) is not a stop — the project stays "running".
    if (code !== RESTART_EXIT_CODE) markProjectStopped();
  });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!hostAllowed(req)) return json(res, { error: "unexpected Host header" }, 421);
      if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
      // /vibeables/<slug>/… is an app's own files, served for the preview pane.
      else if (url.pathname === "/vibeables" || url.pathname.startsWith("/vibeables/")) await serveVibeable(req, res, url);
      else await serveStatic(res, opts.staticDir, url.pathname);
    } catch (err) {
      json(res, { error: (err as Error).message }, 500);
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, INSPECTOR_HOST, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      void registerInstance(port, getProjectRoot());
      void registerProject(getProjectRoot());
      resolve(server);
    });
  });
}
