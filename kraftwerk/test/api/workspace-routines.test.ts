import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import { dueRoutines, type ListedRoutine, type RoutineStatus } from "../../src/core/routines.js";
import type { ChatMeta } from "../../src/core/chat/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Workspace routines (agents/routines.yml): defined on their own, each with
 * the project it runs in (none: globally) and the agent it messages (none:
 * the project's assistant, or Ralv). An agent's own routines
 * (agents/<slug>/routines.yml) keep working next to them.
 *
 * Schedules are "tomorrow, 03:00", so the scheduler never fires one; runs
 * are started with "run now" against the scripted fake agent
 * (KRAFTWERK_ACP_ADAPTER) — no coding agent runs.
 */
describe("workspace routines", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const ME = "tester@box";
  const today = new Date();
  const DUE = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 3, 0);
  const SCHEDULE = `0 3 ${DUE.getDate()} ${DUE.getMonth() + 1} *`;
  const send = (p: string, method: string, body?: unknown) =>
    fetch(srv.url + p, { method, headers: { "content-type": "application/json", origin }, body: body === undefined ? undefined : JSON.stringify(body) });
  const post = (p: string, body?: unknown) => send(p, "POST", body);
  const listed = async (): Promise<ListedRoutine[]> => ((await (await fetch(`${srv.url}/api/routines`)).json()) as { routines: ListedRoutine[] }).routines;
  const yml = async () => parse(await readFile(path.join(fx.root, "agents", "routines.yml"), "utf8")) as Record<string, unknown>[];
  /** Run it now and read the chat it opened. */
  const run = async (p: string): Promise<ChatMeta> => {
    const r = await post(p);
    const body = (await r.json()) as { chatId: string };
    assert.equal(r.status, 200, JSON.stringify(body));
    return ((await (await fetch(`${srv.url}/api/chats/${body.chatId}`)).json()) as { meta: ChatMeta }).meta;
  };
  // "who am i": the fake agent answers without asking for anything.
  const routine = (name: string, extra: Record<string, unknown> = {}) => ({ name, schedule: SCHEDULE, prompt: "who am i", ...extra });

  before(async () => {
    process.env.KRAFTWERK_ACP_ADAPTER = path.join(here, "../helpers/fake-acp-agent.mjs");
    fx = await makeProject();
    await mkdir(path.join(fx.home, ".kraftwerk"), { recursive: true });
    await writeFile(path.join(fx.home, ".kraftwerk", "identity.json"), JSON.stringify({ handle: "tester", machine: "box", previous: [] }));
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
    assert.equal((await send("/api/settings", "PUT", { projects: { enabled: true } })).status, 200);
    assert.equal((await post("/api/agents", { name: "Alpha", emoji: "🦊", harness: "claude", system: "x" })).status, 200);
    assert.equal((await post("/api/projects", { title: "Moon base", slug: "moon-base" })).status, 201);
  });
  after(async () => {
    delete process.env.KRAFTWERK_ACP_ADAPTER;
    const { disposeAllBackends } = await import("../../src/core/chat/sessions.js");
    await disposeAllBackends();
    await srv.close();
    await fx.cleanup();
  });

  it("is created on its own: no project, no agent, this machine as runner", async () => {
    const r = await post("/api/routines", routine("Everywhere"));
    const saved = (await r.json()) as RoutineStatus;
    assert.equal(r.status, 200, JSON.stringify(saved));
    assert.equal(saved.id, "everywhere");
    assert.equal(saved.runsOn, ME);
    assert.deepEqual(await yml(), [{ id: "everywhere", name: "Everywhere", schedule: SCHEDULE, prompt: "who am i", enabled: true, runs_on: ME }]);

    const [row] = (await listed()).filter((x) => x.id === "everywhere");
    assert.equal(row.owner, "_");
    assert.equal(row.agent, undefined, "nobody in particular: Ralv");
    assert.equal(row.project, undefined);
    assert.equal(row.runner, "here");
    assert.ok(row.nextRunAt);
    assert.deepEqual((await dueRoutines(DUE)).map((d) => `${d.slug}/${d.routine.id}`), ["_/everywhere"], "the scheduler finds it");
  });

  it("takes a project and an agent, refuses ones that do not exist, and keeps what an update leaves out", async () => {
    assert.equal((await post("/api/routines", routine("Nowhere", { project: "atlantis" }))).status, 400);
    assert.equal((await post("/api/routines", routine("Nobody", { agent: "ghost" }))).status, 400);

    for (const [name, extra] of [
      ["In project", { project: "moon-base" }],
      ["By agent", { agent: "alpha" }],
      ["Agent in project", { project: "moon-base", agent: "alpha" }],
    ] as const) {
      assert.equal((await post("/api/routines", routine(name, extra))).status, 200);
    }
    const both = (await yml()).find((x) => x.id === "agent-in-project")!;
    assert.equal(both.project, "moon-base");
    assert.equal(both.agent, "alpha");

    // An update that names neither keeps both; null clears.
    await post("/api/routines", { id: "agent-in-project", ...routine("Agent in project"), prompt: "who am i again" });
    assert.equal((await yml()).find((x) => x.id === "agent-in-project")!.agent, "alpha");
    const row = (await listed()).find((x) => x.id === "agent-in-project")!;
    assert.deepEqual(row.agent, { slug: "alpha", name: "Alpha", emoji: "🦊" });
    assert.equal(row.project, "moon-base");
    await post("/api/routines", { id: "agent-in-project", ...routine("Agent in project"), agent: null, project: null });
    const cleared = (await yml()).find((x) => x.id === "agent-in-project")!;
    assert.equal("agent" in cleared, false);
    assert.equal("project" in cleared, false);
    await post("/api/routines", { id: "agent-in-project", ...routine("Agent in project"), agent: "alpha", project: "moon-base" });
  });

  it("runs where it says: Ralv, the project's assistant, the agent, the agent in the project", async () => {
    const ralv = await run("/api/routines/everywhere/run");
    assert.deepEqual(ralv.scope, { kind: "kraftwerk", routine: "everywhere" });
    assert.equal(ralv.title, "⏰ Everywhere");

    const assistant = await run("/api/routines/in-project/run");
    assert.deepEqual(assistant.scope, { kind: "project", slug: "moon-base", routine: "in-project" });

    const agent = await run("/api/routines/by-agent/run");
    assert.deepEqual(agent.scope, { kind: "agent", slug: "alpha", routine: "by-agent" });
    assert.equal(agent.project, undefined);

    const filed = await run("/api/routines/agent-in-project/run");
    assert.deepEqual(filed.scope, { kind: "agent", slug: "alpha", routine: "agent-in-project" });
    assert.equal(filed.project, "moon-base");

    const state = (await listed()).find((x) => x.id === "in-project")!;
    assert.equal(state.lastChatId, assistant.id);
    assert.ok(state.lastRunAt);
    assert.equal((await post("/api/routines/missing/run")).status, 404);
  });

  it("a run of the project's assistant is unattended: the bell reports how it ended, in the project", async () => {
    type Note = { kind: string; title: string; href: string; diagnose?: { kind: string; agent: string; routine: string } };
    let note: Note | undefined;
    for (let i = 0; i < 100 && !note; i++) {
      const { items } = (await (await fetch(`${srv.url}/api/notifications`)).json()) as { items: Note[] };
      note = items.find((n) => n.href.startsWith("/projects/moon-base/chat/"));
      if (!note) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(note, "a notification for the project's run");
    // The fake agent has no session modes, which an unattended session reports as an error: either way it is a routine's notification.
    assert.match(note.kind, /^routine_(done|failed)$/);
    assert.match(note.title, /^📁 Moon base · ⏰ In project /);
    if (note.kind === "routine_failed") assert.deepEqual({ ...note.diagnose, chatId: undefined }, { kind: "routine", agent: "", routine: "in-project", chatId: undefined });
  });

  it("an agent's own routines keep working, next to the workspace's", async () => {
    const r = await post("/api/agents/alpha/routines", routine("Own"));
    assert.equal(r.status, 200, await r.text());
    const own = parse(await readFile(path.join(fx.root, "agents", "alpha", "routines.yml"), "utf8")) as Record<string, unknown>[];
    assert.deepEqual(own.map((x) => x.id), ["own"]);
    const row = (await listed()).find((x) => x.id === "own")!;
    assert.equal(row.owner, "alpha");
    assert.deepEqual(row.agent, { slug: "alpha", name: "Alpha", emoji: "🦊" });

    const chat = await run("/api/agents/alpha/routines/own/run");
    assert.deepEqual(chat.scope, { kind: "agent", slug: "alpha", routine: "own" });
    assert.equal((await yml()).some((x) => x.id === "own"), false, "not in the workspace's file");

    // The agent's status counts the workspace routines that name it.
    const status = (await (await fetch(`${srv.url}/api/agent-status`)).json()) as Record<string, { nextRoutine?: { id: string } }>;
    assert.ok(status.alpha?.nextRoutine, "a next routine");

    // The agents' routes are for agents: the workspace's owner is not one.
    assert.equal((await fetch(`${srv.url}/api/agents/_/routines`)).status, 400);
    assert.equal((await post("/api/agents/_/routines", routine("Sneak"))).status, 400);
  });

  it("is adopted and deleted like any other", async () => {
    await post("/api/routines", { id: "everywhere", ...routine("Everywhere"), runsOn: null });
    assert.equal((await listed()).find((x) => x.id === "everywhere")!.runner, "unassigned");
    type Attn = { kind: string; href: string; routines?: { agent: string; id: string }[] };
    const attention = ((await (await fetch(`${srv.url}/api/attention`)).json()) as { items: Attn[] }).items.find((i) => i.kind === "runner")!;
    assert.deepEqual(attention.routines, [{ agent: "_", id: "everywhere", name: "Everywhere" }]);
    assert.equal(attention.href, "/artifacts?kind=routines");

    const adopted = await post("/api/routines/everywhere/adopt");
    assert.equal(adopted.status, 200, await adopted.clone().text());
    assert.equal(((await adopted.json()) as { routine: RoutineStatus }).routine.runsOn, ME);
    assert.equal((await yml()).find((x) => x.id === "everywhere")!.runs_on, ME);

    assert.equal((await send("/api/routines/everywhere", "DELETE")).status, 200);
    assert.equal((await yml()).some((x) => x.id === "everywhere"), false);
  });
});
