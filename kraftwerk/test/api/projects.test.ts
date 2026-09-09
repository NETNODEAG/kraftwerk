import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { ProjectDetail, ProjectsView } from "../../src/inspector/projects.js";
import { projectContext } from "../../src/inspector/projects.js";
import type { ChatMeta } from "../../src/inspector/chat/types.js";
import type { GitStatus } from "../../src/inspector/git.js";

/**
 * Projects over the HTTP API: the feature flag, creating one from the
 * starter, saving records and links, the link states, the stamped log,
 * a chat scoped to the project and the context it starts with, the folder
 * being in the workspace git's scope, and removal. No agent is spawned:
 * a chat is created but never gets a message.
 */
describe("projects API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const post = (p: string, body?: unknown) =>
    fetch(srv.url + p, { method: "POST", headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const put = (p: string, body: unknown) => fetch(srv.url + p, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
  const del = (p: string) => fetch(srv.url + p, { method: "DELETE", headers: headers() });
  const settings = (projects: unknown) => put("/api/settings", { projects });
  const meta = async (): Promise<{ projects: boolean }> => (await fetch(srv.url + "/api/meta")).json();
  const list = async (): Promise<ProjectsView> => (await fetch(srv.url + "/api/projects")).json();
  const detail = async (slug: string): Promise<ProjectDetail> => (await fetch(`${srv.url}/api/projects/${slug}`)).json();

  before(async () => {
    fx = await makeProject("name: fixture\ngit:\n  interval: 0\n");
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  const dir = () => path.join(fx.root, "kraftwerk-data/projects/relaunch-netnode-ch");

  it("is off without a projects block: listing says so, creating and project chats are refused", async () => {
    assert.equal((await meta()).projects, false);
    const v = await list();
    assert.equal(v.enabled, false);
    assert.match(v.error ?? "", /off/);
    assert.equal((await post("/api/projects", { title: "Relaunch" })).status, 409);
    assert.equal((await post("/api/chats", { agent: "claude", scope: { kind: "project", slug: "relaunch" } })).status, 409);
  });

  it("settings turn it on and create the root — part of the workspace, not git-ignored", async () => {
    const r = await settings({ enabled: true, root: "kraftwerk-data/projects" });
    assert.equal(r.status, 200, await r.text());
    assert.equal((await meta()).projects, true);
    assert.match(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), /^projects: \{\}$/m);
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/projects")));
    assert.ok(!existsSync(path.join(fx.root, ".gitignore")), "nothing ignored");
    assert.deepEqual((await list()).projects, []);
  });

  it("POST creates the folder from the starter; the slug derives from the title; duplicates and bad titles are refused", async () => {
    const r = await post("/api/projects", { title: "Relaunch netnode.ch", goal: "Ship the new site on NodeHive by 2026-11-30" });
    const p = (await r.json()) as ProjectDetail;
    assert.equal(r.status, 201, JSON.stringify(p));
    assert.equal(p.slug, "relaunch-netnode-ch");
    assert.equal(p.title, "Relaunch netnode.ch");
    assert.equal(p.status, "active");
    assert.equal(p.path, dir());
    for (const f of ["project.yml", "brief.md", "state.md", "log.md"]) assert.ok(existsSync(path.join(dir(), f)), f);
    assert.match(await readFile(path.join(dir(), "project.yml"), "utf8"), /^title: Relaunch netnode\.ch$/m);
    assert.match(p.brief, /^# Relaunch netnode\.ch/);
    assert.match(p.log, /\*\*Created\*\*: project "Relaunch netnode\.ch"\. \(human:user\)/);
    assert.ok(!existsSync(path.join(dir(), ".git")), "no repository of its own");

    assert.equal((await post("/api/projects", { title: "Relaunch netnode.ch" })).status, 400, "duplicate");
    assert.equal((await post("/api/projects", { title: "   " })).status, 400, "empty title");
    assert.equal((await post("/api/projects", { title: "x", slug: "../up" })).status, 400, "unsafe slug");

    const v = await list();
    assert.deepEqual(v.projects.map((x) => x.slug), ["relaunch-netnode-ch"]);
  });

  it("PUT saves goal, status, records and links; link states say what exists", async () => {
    // One agent to link to; the other targets stay missing on purpose.
    const a = await post("/api/agents", { name: "Planner", emoji: "🗺️", harness: "claude", system: "plan things" });
    assert.equal(a.status, 200, JSON.stringify(await a.json()));

    const r = await put("/api/projects/relaunch-netnode-ch", {
      status: "paused",
      records: [
        { kind: "my-netnode", workspace: 22, url: "https://my.netnode.ch/workspace/22", note: "tickets and roadmap" },
        { kind: "url", title: "Figma", url: "https://figma.com/file/abc" },
      ],
      knowledge: ["handbook"],
      agents: ["planner"],
      workflows: ["website-check"],
      brief: "# Relaunch\n\nDone means: the new site is live.\n",
    });
    const p = (await r.json()) as ProjectDetail;
    assert.equal(r.status, 200, JSON.stringify(p));
    assert.equal(p.status, "paused");
    assert.deepEqual(p.records[0], { kind: "my-netnode", url: "https://my.netnode.ch/workspace/22", workspace: "22", note: "tickets and roadmap" });
    assert.deepEqual(p.links.agents, [{ slug: "planner", found: true, label: "🗺️ Planner" }]);
    assert.deepEqual(p.links.knowledge, [{ slug: "handbook", found: false }]);
    assert.deepEqual(p.links.workflows, [{ slug: "website-check", found: false }]);
    assert.match(p.brief, /Done means/);
    const yml = await readFile(path.join(dir(), "project.yml"), "utf8");
    assert.match(yml, /^status: paused$/m);
    assert.match(yml, /^agents:\n  - planner$/m);
    assert.doesNotMatch(yml, /^vibeables:/m, "empty lists are left out");

    assert.equal((await put("/api/projects/relaunch-netnode-ch", { status: "someday" })).status, 400);
    assert.equal((await put("/api/projects/relaunch-netnode-ch", { records: [{ url: "https://x.y" }] })).status, 400, "kind required");
    assert.equal((await put("/api/projects/relaunch-netnode-ch", { records: [{ kind: "url", url: "ftp://x" }] })).status, 400, "http(s) only");
    assert.equal((await put("/api/projects/nope", { goal: "x" })).status, 404);
  });

  it("PUT sets harness, model and effort like an agent's; a project chat runs on that harness", async () => {
    let r = await put("/api/projects/relaunch-netnode-ch", { harness: "codex", model: "gpt-5.6-sol", effort: "high" });
    const p = (await r.json()) as ProjectDetail;
    assert.equal(r.status, 200, JSON.stringify(p));
    assert.equal(p.harness, "codex");
    assert.equal(p.model, "gpt-5.6-sol");
    assert.equal(p.effort, "high");
    const yml = await readFile(path.join(dir(), "project.yml"), "utf8");
    assert.match(yml, /^harness: codex$/m);
    assert.match(yml, /^model: gpt-5\.6-sol$/m);
    assert.match(yml, /^effort: high$/m);

    // The caller's harness is ignored — the project decides, as with agent sessions.
    r = await post("/api/chats", { agent: "claude", scope: { kind: "project", slug: "relaunch-netnode-ch" } });
    const chat = (await r.json()) as ChatMeta;
    assert.equal(r.status, 200, JSON.stringify(chat));
    assert.equal(chat.agent, "codex");
    assert.equal((await del(`/api/chats/${chat.id}`)).status, 200);

    assert.equal((await put("/api/projects/relaunch-netnode-ch", { harness: "gemini" })).status, 400);
    assert.equal((await put("/api/projects/relaunch-netnode-ch", { effort: "extreme" })).status, 400);
    // Empty strings clear model and effort; the harness goes back to the default.
    r = await put("/api/projects/relaunch-netnode-ch", { harness: "", model: "", effort: "" });
    const back = (await r.json()) as ProjectDetail;
    assert.equal(back.harness, "claude");
    assert.equal(back.model, undefined);
    assert.equal(back.effort, undefined);
    assert.doesNotMatch(await readFile(path.join(dir(), "project.yml"), "utf8"), /^(model|effort):/m);
  });

  it("add a coworker: a project chat becomes a channel that stays in the project", async () => {
    const created = await post("/api/chats", { agent: "claude", scope: { kind: "project", slug: "relaunch-netnode-ch" } });
    const chat = (await created.json()) as ChatMeta;
    assert.equal(created.status, 200, JSON.stringify(chat));

    let r = await post("/api/channels/from-chat", { chatId: chat.id, name: "Relaunch crew", members: ["planner"], responder: "planner", project: "somewhere-else" });
    const channel = (await r.json()) as { slug: string; project?: string; members: string[]; chatId: string; error?: string };
    assert.equal(r.status, 200, JSON.stringify(channel));
    assert.equal(channel.slug, "relaunch-crew");
    assert.equal(channel.project, "relaunch-netnode-ch", "the chat decides the project, not the body");
    assert.equal(channel.chatId, chat.id, "the existing chat is the channel's transcript");
    assert.match(await readFile(path.join(fx.root, "channels", "relaunch-crew", "channel.yml"), "utf8"), /^project: relaunch-netnode-ch$/m);

    const stored = (await (await fetch(`${srv.url}/api/chats/${chat.id}`)).json()) as { meta: ChatMeta };
    assert.deepEqual(stored.meta.scope, { kind: "channel", slug: "relaunch-crew" });
    assert.equal(stored.meta.project, "relaunch-netnode-ch", "listed under the project from now on");
    assert.equal(stored.meta.title, "Relaunch crew");

    // Members read the project as members, not as its assistant.
    const ctx = await projectContext("relaunch-netnode-ch", "planner/claude", { member: true });
    assert.match(ctx, /^## Project: Relaunch netnode\.ch\nThis channel works in the project/m);
    assert.match(ctx, /## Systems of record/);
    assert.match(ctx, /--actor planner\/claude/);

    // A general chat still cannot become a channel; the definition is not left behind.
    const general = (await (await post("/api/chats", { agent: "claude", scope: { kind: "general" } })).json()) as ChatMeta;
    r = await post("/api/channels/from-chat", { chatId: general.id, name: "Nope", members: ["planner"] });
    assert.equal(r.status, 409);
    assert.equal((await fetch(`${srv.url}/api/channels/nope`)).status, 404);
    assert.equal((await del(`/api/chats/${general.id}`)).status, 200);

    assert.equal((await del("/api/channels/relaunch-crew")).status, 200, "removing the channel removes the transcript too");
    assert.equal((await fetch(`${srv.url}/api/chats/${chat.id}`)).status, 404);
  });

  it("POST /links adds and removes one slug; unknown kinds are refused", async () => {
    let r = await post("/api/projects/relaunch-netnode-ch/links", { kind: "agents", target: "planner" });
    const linked = (await r.json()) as ProjectDetail;
    assert.equal(r.status, 200, JSON.stringify(linked));
    assert.deepEqual(linked.agents, ["planner"], "no duplicate");
    r = await post("/api/projects/relaunch-netnode-ch/links", { kind: "repos", target: "netnode-frontend" });
    assert.deepEqual(((await r.json()) as ProjectDetail).links.repos, [{ slug: "netnode-frontend", found: false }]);
    r = await post("/api/projects/relaunch-netnode-ch/links", { kind: "repos", target: "netnode-frontend", remove: true });
    assert.deepEqual(((await r.json()) as ProjectDetail).repos, []);
    assert.equal((await post("/api/projects/relaunch-netnode-ch/links", { kind: "tickets", target: "x" })).status, 400);
    assert.equal((await post("/api/projects/nope/links", { kind: "agents", target: "x" })).status, 404);
  });

  it("POST /log prepends a dated line stamped with the actor", async () => {
    let r = await post("/api/projects/relaunch-netnode-ch/log", { entry: "Decided on NodeHive as the CMS.", actor: "kraftwerk-chat/claude" });
    assert.equal(r.status, 200, JSON.stringify(await r.json()));
    r = await post("/api/projects/relaunch-netnode-ch/log", { entry: "Kickoff held." });
    const log = await readFile(path.join(dir(), "log.md"), "utf8");
    const today = new Date().toISOString().slice(0, 10);
    assert.match(log, new RegExp(`^## ${today}\\n\\* Kickoff held\\. \\(human:user\\)\\n\\* Decided on NodeHive as the CMS\\. \\(kraftwerk-chat/claude\\)`, "m"), log);
    assert.equal((await post("/api/projects/relaunch-netnode-ch/log", { entry: "  " })).status, 400);
    assert.equal((await post("/api/projects/nope/log", { entry: "x" })).status, 404);
  });

  it("a chat scoped to the project runs in the workspace root and starts with the project's context", async () => {
    const r = await post("/api/chats", { agent: "claude", scope: { kind: "project", slug: "relaunch-netnode-ch" } });
    const chat = (await r.json()) as ChatMeta;
    assert.equal(r.status, 200, JSON.stringify(chat));
    assert.deepEqual(chat.scope, { kind: "project", slug: "relaunch-netnode-ch" });
    assert.equal(chat.cwd, fx.root);
    assert.equal((await post("/api/chats", { agent: "claude", scope: { kind: "project", slug: "nope" } })).status, 404);

    const ctx = await projectContext("relaunch-netnode-ch", "kraftwerk-chat/claude");
    assert.match(ctx, /project "Relaunch netnode\.ch"/);
    assert.match(ctx, /Goal: Ship the new site on NodeHive/);
    assert.match(ctx, /## Brief\n# Relaunch\n\nDone means/);
    assert.match(ctx, /## Systems of record\n[^\n]*\n- my\.netnode\.ch — workspace 22; https:\/\/my\.netnode\.ch\/workspace\/22; tickets, roadmap items[^\n]*; tickets and roadmap/);
    assert.match(ctx, /- Link: Figma — https:\/\/figma\.com\/file\/abc/);
    assert.match(ctx, /## Knowledge\n[^\n]*\n- handbook \(configured but not found/);
    assert.match(ctx, /## Agents\n[^\n]*\n- planner — 🗺️ Planner/);
    assert.match(ctx, /npx kraftwerk projects log relaunch-netnode-ch "<one line>" --actor kraftwerk-chat\/claude/);
    assert.equal((await del(`/api/chats/${chat.id}`)).status, 200);
  });

  it("the folder is in the workspace git's scope: its files are syncable", async () => {
    const st = (await (await fetch(`${srv.url}/api/git?fresh=1`)).json()) as GitStatus;
    const file = st.files?.find((f) => f.path === "kraftwerk-data/projects/relaunch-netnode-ch/project.yml");
    assert.ok(file, JSON.stringify(st.files?.map((f) => f.path)));
    assert.equal(file?.syncable, true, file?.reason ?? "not syncable");
  });

  it("a broken project.yml is listed with its error instead of hiding the folder", async () => {
    await fx.write("kraftwerk-data/projects/broken/project.yml", "title: Broken\nstatus: someday\n");
    const p = (await list()).projects.find((x) => x.slug === "broken");
    assert.match(p?.configError ?? "", /status must be one of/);
    assert.equal((await del("/api/projects/broken")).status, 200);
  });

  it("DELETE removes the folder; a second DELETE and GET are 404; settings turn the feature off", async () => {
    assert.equal((await del("/api/projects/relaunch-netnode-ch")).status, 200);
    assert.ok(!existsSync(dir()));
    assert.equal((await del("/api/projects/relaunch-netnode-ch")).status, 404);
    assert.equal(((await detail("relaunch-netnode-ch")) as unknown as { error?: string }).error, 'no project "relaunch-netnode-ch"');
    assert.equal((await settings({ enabled: false })).status, 200);
    assert.equal((await meta()).projects, false);
    assert.doesNotMatch(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), /projects/);
  });
});
