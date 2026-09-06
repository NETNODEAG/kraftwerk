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

  /**
   * An inspector restart kills every agent process. What the transcript
   * still shows as in flight (a permission request nobody answered, an
   * agent mid-turn) can never finish, so the first load from disk closes
   * it out in the transcript: the request resolves to dismissed, the open
   * turn ends with an error naming the restart. Reading again adds nothing.
   */
  it("closes permission requests and turns a restart left open", async () => {
    const id = "chat-2026-01-01-0000-00-stale";
    const ev = (o: Record<string, unknown>) => JSON.stringify(o) + "\n";
    const dhh = { kind: "agent", slug: "dhh" };
    await fx.write(
      `output/chats/${id}/meta.json`,
      JSON.stringify({
        id,
        agent: "claude",
        title: "Marketing",
        cwd: fx.root,
        scope: { kind: "channel", slug: "marketing" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
    );
    await fx.write(
      `output/chats/${id}/events.jsonl`,
      ev({ type: "user_message", text: "@dhh push it", seq: 1, ts: "2026-01-01T00:00:00.000Z", from: { kind: "human", name: "you" } }) +
        ev({ type: "turn_start", seq: 2, ts: "2026-01-01T00:00:01.000Z", from: dhh }) +
        ev({ type: "permission_request", requestId: "done", title: "lint", options: [{ optionId: "allow", name: "Yes" }], seq: 3, ts: "2026-01-01T00:00:02.000Z", from: dhh }) +
        ev({ type: "permission_resolved", requestId: "done", optionId: "allow", seq: 4, ts: "2026-01-01T00:00:03.000Z", from: dhh }) +
        ev({ type: "permission_request", requestId: "orphan", title: "push", options: [{ optionId: "allow", name: "Yes" }], seq: 5, ts: "2026-01-01T00:00:04.000Z", from: dhh })
    );
    type Ev = { type: string; seq: number; requestId?: string; optionId?: string | null; message?: string; from?: { slug?: string } };
    const load = async () => ((await (await fetch(`${srv.url}/api/chats/${id}`)).json()) as { events: Ev[]; busy: boolean }).events;
    const events = await load();
    const added = events.filter((e) => e.seq > 5);
    assert.deepEqual(
      added.map((e) => [e.type, e.from?.slug]),
      [
        ["permission_resolved", "dhh"],
        ["error", "dhh"],
      ]
    );
    assert.equal(added[0].requestId, "orphan");
    assert.equal(added[0].optionId, null);
    assert.match(added[1].message ?? "", /@dhh was interrupted by an inspector restart — mention @dhh again/);
    assert.equal((await load()).length, events.length, "a second read settles nothing new");
    const again = await post(`/api/chats/${id}/permission`, { requestId: "orphan", optionId: "allow" });
    assert.equal(again.status, 409);
  });

  it("closes the open turn of an ordinary chat a restart interrupted", async () => {
    const id = "chat-2026-01-01-0000-00-plain";
    const ev = (o: Record<string, unknown>) => JSON.stringify(o) + "\n";
    await fx.write(
      `output/chats/${id}/meta.json`,
      JSON.stringify({ id, agent: "claude", title: "t", cwd: fx.root, scope: { kind: "general" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })
    );
    await fx.write(
      `output/chats/${id}/events.jsonl`,
      ev({ type: "user_message", text: "hi", seq: 1, ts: "2026-01-01T00:00:00.000Z" }) +
        ev({ type: "turn_end", stopReason: "end_turn", seq: 2, ts: "2026-01-01T00:00:01.000Z" }) +
        ev({ type: "user_message", text: "and now?", seq: 3, ts: "2026-01-01T00:00:02.000Z" })
    );
    const { events } = (await (await fetch(`${srv.url}/api/chats/${id}`)).json()) as { events: Array<{ type: string; seq: number; message?: string }> };
    assert.deepEqual(events.filter((e) => e.seq > 3).map((e) => e.type), ["error"]);
    assert.match(events[events.length - 1].message ?? "", /the agent was interrupted by an inspector restart — send another message/);
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
