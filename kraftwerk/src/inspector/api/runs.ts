import { promises as fs } from "node:fs";
import { getOutputDir } from "../context.js";
import { decide } from "../decisions.js";
import { allRoutines } from "../routines.js";
import { dockerStatus, stopRun, triggerRun } from "../runner.js";
import { deleteRun, getRun, listRuns, readRunFile, safeRunDir } from "../runs.js";
import { deleteWorkflow, getWorkflow, listWorkflows } from "../workflows.js";
import { MIME } from "./mime.js";
import { ApiError, fail, reply, route } from "./router.js";

/** CSP for raw run files: same shape as the vibeable preview — scripts allowed, origin opaque. */
const RUN_FILE_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads";

/** Text preview payloads are capped; the tail matters most for logs. */
const MAX_TEXT = 400_000;

/** A run file's text, tail-capped: what the run page shows for logs and reports. */
async function fileText(name: string, absPath: string, size: number) {
  let content = await fs.readFile(absPath, "utf8");
  const truncated = content.length > MAX_TEXT;
  if (truncated) content = content.slice(-MAX_TEXT);
  return { name, size, truncated, content };
}

/** A run id that does not name a run folder is refused as a 400. */
const validRun = <T>(p: Promise<T>, message = "invalid run id"): Promise<T> =>
  p.catch((err) => {
    throw err instanceof ApiError ? err : new ApiError(400, message);
  });

/** Workflows, their runs, and the routines that start them. */
export const runRoutes = [
  route({ name: "workflows.list", method: "GET", path: "/api/workflows", summary: "every workflow, with validation errors" }, async () => listWorkflows()),
  route({ name: "workflows.get", method: "GET", path: "/api/workflows/:slug", summary: "one workflow: agents, steps, gates" }, async (c) =>
    (await getWorkflow(c.params.slug)) ?? fail(404, "not found"),
  ),
  route({ name: "workflows.delete", method: "DELETE", path: "/api/workflows/:slug", summary: "move it to the trash; refused while a run is running" }, async (c) => {
    const outcome = await deleteWorkflow(c.params.slug);
    if (outcome === "missing") fail(404, "not found");
    if (outcome === "running") fail(409, "a run of this workflow is still running — stop it first");
    return { ok: true };
  }),
  route({ name: "workflows.runner", method: "GET", path: "/api/workflows/:slug/run", summary: "whether runs can start here (docker state)" }, async () => dockerStatus()),
  route({ name: "workflows.run", method: "POST", path: "/api/workflows/:slug/run", summary: "start a run {request?, sandbox?, ssh?}" }, async (c) => {
    const wf = await getWorkflow(c.params.slug);
    if (!wf || wf.error || !wf.name) fail(404, "workflow not found or broken");
    const body = await c.body<{ request?: string; sandbox?: boolean; ssh?: boolean }>();
    const request = (body.request ?? "").trim();
    if (!request && wf.usesRequest) fail(400, "this workflow needs a request");
    try {
      return { runId: triggerRun({ workflowName: wf.name, request, sandbox: body.sandbox ?? true, ssh: !!body.ssh }).runId };
    } catch (err) {
      throw new ApiError(503, (err as Error).message);
    }
  }),

  route({ name: "routines.list", method: "GET", path: "/api/routines", summary: "every agent's routines with run state and the workflows each one names" }, async () => ({
    routines: await allRoutines((await listWorkflows()).workflows),
  })),

  route({ name: "runs.list", method: "GET", path: "/api/runs", summary: "every run in the output dir" }, async () => ({ outputDir: getOutputDir(), runs: await listRuns() })),
  route({ name: "runs.get", method: "GET", path: "/api/runs/:id", summary: "one run: phases, gates, files" }, async (c) =>
    (await validRun(getRun(c.params.id))) ?? fail(404, "not found"),
  ),
  route({ name: "runs.fileText", method: "GET", path: "/api/runs/:id/text", summary: "one run file's text ?name=, tail-capped" }, async (c) => {
    const name = c.query.get("name") ?? "";
    const file = await validRun(readRunFile(c.params.id, name), "invalid request");
    if (!file) fail(404, "not found");
    return fileText(name, file.absPath, file.size);
  }),
  // ?raw=1 serves the file itself (sandboxed); without it, the same JSON as runs.fileText (older clients).
  route({ name: "runs.file", method: "GET", path: "/api/runs/:id/file", summary: "one run file ?name=[&raw=1]", raw: true }, async ({ res, params, query }) => {
    const name = query.get("name") ?? "";
    const file = await validRun(readRunFile(params.id, name), "invalid request");
    if (!file) fail(404, "not found");
    if (query.get("raw") === "1") {
      const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
      // Agent-written files must not run as the inspector's origin: the
      // sandbox keeps scripts working (interactive reports) but makes the
      // origin opaque, so no fetch() into /api and no cookies. PDFs are
      // exempt — Chrome's viewer refuses sandboxed documents, and PDF
      // scripting has no DOM or origin access.
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(ext === ".pdf" ? {} : { "content-security-policy": RUN_FILE_CSP }),
      });
      return void res.end(await fs.readFile(file.absPath));
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(await fileText(name, file.absPath, file.size)));
  }),
  // A person answers the step that wrote decision-request.json; the answer is written once.
  route({ name: "runs.decide", method: "POST", path: "/api/runs/:id/decision", summary: "answer a decision request {decision, note?}" }, async (c) => {
    const runDir = await validRun(Promise.resolve().then(() => safeRunDir(c.params.id)), "invalid request");
    const r = await decide(runDir, (await c.body()) ?? {});
    return r.ok ? r.answer : fail(r.status, r.error);
  }),
  route({ name: "runs.stop", method: "POST", path: "/api/runs/:id/stop", summary: "stop a running run" }, async (c) =>
    stopRun(c.params.id) ? { stopped: true } : fail(404, "nothing to stop: no launcher of this inspector and no sandbox container for this run"),
  ),
  route({ name: "runs.delete", method: "DELETE", path: "/api/runs/:id", summary: "delete a run; refused while it is live" }, async (c) => {
    const outcome = await validRun(deleteRun(c.params.id));
    if (outcome === "missing") fail(404, "not found");
    if (outcome === "running") fail(409, "run is still running — stop it first");
    return { deleted: true };
  }),
];
