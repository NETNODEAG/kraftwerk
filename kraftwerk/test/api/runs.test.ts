import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { RunDetail, RunListItem } from "../../src/inspector/runs.js";

/**
 * Runs over the HTTP API: status for runs that never wrote a trace (the
 * launcher died first), the exit code recorded by the UI trigger, and
 * removal — which is refused while a run still looks live. Nothing here
 * starts a run; the folders are written by hand.
 */
describe("runs API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  const runsDir = () => path.join(fx.root, "output", "runs");
  const origin = () => ({ origin: new URL(srv.url).origin });

  async function writeRun(id: string, files: Record<string, string>, ageMs = 0): Promise<void> {
    const dir = path.join(runsDir(), id);
    await mkdir(dir, { recursive: true });
    const when = new Date(Date.now() - ageMs);
    for (const [name, content] of Object.entries(files)) {
      const p = path.join(dir, name);
      await writeFile(p, content);
      await utimes(p, when, when);
    }
    await utimes(dir, when, when);
  }

  const trace = (events: object[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const doneTrace = trace([
    { event: "run_start", ts: "2026-01-01T10:00:00Z", workflow: "ask", request: "why" },
    { event: "phase_end", ts: "2026-01-01T10:00:05Z", phase: "answer", status: "ok", stats: { durationMs: 5000, costUsd: 0.01, attempts: 1 } },
    { event: "run_summary", ts: "2026-01-01T10:00:05Z", total: { durationMs: 5000, costUsd: 0.01 } },
  ]);
  const launcherLog = 'Workflow "weekly" needs environment variables that are missing: MATOMO_API_TOKEN\n';

  before(async () => {
    fx = await makeProject("name: fixture\n");
    // Died at launch 20 minutes ago, nothing but the launcher's log.
    await writeRun("2026-01-01-1000-00-old-launch", { "trigger.log": launcherLog }, 20 * 60_000);
    // Launched just now, no trace yet: still starting as far as anyone knows.
    await writeRun("2026-01-01-1100-00-fresh-launch", { "trigger.log": launcherLog });
    // Launched just now, but the inspector heard the launcher exit with 2.
    await writeRun("2026-01-01-1200-00-exited-launch", {
      "trigger.log": launcherLog,
      "trigger.json": JSON.stringify({ exitCode: 2, finishedAt: new Date().toISOString() }),
    });
    await writeRun("2026-01-01-1300-00-done", { "trace.jsonl": doneTrace });
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  async function list(): Promise<Record<string, RunListItem>> {
    const v = (await (await fetch(srv.url + "/api/runs")).json()) as { runs: RunListItem[] };
    return Object.fromEntries(v.runs.map((r) => [r.id, r]));
  }

  it("a run that never wrote a trace fails once its folder is stale, instead of running forever", async () => {
    const by = await list();
    assert.equal(by["2026-01-01-1000-00-old-launch"].status, "failed");
    assert.equal(by["2026-01-01-1100-00-fresh-launch"].status, "running");
    const detail = (await (await fetch(srv.url + "/api/runs/2026-01-01-1000-00-old-launch")).json()) as RunDetail;
    assert.equal(detail.status, "failed");
    assert.equal(detail.workflow, "old-launch", "the workflow slug comes from the run id when there is no trace");
    assert.deepEqual(detail.files.map((f) => f.name), ["trigger.log"]);
  });

  it("the launcher's exit code in trigger.json settles a fresh run without a trace", async () => {
    const by = await list();
    assert.equal(by["2026-01-01-1200-00-exited-launch"].status, "failed");
    assert.equal(by["2026-01-01-1300-00-done"].status, "ok");
  });

  it("stop answers 404 when neither a launcher nor a sandbox container exists", async () => {
    const r = await fetch(srv.url + "/api/runs/2026-01-01-1100-00-fresh-launch/stop", { method: "POST", headers: origin() });
    assert.equal(r.status, 404);
  });

  it("refuses to remove a run that still looks live", async () => {
    const r = await fetch(srv.url + "/api/runs/2026-01-01-1100-00-fresh-launch", { method: "DELETE", headers: origin() });
    assert.equal(r.status, 409);
    await stat(path.join(runsDir(), "2026-01-01-1100-00-fresh-launch"));
  });

  it("removes a finished run's folder and forgets it", async () => {
    for (const id of ["2026-01-01-1000-00-old-launch", "2026-01-01-1300-00-done"]) {
      const r = await fetch(srv.url + `/api/runs/${id}`, { method: "DELETE", headers: origin() });
      assert.equal(r.status, 200, id);
      assert.deepEqual(await r.json(), { deleted: true });
      await assert.rejects(stat(path.join(runsDir(), id)));
      assert.equal((await fetch(srv.url + `/api/runs/${id}`)).status, 404);
    }
    assert.equal("2026-01-01-1300-00-done" in (await list()), false);
  });

  it("rejects unknown and malformed run ids", async () => {
    assert.equal((await fetch(srv.url + "/api/runs/2026-01-01-0000-00-nope", { method: "DELETE", headers: origin() })).status, 404);
    assert.equal((await fetch(srv.url + "/api/runs/..%2Fkraftwerk.yml", { method: "DELETE", headers: origin() })).status, 400);
    await stat(path.join(fx.root, "kraftwerk.yml"));
  });
});
