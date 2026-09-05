import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli } from "../helpers/cli.js";
import { makeEmptyDir } from "../helpers/project.js";

/**
 * `run` and the request argument: a workflow whose steps read
 * `${{ request }}` insists on one, a script-only workflow that never does
 * runs without it. The script step is plain bash — no agent, no docker.
 */
describe("kraftwerk run without a request", () => {
  let dir: Awaited<ReturnType<typeof makeEmptyDir>>;
  const write = async (rel: string, content: string) => {
    const abs = path.join(dir.root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  };

  before(async () => {
    dir = await makeEmptyDir();
    await write("kraftwerk.yml", "name: fixture\nworkflows: workflows\noutput: output\n");
    await write(
      "workflows/tick/workflow.yml",
      "name: tick\ndescription: writes a stamp\nsteps:\n  - name: stamp\n    run: |\n      set -e\n      echo stamped > stamp.txt\n    gates:\n      - file_non_empty: stamp.txt\n"
    );
    await write(
      "workflows/ask/workflow.yml",
      "name: ask\ndescription: answers\nagents:\n  a:\n    model: haiku\n    tools: [Read]\n    persona: |\n      You answer.\nsteps:\n  - name: answer\n    agent: a\n    prompt: 'Answer: ${{ request }}'\n"
    );
  });
  after(() => dir.cleanup());

  it("still demands a request when a step reads it", async () => {
    const r = await cli(dir.root, dir.home, ["run", "ask", "--json"]);
    assert.equal(r.code, 2, r.all);
    assert.match(r.all, /No request given/);
  });

  it("runs a script-only workflow with no request at all", async () => {
    const r = await cli(dir.root, dir.home, ["run", "tick", "--yes", "--json"]);
    assert.equal(r.code, 0, r.all);
    const out = JSON.parse(r.stdout) as { ok: boolean; request: string; runDir: string };
    assert.equal(out.ok, true);
    assert.equal(out.request, "");
    assert.ok(existsSync(path.join(out.runDir, "stamp.txt")), "the script ran in the run dir");
    const runs = await readdir(path.join(dir.root, "output", "runs"));
    assert.ok(runs.some((id) => id.endsWith("-tick")), "run folder named after the workflow");
  });
});
