import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { ApiResult } from "../../src/server/api/index.js";

/**
 * The control plane's contract: GET /api/protocol names every route with
 * its method and path. Other clients (a native app, the CLI) are built
 * against these names, so the list is pinned here — removing or renaming a
 * route must be a deliberate edit of this test (and a PROTOCOL_VERSION bump),
 * adding one is a one-line addition.
 */
const ROUTES = [
  "DELETE /api/agents/:slug agents.delete",
  "DELETE /api/agents/:slug/routines/:id agents.deleteRoutine",
  "DELETE /api/agents/:slug/skills/:name agents.deleteSkill",
  "DELETE /api/channels/:slug channels.delete",
  "DELETE /api/chats/:id chats.delete",
  "DELETE /api/devices/:id devices.revoke",
  "DELETE /api/files files.delete",
  "DELETE /api/knowledge/:bundle knowledge.delete",
  "DELETE /api/notifications notifications.clear",
  "DELETE /api/projects/:slug projects.delete",
  "DELETE /api/repos/:slug repos.remove",
  "DELETE /api/runs/:id runs.delete",
  "DELETE /api/trash trash.empty",
  "DELETE /api/vibeables/:slug vibeables.delete",
  "DELETE /api/workflows/:slug workflows.delete",
  "GET /api/agent-sessions agents.sessions",
  "GET /api/agent-status agents.status",
  "GET /api/agents agents.list",
  "GET /api/agents/:slug agents.get",
  "GET /api/agents/:slug/journal agents.journal",
  "GET /api/agents/:slug/routines agents.routines",
  "GET /api/agents/:slug/skills agents.skills",
  "GET /api/agents/:slug/skills/:name agents.skill",
  "GET /api/attention attention.list",
  "GET /api/channels channels.list",
  "GET /api/channels/:slug channels.get",
  "GET /api/chats chats.list",
  "GET /api/chats/:id chats.get",
  "GET /api/chats/:id/attachments/:name chats.attachment",
  "GET /api/chats/:id/events chats.events",
  "GET /api/devices devices.list",
  "GET /api/devices/self devices.self",
  "GET /api/files files.scopes",
  "GET /api/files/list files.list",
  "GET /api/files/raw files.raw",
  "GET /api/files/recent files.recent",
  "GET /api/git git.status",
  "GET /api/git/diff git.diff",
  "GET /api/hub hub.list",
  "GET /api/knowledge knowledge.list",
  "GET /api/knowledge/:bundle knowledge.get",
  "GET /api/knowledge/:bundle/concept knowledge.concept",
  "GET /api/meta meta.get",
  "GET /api/notifications notifications.list",
  "GET /api/projects projects.list",
  "GET /api/projects/:slug projects.get",
  "GET /api/protocol protocol.get",
  "GET /api/repos repos.list",
  "GET /api/repos/:slug repos.get",
  "GET /api/repos/:slug/commits/:hash repos.commit",
  "GET /api/repos/:slug/diff repos.diff",
  "GET /api/routines routines.list",
  "GET /api/runs runs.list",
  "GET /api/runs/:id runs.get",
  "GET /api/runs/:id/file runs.file",
  "GET /api/runs/:id/text runs.fileText",
  "GET /api/search/agents search.agents",
  "GET /api/settings settings.get",
  "GET /api/skills skills.list",
  "GET /api/skills/:name skills.get",
  "GET /api/trash trash.list",
  "GET /api/update update.status",
  "GET /api/update-check update.check",
  "GET /api/vibeables vibeables.list",
  "GET /api/vibeables/:slug vibeables.get",
  "GET /api/vibeables/:slug/events vibeables.events",
  "GET /api/workflows workflows.list",
  "GET /api/workflows/:slug workflows.get",
  "GET /api/workflows/:slug/run workflows.runner",
  "GET /api/workspaces workspaces.list",
  "PATCH /api/chats/:id chats.rename",
  "POST /api/agents agents.create",
  "POST /api/agents/:slug/archive agents.archive",
  "POST /api/agents/:slug/journal agents.addJournal",
  "POST /api/agents/:slug/routines agents.saveRoutine",
  "POST /api/agents/:slug/routines/:id/run agents.runRoutine",
  "POST /api/agents/:slug/skills agents.saveSkill",
  "POST /api/channels channels.create",
  "POST /api/channels/from-chat channels.fromChat",
  "POST /api/chats chats.create",
  "POST /api/chats/:id/attachments chats.attach",
  "POST /api/chats/:id/cancel chats.cancel",
  "POST /api/chats/:id/config chats.config",
  "POST /api/chats/:id/elicitation chats.elicitation",
  "POST /api/chats/:id/fork chats.fork",
  "POST /api/chats/:id/message chats.message",
  "POST /api/chats/:id/permission chats.permission",
  "POST /api/chats/:id/reset-session chats.resetSession",
  "POST /api/chats/:id/steer chats.steer",
  "POST /api/chats/:id/task-stop chats.stopTask",
  "POST /api/chats/:id/vibeable chats.setVibeable",
  "POST /api/devices/code devices.code",
  "POST /api/files/folder files.mkdir",
  "POST /api/files/move files.move",
  "POST /api/files/upload files.upload",
  "POST /api/git/commit git.commit",
  "POST /api/git/fetch git.fetch",
  "POST /api/git/pull git.pull",
  "POST /api/git/push git.push",
  "POST /api/hub/close hub.close",
  "POST /api/hub/open hub.open",
  "POST /api/knowledge knowledge.create",
  "POST /api/knowledge/:bundle/concept knowledge.putConcept",
  "POST /api/knowledge/:bundle/verify knowledge.verify",
  "POST /api/notifications/:id/diagnose notifications.diagnose",
  "POST /api/notifications/read notifications.read",
  "POST /api/pair devices.pair",
  "POST /api/projects projects.create",
  "POST /api/projects/:slug/links projects.link",
  "POST /api/projects/:slug/log projects.log",
  "POST /api/repos repos.add",
  "POST /api/repos/:slug/update repos.update",
  "POST /api/restart server.restart",
  "POST /api/runs/:id/decision runs.decide",
  "POST /api/runs/:id/stop runs.stop",
  "POST /api/trash/purge trash.purge",
  "POST /api/trash/restore trash.restore",
  "POST /api/update update.start",
  "POST /api/vibeables vibeables.create",
  "POST /api/vibeables/:slug/dev/start vibeables.devStart",
  "POST /api/vibeables/:slug/dev/stop vibeables.devStop",
  "POST /api/workflows/:slug/run workflows.run",
  "POST /api/workspaces/forget workspaces.forget",
  "POST /api/workspaces/start workspaces.start",
  "POST /api/workspaces/stop workspaces.stop",
  "PUT /api/agents/:slug agents.save",
  "PUT /api/channels/:slug channels.save",
  "PUT /api/projects projects.saveLayout",
  "PUT /api/projects/:slug projects.save",
  "PUT /api/settings settings.save",
];

