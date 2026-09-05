import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeEmptyDir } from "../helpers/project.js";

/** `protocol: acp` in workflow.yml: accepted workflow-wide and per agent, refused for pi, visible in list/doctor. */
describe("workflow protocol", () => {
  let dir: Awaited<ReturnType<typeof makeEmptyDir>>;
  const agent = (extra = "") =>
    `    model: haiku\n    tools: [Read]\n${extra}    persona: |\n      You answer.\n`;
  const write = async (rel: string, content: string) => {
    const abs = path.join(dir.root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  };

  before(async () => {
    dir = await makeEmptyDir();
    await write("kraftwerk.yml", "name: fixture\nworkflows: workflows\n");
    await write(
      "workflows/acp/workflow.yml",
      `name: acp\ndescription: all agents over the protocol\nprotocol: acp\nagents:\n  a:\n${agent()}  b:\n${agent("    runs-on: codex\n    protocol: cli\n")}steps:\n  - name: one\n    agent: a\n    prompt: 'Say hi to \${{ request }}'\n  - name: two\n    agent: b\n    prompt: 'And again'\n`
    );
    await write(
      "workflows/bad/workflow.yml",
      `name: bad\ndescription: pi cannot\nagents:\n  p:\n${agent("    runs-on: pi\n    protocol: acp\n")}steps:\n  - name: one\n    agent: p\n    prompt: 'x'\n`
    );
  });
  after(() => dir.cleanup());

  it("lists the protocol per agent: the workflow default, overridden per agent", async () => {
    const rows = json<Array<{ name: string; error?: string; agents?: Array<{ id: string; harness: string; protocol: string }> }>>(
      await cli(dir.root, dir.home, ["list", "--json"])
    );
    const acp = rows.find((r) => r.name === "acp")!;
    assert.deepEqual(
      acp.agents!.map((a) => [a.id, a.harness, a.protocol]),
      [["a", "claude", "acp"], ["b", "codex", "cli"]]
    );
    const table = await cli(dir.root, dir.home, ["list"]);
    assert.match(table.stdout, /a \(acp:haiku\)/);
  });

  it("refuses runs-on pi with the protocol", async () => {
    const r = await cli(dir.root, dir.home, ["validate", "workflows/bad/workflow.yml"]);
    assert.notEqual(r.code, 0);
    assert.match(r.all, /runs-on "pi" has no agent-protocol adapter/);
  });

  it("doctor counts the adapters as present without a CLI", async () => {
    const r = await cli(dir.root, dir.home, ["doctor"]);
    assert.match(r.stdout, /agent protocol adapters/);
  });
});
