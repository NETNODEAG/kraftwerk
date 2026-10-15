import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import { dueRoutines, type RoutineStatus } from "../../src/core/routines.js";

/**
 * Who fires a routine. A workspace is cloned on several machines; each
 * routine names its runner (`runs_on: handle@machine`) and only that machine
 * fires it. Unassigned routines fire nowhere until one machine adopts them,
 * which writes routines.yml and commits it.
 *
 * Every schedule here is "tomorrow, 03:00": the server's own scheduler never
 * finds one due while the test runs, so no agent is ever spawned;
 * `dueRoutines` is asked about that minute directly.
 */
describe("routine runners (runs_on)", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const ME = "tester@box";
  const OLD = "tester@oldbox";
  const today = new Date();
  const DUE = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 3, 0);
  const SCHEDULE = `0 3 ${DUE.getDate()} ${DUE.getMonth() + 1} *`;
  const headers = () => ({ "content-type": "application/json", origin });
  const post = (p: string, body?: unknown) =>
    fetch(srv.url + p, { method: "POST", headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const routines = async (slug: string): Promise<RoutineStatus[]> => ((await (await fetch(`${srv.url}/api/agents/${slug}/routines`)).json()) as { routines: RoutineStatus[] }).routines;
  const yml = async (slug: string) => parse(await readFile(path.join(fx.root, "agents", slug, "routines.yml"), "utf8")) as Record<string, unknown>[];

  before(async () => {
    fx = await makeProject();
    await mkdir(path.join(fx.home, ".kraftwerk"), { recursive: true });
    await writeFile(path.join(fx.home, ".kraftwerk", "identity.json"), JSON.stringify({ handle: "tester", machine: "box", previous: [OLD] }));
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
    for (const name of ["Alpha", "Beta"]) {
      const r = await post("/api/agents", { name, harness: "claude", system: "x" });
      assert.equal(r.status, 200, await r.text());
    }
    // Everything so far is committed: the adopt commits below must hold routines.yml alone.
    fx.git("add", "-A");
    fx.git("commit", "-q", "-m", "fixture");
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("GET /api/identity says who this machine is", async () => {
    const r = await fetch(`${srv.url}/api/identity`);
    assert.deepEqual(await r.json(), { handle: "tester", machine: "box", identity: ME, previous: [OLD] });
  });

  it("a routine created through the API runs here; private round-trips through routines.yml", async () => {
    const r = await post("/api/agents/alpha/routines", { name: "Here", schedule: SCHEDULE, prompt: "p", private: true });
    const saved = (await r.json()) as RoutineStatus;
    assert.equal(r.status, 200, JSON.stringify(saved));
    assert.equal(saved.runsOn, ME);
    assert.equal(saved.private, true);
    const [row] = await yml("alpha");
    assert.equal(row.runs_on, ME, "snake_case on disk");
    assert.equal(row.private, true);
    assert.equal("runsOn" in row, false);
    const [status] = await routines("alpha");
    assert.equal(status.runner, "here");
    assert.ok(status.nextRunAt, "fires here, so it has a next run");

    // An update that does not mention runsOn or private keeps both.
    await post("/api/agents/alpha/routines", { id: "here", name: "Here", schedule: SCHEDULE, prompt: "p2" });
    const [kept] = await yml("alpha");
    assert.equal(kept.runs_on, ME);
    assert.equal(kept.private, true);
    assert.equal(kept.prompt, "p2");
  });

  it("refuses a malformed runsOn", async () => {
    const r = await post("/api/agents/alpha/routines", { name: "Bad", schedule: SCHEDULE, prompt: "p", runsOn: "no-at-sign" });
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /runs_on must be <handle>@<machine>/);
  });

  it("only an exact identity match fires; unassigned, other and retired routines show why and have no next run", async () => {
    await post("/api/agents/alpha/routines", { name: "Elsewhere", schedule: SCHEDULE, prompt: "p", runsOn: "anna@laptop" });
    await post("/api/agents/alpha/routines", { name: "Retired", schedule: SCHEDULE, prompt: "p", runsOn: OLD });
    await post("/api/agents/alpha/routines", { name: "Nobody", schedule: SCHEDULE, prompt: "p", runsOn: null });
    await post("/api/agents/alpha/routines", { name: "Off", schedule: SCHEDULE, prompt: "p", runsOn: null, enabled: false });
    const all = Object.fromEntries((await routines("alpha")).map((r) => [r.id, r]));
    assert.equal(all.elsewhere.runner, "elsewhere");
    assert.equal(all.elsewhere.retired, undefined);
    assert.equal(all.retired.runner, "elsewhere");
    assert.equal(all.retired.retired, true);
    assert.equal(all.nobody.runner, "unassigned");
    assert.equal(all.nobody.runsOn, undefined);
    for (const id of ["elsewhere", "retired", "nobody", "off"]) assert.equal(all[id].nextRunAt, undefined, id);
    assert.equal("runs_on" in (await yml("alpha")).find((r) => r.id === "nobody")!, false);

    const due = (await dueRoutines(DUE)).map((d) => `${d.slug}/${d.routine.id}`);
    assert.deepEqual(due, ["alpha/here"], "not elsewhere, not retired, not unassigned");
    assert.deepEqual((await dueRoutines(DUE, "anna@laptop")).map((d) => d.routine.id), ["elsewhere"], "the other machine fires its own");
    assert.deepEqual(await dueRoutines(new Date(DUE.getTime() + 3_600_000)), [], "nothing outside its minute");

    const list = (await (await fetch(`${srv.url}/api/routines`)).json()) as { routines: RoutineStatus[] };
    assert.equal(list.routines.find((r) => r.id === "nobody")?.runner, "unassigned", "the workspace listing carries the runner too");
  });

  it("attention lists routines without a runner and those naming a retired identity", async () => {
    const { items } = (await (await fetch(`${srv.url}/api/attention`)).json()) as { items: Array<{ id: string; kind: string; title: string; href: string; routines?: { id: string }[] }> };
    const unassigned = items.find((i) => i.id === "runner:unassigned");
    assert.ok(unassigned, JSON.stringify(items));
    assert.equal(unassigned.kind, "runner");
    assert.match(unassigned.title, /^1 routine has no runner/, "a disabled one is not counted");
    assert.equal(unassigned.href, "/agents/alpha/info", "the profile's routines panel, where “run these here” is");
    const retired = items.find((i) => i.id === `runner:retired:${OLD}`);
    assert.ok(retired);
    assert.match(retired.title, new RegExp(`1 routine names a retired identity ${OLD}`));
  });

  it("POST /api/agents/:slug/routines/:id/adopt runs one routine here and commits routines.yml", async () => {
    const r = await post("/api/agents/alpha/routines/elsewhere/adopt");
    const body = (await r.json()) as { runsOn: string; adopted: { agent: string; id: string; from?: string }[]; files: string[]; commit: { ok: boolean; error?: string }; routine: RoutineStatus };
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.runsOn, ME);
    assert.deepEqual(body.adopted, [{ agent: "alpha", id: "elsewhere", name: "Elsewhere", from: "anna@laptop" }]);
    assert.deepEqual(body.files, ["agents/alpha/routines.yml"]);
    assert.equal(body.commit.ok, true, body.commit.error ?? "");
    assert.equal(body.routine.runner, "here");
    assert.equal(fx.git("log", "-1", "--format=%s"), `Routines run on ${ME}: alpha/elsewhere`);
    assert.equal(fx.git("show", "--name-only", "--format=", "HEAD"), "agents/alpha/routines.yml");
    assert.equal(fx.git("status", "--porcelain", "--", "agents/alpha/routines.yml"), "", "nothing left uncommitted");

    assert.equal((await post("/api/agents/alpha/routines/ghost/adopt")).status, 404);
  });

  it("POST /api/routines/adopt takes every unassigned routine (retired too with retired: true), one commit", async () => {
    await post("/api/agents/beta/routines", { name: "Loose", schedule: SCHEDULE, prompt: "p", runsOn: null });
    let r = await post("/api/routines/adopt");
    let body = (await r.json()) as { adopted: { agent: string; id: string; from?: string }[]; files: string[]; commit: { ok: boolean; error?: string } | null };
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.deepEqual(body.adopted.map((a) => `${a.agent}/${a.id}`).sort(), ["alpha/nobody", "beta/loose"], "the disabled one and the retired one stay");
    assert.deepEqual(body.files.sort(), ["agents/alpha/routines.yml", "agents/beta/routines.yml"]);
    assert.equal(body.commit?.ok, true, body.commit?.error ?? "");
    assert.deepEqual(fx.git("show", "--name-only", "--format=", "HEAD").split("\n").sort(), ["agents/alpha/routines.yml", "agents/beta/routines.yml"]);
    assert.equal(((await routines("alpha")).find((x) => x.id === "off"))?.runsOn, undefined);

    r = await post("/api/routines/adopt", { retired: true });
    body = (await r.json()) as typeof body;
    assert.deepEqual(body.adopted, [{ agent: "alpha", id: "retired", name: "Retired", from: OLD }]);
    assert.equal(body.commit?.ok, true);

    r = await post("/api/routines/adopt", { retired: true });
    body = (await r.json()) as typeof body;
    assert.deepEqual(body, { runsOn: ME, adopted: [], files: [], commit: null }, "nothing left to adopt, nothing committed");
    const { items } = (await (await fetch(`${srv.url}/api/attention`)).json()) as { items: { kind: string }[] };
    assert.equal(items.filter((i) => i.kind === "runner").length, 0, "attention is clear");
  });
});
