import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { AgentDetail } from "../../src/core/agents.js";
import { agentVibeablesContext } from "../../src/core/chat/sessions.js";

/**
 * Agents over the HTTP API, with the focus on their links: vibeables are
 * linked in agent.yml like knowledge, and the agent's context tells it about
 * them — whether the feature is on, the folder exists, or neither. No agent
 * is spawned.
 */
describe("agents API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const post = (p: string, body?: unknown) =>
    fetch(srv.url + p, { method: "POST", headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const put = (p: string, body: unknown) => fetch(srv.url + p, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
  const detail = async (slug: string): Promise<AgentDetail> => (await fetch(`${srv.url}/api/agents/${slug}`)).json();
  const yml = () => readFile(path.join(fx.root, "agents/builder/agent.yml"), "utf8");

  before(async () => {
    fx = await makeProject("name: fixture\ngit:\n  interval: 0\n");
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("POST /api/agents without vibeables: the list is empty and agent.yml has no key", async () => {
    const r = await post("/api/agents", { name: "Builder", emoji: "🧱", harness: "claude", system: "build apps" });
    const a = (await r.json()) as AgentDetail;
    assert.equal(r.status, 200, JSON.stringify(a));
    assert.equal(a.slug, "builder");
    assert.deepEqual(a.vibeables, []);
    assert.doesNotMatch(await yml(), /^vibeables:/m, "empty list left out");
    assert.equal(await agentVibeablesContext(a), "", "nothing linked, nothing said");
  });

  it("PUT saves the vibeables list (trimmed, deduplicated); the context says the feature is off", async () => {
    const r = await put("/api/agents/builder", {
      name: "Builder",
      emoji: "🧱",
      harness: "claude",
      system: "build apps",
      vibeables: [" dashboard", "dashboard", "tracker", ""],
    });
    const a = (await r.json()) as AgentDetail;
    assert.equal(r.status, 200, JSON.stringify(a));
    assert.deepEqual(a.vibeables, ["dashboard", "tracker"]);
    assert.match(await yml(), /^vibeables:\n  - dashboard\n  - tracker$/m);
    assert.deepEqual((await detail("builder")).vibeables, ["dashboard", "tracker"], "read back from disk");

    const ctx = await agentVibeablesContext(a);
    assert.match(ctx, /^## Your vibeables/m);
    assert.match(ctx, /switched off/);
    assert.match(ctx, /dashboard, tracker/);
  });

  it("with the feature on, the context lists the folder of a linked app and reports a missing one", async () => {
    assert.equal((await put("/api/settings", { vibeables: { enabled: true, root: "kraftwerk-data/vibeables" } })).status, 200);
    assert.equal((await post("/api/vibeables", { name: "dashboard" })).status, 201);

    const ctx = await agentVibeablesContext(await detail("builder"));
    assert.match(ctx, /^## Your vibeables/m);
    assert.doesNotMatch(ctx, /switched off/);
    assert.match(ctx, new RegExp(`- dashboard — ${path.join(fx.root, "kraftwerk-data/vibeables/dashboard").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(static\\)`));
    assert.match(ctx, /- tracker \(configured but not found/);
    assert.match(ctx, /do not recreate it unasked/);
    assert.match(ctx, /vibeable button/, "how the user opens one in the pane");
  });

  it("a saved profile without the key clears the links, like knowledge", async () => {
    const r = await put("/api/agents/builder", { name: "Builder", emoji: "🧱", harness: "claude", system: "build apps" });
    assert.equal(r.status, 200);
    assert.deepEqual((await detail("builder")).vibeables, []);
    assert.doesNotMatch(await yml(), /^vibeables:/m);
  });
});
