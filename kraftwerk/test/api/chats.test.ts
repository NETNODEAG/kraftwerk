import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { ChatMeta } from "../../src/inspector/chat/types.js";
import type { RoutineStatus } from "../../src/inspector/routines.js";

type ChatRow = ChatMeta & { busy: boolean; awaitingApproval: boolean };

/**
 * The chat list and routine status carry the "a human needs to answer" flag
 * the UI turns into the needs-approval chip. No agent is spawned here (a
 * chat only gets its backend on the first message), so both read false.
 */
describe("chats API: approval state", () => {
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

  const post = (url: string, body: unknown) =>
    fetch(srv.url + url, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(srv.url).origin },
      body: JSON.stringify(body),
    });

  it("lists every chat with busy and awaitingApproval flags", async () => {
    const created = await post("/api/chats", { agent: "claude", scope: { kind: "general" } });
    assert.equal(created.status, 200);
    const meta = (await created.json()) as ChatMeta;
    const list = (await (await fetch(srv.url + "/api/chats")).json()) as { chats: ChatRow[] };
    const row = list.chats.find((c) => c.id === meta.id);
    assert.ok(row, "created chat is listed");
    assert.equal(row.busy, false);
    assert.equal(row.awaitingApproval, false);
  });

  it("answering a permission nobody asked for is a 409, not a crash", async () => {
    const created = await post("/api/chats", { agent: "claude", scope: { kind: "general" } });
    const meta = (await created.json()) as ChatMeta;
    const r = await post(`/api/chats/${meta.id}/permission`, { requestId: "nope", optionId: "allow" });
    assert.equal(r.status, 409);
  });

  it("routine status omits awaitingApproval while no run is waiting", async () => {
    await fx.write("agents/watcher/agent.yml", "name: Watcher\nharness: claude\n");
    const up = await post("/api/agents/watcher/routines", {
      name: "morning",
      schedule: "0 9 * * 1-5",
      prompt: "say hello",
      enabled: false,
    });
    assert.equal(up.status, 200, await up.text());
    const st = (await (await fetch(srv.url + "/api/agents/watcher/routines")).json()) as { routines: RoutineStatus[] };
    const r = st.routines.find((x) => x.name === "morning");
    assert.ok(r, "routine listed");
    assert.equal(r.awaitingApproval, undefined);
    assert.equal(r.lastChatId, undefined);
  });
});
