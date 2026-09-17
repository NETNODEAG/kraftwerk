import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cli } from "../helpers/cli.js";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { RunDetail, RunListItem } from "../../src/inspector/runs.js";

/**
 * The human step, end to end: a real `kraftwerk run` whose script step
 * writes decision-request.json and waits, the inspector flags the run and
 * takes the answer over HTTP, the script picks the answer up and the run
 * goes on. Two rounds — the first note becomes feedback.md, which is the
 * `if:` for a revise step and a second decision — mirror the playground's
 * article-review workflow without its agent step: plain bash, no agent, no
 * docker. A second run answers "ship" at once and the feedback-gated steps
 * are skipped.
 */
describe("decision loop through a real run", () => {
  let fx: Fixture;
  let srv: RunningServer;
  const origin = () => ({ origin: new URL(srv.url).origin });

  // Polls every 250 ms for up to 15 s (the runner's own poll is 1 s).
  const waitFor = async <T>(what: string, probe: () => Promise<T | undefined>): Promise<T> => {
    for (let i = 0; i < 60; i++) {
      const v = await probe();
      if (v !== undefined) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const listed = (id: string) => async () =>
    ((await (await fetch(`${srv.url}/api/runs`)).json()) as { runs: RunListItem[] }).runs.find((r) => r.id === id);
  const detail = async (id: string) => (await (await fetch(`${srv.url}/api/runs/${id}`)).json()) as RunDetail;
  const decide = (id: string, body: object) =>
    fetch(`${srv.url}/api/runs/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...origin() },
      body: JSON.stringify(body),
    });

  // A script that asks and waits (multi-line, so `run:` is inline bash, not a file).
  const ask = (file: string, options: string) =>
    [
      "set -e",
      `printf '%s' '{"title":"Q","options":${options},"file":"${file}"}' > decision-request.json`,
      `for i in $(seq 1 30); do [ -s ${file} ] && break; sleep 1; done`,
      `[ -s ${file} ] || { echo 'no answer' >&2; exit 1; }`,
      `python3 -c 'import json;d=json.load(open("${file}"));print(d["decision"]);open("last.txt","w").write(d["decision"]);n=d.get("note","");d["decision"]=="revise" and open("feedback.md","w").write(n)'`,
    ]
      .map((l) => "      " + l)
      .join("\n");

  before(async () => {
    fx = await makeProject("name: fixture\nworkflows: workflows\noutput: output\ngit:\n  interval: 0\n");
    await fx.write(
      "workflows/approve/workflow.yml",
      [
        "name: approve",
        "description: waits for a person twice",
        "steps:",
        "  - name: review",
        "    run: |",
        ask("decision.json", '["ship","revise"]'),
        "    gates:",
        "      - file_non_empty: last.txt",
        "  - name: revise",
        "    if:",
        "      - file_non_empty: feedback.md",
        "    run: |",
        "      set -e",
        "      cp feedback.md revised.txt",
        "  - name: check",
        "    if:",
        "      - file_non_empty: feedback.md",
        "    run: |",
        ask("decision-2.json", '["ship","drop"]'),
        "  - name: publish",
        "    run: |",
        "      set -e",
        "      cp last.txt outcome.txt",
        "    gates:",
        "      - file_non_empty: outcome.txt",
        "",
      ].join("\n")
    );
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("waits in review, takes the note as feedback, waits again on the revision, then finishes", async () => {
    const id = "2026-02-01-1000-00-approve";
    const running = cli(fx.root, fx.home, ["run", "approve", "--yes", "--json", "--run-id", id]);
    const runDir = path.join(fx.root, "output", "runs", id);

    // Round 1: the list flags the run, the card sits in "review".
    const waiting = await waitFor("the run to ask", async () => {
      const r = await listed(id)();
      return r?.awaitingDecision ? r : undefined;
    });
    assert.equal(waiting.status, "running");
    assert.equal(waiting.currentPhase, "review");
    let d = await detail(id);
    assert.equal(d.decision?.file, "decision.json");
    assert.deepEqual(d.decision?.request.options.map((o) => o.value), ["ship", "revise"]);

    let r = await decide(id, { decision: "revise", note: "shorter, please" });
    assert.equal(r.status, 200, await r.text());

    // The note became the brief; the gated steps ran; round 2 asks again.
    d = await waitFor("the second question", async () => {
      const x = await detail(id);
      return x.awaitingDecision && x.decision?.file === "decision-2.json" ? x : undefined;
    });
    assert.equal(d.currentPhase, "check");
    assert.equal(await readFile(path.join(runDir, "feedback.md"), "utf8"), "shorter, please");
    assert.equal(await readFile(path.join(runDir, "revised.txt"), "utf8"), "shorter, please");
    assert.deepEqual(d.decision?.request.options.map((o) => o.value), ["ship", "drop"]);
    assert.equal(d.decision?.answer, undefined, "round 2 starts unanswered");

    // The round-1 answer file is still on disk and cannot be answered twice.
    r = await decide(id, { decision: "ship" });
    assert.equal(r.status, 200, await r.text());
    r = await decide(id, { decision: "drop" });
    assert.equal(r.status, 409);

    const out = await running;
    assert.equal(out.code, 0, out.all);
    assert.equal(await readFile(path.join(runDir, "outcome.txt"), "utf8"), "ship");
    d = await detail(id);
    assert.equal(d.status, "ok");
    assert.equal(d.awaitingDecision, false);
    assert.equal(d.decision?.answer?.decision, "ship");
    assert.deepEqual(
      d.phases.map((p) => [p.phase, p.status]),
      [["review", "ok"], ["revise", "ok"], ["check", "ok"], ["publish", "ok"]]
    );
  });

  it("skips the feedback-gated steps when the first answer is ship", async () => {
    const id = "2026-02-01-1100-00-approve";
    const running = cli(fx.root, fx.home, ["run", "approve", "--yes", "--json", "--run-id", id]);
    await waitFor("the run to ask", async () => ((await listed(id)())?.awaitingDecision ? true : undefined));
    const r = await decide(id, { decision: "ship" });
    assert.equal(r.status, 200, await r.text());

    const out = await running;
    assert.equal(out.code, 0, out.all);
    const runDir = path.join(fx.root, "output", "runs", id);
    assert.ok(!existsSync(path.join(runDir, "feedback.md")), "no note, no feedback");
    assert.ok(!existsSync(path.join(runDir, "revised.txt")), "revise was skipped");
    assert.ok(!existsSync(path.join(runDir, "decision-2.json")), "check was skipped");
    assert.equal(await readFile(path.join(runDir, "outcome.txt"), "utf8"), "ship");
    const d = await detail(id);
    assert.equal(d.status, "ok");
    // Skipped steps stay in pipeline order, count as settled, and say why.
    assert.deepEqual(d.phases.map((p) => [p.phase, p.status]), [["review", "ok"], ["revise", "skipped"], ["check", "skipped"], ["publish", "ok"]]);
    assert.match(d.phases[1].summary ?? "", /feedback\.md/);
    assert.equal(d.phasesDone, 4);
    assert.equal(d.phasesTotal, 4);
  });
});
