import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { WorkflowDetail, WorkflowSummary } from "../../src/inspector/workflows.js";

/**
 * Workflows over the HTTP API: the listing says whether a workflow reads
 * the request, and the run trigger refuses an empty request only for those
 * that do. Nothing here starts a run — that would spawn the runner.
 */
describe("workflows API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  const origin = () => ({ origin: new URL(srv.url).origin, "content-type": "application/json" });

  before(async () => {
    fx = await makeProject("name: fixture\n");
    await fx.write(
      "workflows/ask/workflow.yml",
      "name: ask\ndescription: needs a topic\nagents:\n  a:\n    model: haiku\n    tools: [Read]\n    persona: |\n      You answer.\nsteps:\n  - name: answer\n    agent: a\n    prompt: prompts/answer.md\n"
    );
    await fx.write("workflows/ask/prompts/answer.md", "Answer this: ${{ request }}\n");
    await fx.write(
      "workflows/tick/workflow.yml",
      "name: tick\ndescription: no request needed\nsteps:\n  - name: stamp\n    run: |\n      set -e\n      date > stamp.txt\n"
    );
    await fx.write(
      "workflows/env/workflow.yml",
      "name: env\ndescription: reads the env\nsteps:\n  - name: echo\n    run: |\n      set -e\n      echo \"$REQUEST\" > out.txt\n"
    );
    await fx.write(
      "workflows/py/workflow.yml",
      "name: py\ndescription: reads the env from python\nsteps:\n  - name: parse\n    run: scripts/parse.sh\n"
    );
    await fx.write(
      "workflows/py/scripts/parse.sh",
      "#!/usr/bin/env bash\npython3 - <<'PY'\nimport os\nprint(os.environ.get(\"REQUEST\", \"\"))\nPY\n"
    );
    await fx.write(
      "workflows/shout/workflow.yml",
      "name: shout\ndescription: a prompt that merely says REQUEST\nagents:\n  a:\n    model: haiku\n    tools: [Read]\n    persona: |\n      You shout.\nsteps:\n  - name: shout\n    agent: a\n    prompt: |\n      Shout REQUEST three times.\n      Then stop.\n"
    );
    await fx.write("workflows/broken.yml", "name: [\n");
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("lists workflows with a usesRequest flag (prompt files and the REQUEST env var count)", async () => {
    const v = (await (await fetch(srv.url + "/api/workflows")).json()) as { workflows: WorkflowSummary[] };
    const by = Object.fromEntries(v.workflows.map((w) => [w.slug, w]));
    assert.equal(by.ask.usesRequest, true);
    assert.equal(by.ask.steps, 1);
    assert.equal(by.ask.agents, 1);
    assert.equal(by.tick.usesRequest, false);
    assert.equal(by.env.usesRequest, true);
    assert.equal(by.py.usesRequest, true, "REQUEST read from python in a script file counts");
    assert.equal(by.shout.usesRequest, false, "the word in a prompt is not the variable");
    assert.ok(by.broken.error, "a broken yml is listed with its error");
    const detail = (await (await fetch(srv.url + "/api/workflows/tick")).json()) as WorkflowDetail;
    assert.equal(detail.usesRequest, false);
    const ask = (await (await fetch(srv.url + "/api/workflows/ask")).json()) as WorkflowDetail;
    assert.equal(ask.usesRequest, true);
  });

  it("refuses to run a request-reading workflow without a request", async () => {
    const r = await fetch(srv.url + "/api/workflows/ask/run", {
      method: "POST",
      headers: origin(),
      body: JSON.stringify({ request: "   ", sandbox: false }),
    });
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /needs a request/);
  });

  it("refuses a broken or unknown workflow", async () => {
    for (const slug of ["broken", "nope"]) {
      const r = await fetch(srv.url + `/api/workflows/${slug}/run`, {
        method: "POST",
        headers: origin(),
        body: JSON.stringify({ request: "x", sandbox: false }),
      });
      assert.equal(r.status, 404, slug);
    }
  });

  it("reports docker status for the sandbox option", async () => {
    const d = (await (await fetch(srv.url + "/api/workflows/any/run")).json()) as { available: boolean; image: boolean };
    assert.equal(typeof d.available, "boolean");
    assert.equal(typeof d.image, "boolean");
  });
});
