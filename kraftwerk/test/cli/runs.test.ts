import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeEmptyDir } from "../helpers/project.js";

/** `runs` reads trace.jsonl files; there is no registry, so the trace is the record. */
describe("kraftwerk runs", () => {
  let dir: Awaited<ReturnType<typeof makeEmptyDir>>;
  const run = (args: string[]) => cli(dir.root, dir.home, ["runs", ...args]);

  const trace = async (id: string, events: object[]) => {
    const d = path.join(dir.root, "kraftwerk-data", "output", "runs", id);
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, "trace.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  };
  const stats = { durationMs: 1200, inputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 20, costUsd: 0.01, attempts: 1 };

  before(async () => {
    dir = await makeEmptyDir();
    await cli(dir.root, dir.home, ["init"]);
  });
  after(() => dir.cleanup());

  it("says so when there are no runs", async () => {
    const r = await run([]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /No runs under/);
    assert.deepEqual(json(await run(["--json"])), []);
  });

  it("lists runs newest first with their status", async () => {
    await trace("2026-01-01T10-00-00-aaaa", [
      { event: "run_start", ts: "2026-01-01T10:00:00Z", workflow: "hello", request: "first" },
      { event: "phase_end", phase: "answer", status: "ok", stats },
      { event: "run_summary", total: { durationMs: 1200, costUsd: 0.01 } },
    ]);
    await trace("2026-01-02T10-00-00-bbbb", [
      { event: "run_start", ts: "2026-01-02T10:00:00Z", workflow: "hello", request: "second" },
      { event: "gate_result", gate: "file_non_empty", passed: false, failure: "answer.md is empty" },
      { event: "phase_end", phase: "answer", status: "failed", stats },
    ]);
    await trace("2026-01-03T10-00-00-cccc", [
      { event: "run_start", ts: "2026-01-03T10:00:00Z", workflow: "hello", request: "third" },
    ]);
    await mkdir(path.join(dir.root, "kraftwerk-data", "output", "runs", "not-a-run"), { recursive: true });

    const rows = json<{ id: string; status: string; request: string; costUsd?: number }[]>(await run(["--json"]));
    assert.deepEqual(rows.map((r) => [r.request, r.status]), [["third", "incomplete"], ["second", "failed"], ["first", "ok"]]);
    assert.equal(rows[2].costUsd, 0.01);
    assert.ok(!rows.some((r) => r.id === "not-a-run"), "a folder without a trace is not a run");

    const table = await run([]);
    assert.match(table.stdout, /hello.*failed/);
  });

  it("show prints phases, failed gates and the total; a missing run exits 2", async () => {
    const ok = await run(["show", "2026-01-01T10-00-00-aaaa"]);
    assert.equal(ok.code, 0, ok.all);
    assert.match(ok.stdout, /^hello ok/m);
    assert.match(ok.stdout, /✔ answer/);
    assert.match(ok.stdout, /total: .*\$0\.0100/);

    const failed = await run(["show", "2026-01-02T10-00-00-bbbb"]);
    assert.match(failed.stdout, /✖ answer/);
    assert.match(failed.stdout, /gate file_non_empty: answer\.md is empty/);

    const events = json<{ events: { event: string }[] }>(await run(["show", "2026-01-02T10-00-00-bbbb", "--json"]));
    assert.equal(events.events.length, 3);

    const missing = await run(["show", "nope"]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /Run "nope" not found/);
  });
});
