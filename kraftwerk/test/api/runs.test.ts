import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
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
  // Three declared steps; the first passed, the second failed, the third never started.
  const stoppedTrace = trace([
    { event: "run_start", ts: "2026-01-01T14:00:00Z", workflow: "triage", request: "tuesday batch", steps: [{ name: "check", kind: "script" }, { name: "draft", kind: "agent", agent: "w" }, { name: "publish", kind: "script" }] },
    { event: "phase_start", ts: "2026-01-01T14:00:01Z", phase: "check", kind: "script" },
    { event: "phase_end", ts: "2026-01-01T14:00:02Z", phase: "check", status: "ok", stats: { durationMs: 1000, attempts: 1 } },
    { event: "phase_start", ts: "2026-01-01T14:00:03Z", phase: "draft", kind: "agent", agent: "w" },
    { event: "phase_end", ts: "2026-01-01T14:00:09Z", phase: "draft", status: "failed", stats: { durationMs: 6000, costUsd: 0.02, attempts: 2 } },
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
    await writeRun("2026-01-01-1400-00-stopped", { "trace.jsonl": stoppedTrace });
    // Live on "review" and asking a person: decision-request.json next to the trace.
    const now = new Date().toISOString();
    await writeRun("2026-01-01-1500-00-waiting", {
      "trace.jsonl": trace([
        { event: "run_start", ts: now, workflow: "release-approval", request: "tunnel", steps: [{ name: "draft", kind: "script" }, { name: "review", kind: "script" }] },
        { event: "phase_start", ts: now, phase: "draft", kind: "script" },
        { event: "phase_end", ts: now, phase: "draft", status: "ok", stats: { durationMs: 10, attempts: 1 } },
        { event: "phase_start", ts: now, phase: "review", kind: "script" },
      ]),
      "decision-request.json": JSON.stringify({
        title: "Release note ready for review",
        options: [{ value: "approve", label: "Approve" }, "reject"],
        note: "required",
        file: "verdict.json",
      }),
    });
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

  it("a stopped run reports the phase it failed on as its current phase, a finished one none", async () => {
    const by = await list();
    const stopped = by["2026-01-01-1400-00-stopped"];
    assert.equal(stopped.status, "failed");
    assert.equal(stopped.currentPhase, "draft", "the board places the card in the column where the run broke");
    assert.equal(stopped.phasesDone, 1);
    assert.equal(stopped.phasesTotal, 3);
    assert.equal(by["2026-01-01-1300-00-done"].currentPhase, undefined);
  });

  it("a run asking for a decision is flagged, shows the request, and takes one answer from the offered options", async () => {
    const id = "2026-01-01-1500-00-waiting";
    const detail = async () => (await (await fetch(`${srv.url}/api/runs/${id}`)).json()) as RunDetail;
    const decide = (body: unknown) =>
      fetch(`${srv.url}/api/runs/${id}/decision`, {
        method: "POST",
        headers: { ...origin(), "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    assert.equal((await list())[id].awaitingDecision, true);
    let d = await detail();
    assert.equal(d.status, "running");
    assert.deepEqual(d.decision?.request.options, [{ value: "approve", label: "Approve" }, { value: "reject" }], "string options are normalized");
    assert.equal(d.decision?.request.note, "required");
    assert.equal(d.decision?.file, "verdict.json");
    assert.equal(d.decision?.answer, undefined);

    let r = await decide({ decision: "maybe", note: "hm" });
    assert.equal(r.status, 400, "only the offered options");
    r = await decide({ decision: "approve" });
    assert.equal(r.status, 400, "the note is required by this request");
    r = await decide({ decision: "approve", note: "ship it" });
    assert.equal(r.status, 200);
    const answer = (await r.json()) as { decision: string; note: string; by: string; decidedAt: string };
    assert.equal(answer.decision, "approve");
    assert.equal(answer.note, "ship it");
    assert.equal(answer.by, "human");

    // The answer is the file the request named, and it is written once.
    const onDisk = JSON.parse(await readFile(path.join(runsDir(), id, "verdict.json"), "utf8")) as typeof answer;
    assert.equal(onDisk.decision, "approve");
    assert.equal(onDisk.decidedAt, answer.decidedAt);
    r = await decide({ decision: "reject", note: "changed my mind" });
    assert.equal(r.status, 409);
    d = await detail();
    assert.equal(d.decision?.answer?.decision, "approve");
    assert.equal(d.awaitingDecision, false);
    assert.equal((await list())[id].awaitingDecision, undefined, "no longer flagged in the list");

    // A run nobody asked anything of has nothing to answer.
    r = await fetch(`${srv.url}/api/runs/2026-01-01-1300-00-done/decision`, {
      method: "POST",
      headers: { ...origin(), "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    });
    assert.equal(r.status, 404);
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