describe("protocol", () => {
  let fx: Fixture;
  let srv: RunningServer;

  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("GET /api/protocol lists every route by name, method and path", async () => {
    const r = await fetch(srv.url + "/api/protocol");
    assert.equal(r.status, 200);
    const body = (await r.json()) as ApiResult<"protocol.get">;
    assert.equal(body.version, 1);
    assert.deepEqual(body.routes.map((x) => `${x.method} ${x.path} ${x.name}`).sort(), ROUTES);
    assert.ok(body.routes.every((x) => x.summary), "every route has a summary");
    assert.deepEqual(
      body.routes.filter((x) => x.raw).map((x) => x.name).sort(),
      ["chats.attachment", "chats.events", "files.raw", "runs.file", "vibeables.events"],
      "streams and files are the only raw routes",
    );
  });

  it("publishes each JSON body's shape as JSON Schema, for clients without the TypeScript types", async () => {
    const body = (await (await fetch(srv.url + "/api/protocol")).json()) as ApiResult<"protocol.get">;
    const log = body.routes.find((r) => r.name === "projects.log");
    assert.deepEqual(log?.body, {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { entry: { type: "string" }, actor: { default: "human:user", type: "string" } },
      required: ["entry"],
    });
    assert.equal(body.routes.find((r) => r.name === "projects.list")?.body, undefined, "a GET has no body");
  });

  it("a route's result type is the handler's: meta.get is typed end to end", async () => {
    const meta = (await (await fetch(srv.url + "/api/meta")).json()) as ApiResult<"meta.get">;
    assert.equal(typeof meta.version, "string");
    assert.equal(meta.workspaceRoot.length > 0, true);
  });
});
