import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cli } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";

/**
 * `kraftwerk doctor` on what a cloned workspace gets wrong: no workspace id,
 * routines nobody runs, routines naming a retired identity. Without --fix it
 * says so; with --fix it adds the id (comments kept) and makes this machine
 * the runner, committing routines.yml. PATH holds node and the system tools
 * only, so doctor's docker and harness probes find nothing to start.
 */
describe("kraftwerk doctor: workspace id and routine runners", () => {
  let fx: Fixture;
  const env = () => ({ PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` });
  const doctor = (...args: string[]) => cli(fx.root, fx.home, ["doctor", ...args], { env: env() });
  const CONFIG = "# the team's workspace\nname: fixture   # shown in the header\ngit:\n  interval: 0\n";

  before(async () => {
    fx = await makeProject(CONFIG);
    await mkdir(path.join(fx.home, ".kraftwerk"), { recursive: true });
    await writeFile(path.join(fx.home, ".kraftwerk", "identity.json"), JSON.stringify({ handle: "tester", machine: "box", previous: ["tester@oldbox"] }));
    await fx.write("agents/max/agent.yml", "name: Max\nharness: claude\n");
    await fx.write(
      "agents/max/routines.yml",
      "- id: loose\n  name: Loose\n  schedule: \"@daily\"\n  prompt: p\n  enabled: true\n" +
        "- id: old\n  name: Old\n  schedule: \"@daily\"\n  prompt: p\n  enabled: true\n  runs_on: tester@oldbox\n" +
        "- id: theirs\n  name: Theirs\n  schedule: \"@daily\"\n  prompt: p\n  enabled: true\n  runs_on: anna@laptop\n",
    );
    fx.git("add", "-A");
    fx.git("commit", "-q", "-m", "fixture");
  });
  after(() => fx.cleanup());

  it("without --fix: names the missing id, the unassigned and the retired routines, changes nothing", async () => {
    const r = await doctor();
    assert.match(r.stdout, /⚠ no workspace id in kraftwerk\.yml — .*`kraftwerk doctor --fix` adds one/);
    assert.match(r.stdout, /⚠ 1 enabled routine\(s\) have no runner — they fire nowhere — max\/loose · .*runs them here: tester@box/);
    assert.match(r.stdout, /⚠ 1 routine\(s\) name the retired identity tester@oldbox — max\/old · .*moves them to tester@box/);
    assert.equal(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), CONFIG);
    assert.equal(fx.git("status", "--porcelain"), "");
  });

  it("--fix adds the id with the comments intact and adopts both routines in one commit", async () => {
    const r = await doctor("--fix");
    assert.match(r.stdout, /✔ workspace id: ws_[a-z0-9]{10} — added to kraftwerk\.yml/);
    const yml = await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8");
    assert.match(yml, /^# the team's workspace\nid: ws_[a-z0-9]{10} .*\nname: fixture {3}# shown in the header\ngit:\n {2}interval: 0\n$/);

    assert.match(r.stdout, /✔ 2 routine\(s\) now run here \(tester@box\) — max\/loose, max\/old/);
    assert.match(r.stdout, /✔ committed agents\/max\/routines\.yml/);
    assert.equal(fx.git("show", "--name-only", "--format=", "HEAD"), "agents/max/routines.yml");
    const routines = await readFile(path.join(fx.root, "agents/max/routines.yml"), "utf8");
    assert.equal(routines.match(/runs_on: tester@box/g)?.length, 2);
    assert.match(routines, /runs_on: anna@laptop/, "another machine's routine is left alone");

    const again = await doctor();
    assert.match(again.stdout, /✔ workspace id: ws_/);
    assert.match(again.stdout, /✔ routines: runner identity tester@box/);
  });
});
