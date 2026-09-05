import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { NotificationsView } from "../../src/inspector/notifications.js";

/**
 * The bell: attention items land in /api/notifications, count as unread
 * until marked, and can be cleared. A routine that cannot start is the one
 * event a test can trigger without spawning an agent.
 */
describe("notifications API", () => {
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

  const origin = () => new URL(srv.url).origin;
  const send = (url: string, method: string, body?: unknown) =>
    fetch(srv.url + url, {
      method,
      headers: { "content-type": "application/json", origin: origin() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const view = async (): Promise<NotificationsView> => (await fetch(srv.url + "/api/notifications")).json();

  it("starts empty", async () => {
    assert.deepEqual(await view(), { items: [], unread: 0 });
  });

  it("a routine that cannot start becomes an unread routine_failed item linking to the agent", async () => {
    await fx.write("agents/watcher/agent.yml", "name: Watcher\nharness: claude\n");
    const saved = await send("/api/agents/watcher/routines", "POST", {
      name: "morning",
      schedule: "0 9 * * 1-5",
      prompt: "say hello",
      enabled: false,
    });
    assert.equal(saved.status, 200);
    const routine = (await saved.json()) as { id: string };
    // Agent definition gone, routine file still there: firing must fail.
    await rm(path.join(fx.root, "agents/watcher/agent.yml"));
    const run = await send(`/api/agents/watcher/routines/${routine.id}/run`, "POST");
    assert.equal(run.status, 400);

    const v = await view();
    assert.equal(v.unread, 1);
    assert.equal(v.items.length, 1);
    const [n] = v.items;
    assert.equal(n.kind, "routine_failed");
    assert.match(n.title, /morning/);
    assert.match(n.body ?? "", /not found/);
    assert.equal(n.href, "/agents/watcher");
    assert.equal(n.readAt, undefined);
    // A failure can be diagnosed: the item says where to look.
    assert.deepEqual(n.diagnose, { kind: "routine", agent: "watcher", routine: routine.id });
  });

  it("diagnose on an unknown item is a 404", async () => {
    const r = await send("/api/notifications/nope/diagnose", "POST");
    assert.equal(r.status, 404);
  });

  it("marking read keeps the item but zeroes the count; clear empties the list", async () => {
    const before = await view();
    const r = await send("/api/notifications/read", "POST", { ids: [before.items[0].id] });
    assert.equal(r.status, 200);
    const after = (await r.json()) as NotificationsView;
    assert.equal(after.unread, 0);
    assert.equal(after.items.length, 1);
    assert.ok(after.items[0].readAt);

    const cleared = await send("/api/notifications", "DELETE");
    assert.equal(cleared.status, 200);
    assert.deepEqual(await view(), { items: [], unread: 0 });
  });

  it("persists to <output>/notifications.json", async () => {
    // Trigger another failure, then read the file the module writes.
    const saved = await send("/api/agents/watcher/routines", "POST", {
      name: "evening",
      schedule: "0 18 * * *",
      prompt: "wrap up",
      enabled: false,
    });
    const evening = (await saved.json()) as { id: string };
    await send(`/api/agents/watcher/routines/${evening.id}/run`, "POST");
    // Give the async write chain a tick.
    await new Promise((r) => setTimeout(r, 50));
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(path.join(fx.root, "output", "notifications.json"), "utf8")) as unknown[];
    assert.equal(raw.length, 1);
  });
});
