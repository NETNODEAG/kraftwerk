import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli } from "../helpers/cli.js";
import { makeEmptyDir, makeProject, type Fixture } from "../helpers/project.js";

/**
 * The project's .env reaches every command: doctor lists what it loaded
 * and a workflow's `requires:` is satisfied from the file alone. A
 * variable the shell sets wins; one an earlier kraftwerk process injected
 * (a restarted server, a project launched from another workspace) does not.
 */
describe("project .env", () => {
  let fx: Fixture;
  before(async () => {
    fx = await makeProject("name: fixture\nworkflows: workflows\n");
    await fx.write(
      "workflows/needs-key/workflow.yml",
      "name: needs-key\ndescription: needs an API key\nrequires: [DEMO_API_KEY]\nagents:\n  a:\n    model: haiku\n    tools: [Read]\n    persona: persona.md\nsteps:\n  - name: s\n    agent: a\n    prompt: prompt.md\n"
    );
    await fx.write("workflows/needs-key/persona.md", "You answer.\n");
    await fx.write("workflows/needs-key/prompt.md", "Answer.\n");
  });
  after(() => fx.cleanup());

  const doctor = (env: Record<string, string> = {}) => cli(fx.root, fx.home, ["doctor"], { env });

  it("reports a missing file and an unsatisfied requires", async () => {
    const r = await doctor({ DEMO_API_KEY: "" });
    assert.match(r.stdout, /• no \.env — variables for agents, workflows and the tunnel can live there/);
    assert.match(r.stdout, /⚠ needs-key: env missing — DEMO_API_KEY/);
  });

  it("loads the file, satisfies requires from it, and lists names only", async () => {
    await fx.write(".env", "# secrets\nDEMO_API_KEY=sk-secret-value\nexport OTHER='x'\n");
    const r = await doctor({ DEMO_API_KEY: "" });
    assert.match(r.stdout, /✔ \.env: 2 variable\(s\) loaded — DEMO_API_KEY, OTHER/);
    assert.match(r.stdout, /✔ needs-key: requires satisfied — DEMO_API_KEY/);
    assert.doesNotMatch(r.all, /sk-secret-value/);
  });

  it("a variable the shell sets wins over the file", async () => {
    const r = await doctor({ DEMO_API_KEY: "from-shell" });
    assert.match(r.stdout, /✔ \.env: 2 variable\(s\) loaded — OTHER, DEMO_API_KEY \(shell wins\)/);
  });

  it("a value injected by an earlier kraftwerk process is replaced, not kept (restart)", async () => {
    const r = await doctor({ DEMO_API_KEY: "stale-from-supervisor", KRAFTWERK_DOTENV_KEYS: "DEMO_API_KEY" });
    assert.match(r.stdout, /✔ \.env: 2 variable\(s\) loaded — DEMO_API_KEY, OTHER/);
    assert.doesNotMatch(r.stdout, /shell wins/);
  });

  it("init git-ignores .env", async () => {
    const dir = await makeEmptyDir();
    try {
      const r = await cli(dir.root, dir.home, ["init"]);
      assert.equal(r.code, 0, r.all);
      const gitignore = await readFile(path.join(dir.root, ".gitignore"), "utf8");
      assert.match(gitignore, /^\.env$/m);
      assert.match(gitignore, /^kraftwerk-data\/output\/$/m);
    } finally {
      await dir.cleanup();
    }
  });
});
