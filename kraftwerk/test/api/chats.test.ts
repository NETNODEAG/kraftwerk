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

  /**
   * Forking needs a session the agent already holds; refusing early keeps
   * these cases from spawning an agent. A chat the agent never answered
   * in has nothing to fork, and pi has no session to fork at all.
   */
  it("refuses to fork a chat without a session, a pi chat, and an unknown chat", async () => {
    const created = await post("/api/chats", { agent: "claude", scope: { kind: "general" } });
    const meta = (await created.json()) as ChatMeta;
    const fresh = await post(`/api/chats/${meta.id}/fork`, {});
    assert.equal(fresh.status, 409);
    assert.match(((await fresh.json()) as { error: string }).error, /nothing to fork yet/);

    const pi = (await (await post("/api/chats", { agent: "pi", scope: { kind: "general" } })).json()) as ChatMeta;
    const piFork = await post(`/api/chats/${pi.id}/fork`, {});
    assert.equal(piFork.status, 409);
    assert.match(((await piFork.json()) as { error: string }).error, /pi chats/);

    const missing = await post("/api/chats/chat-2026-01-01-0000-00-none/fork", {});
    assert.equal(missing.status, 404);
  });

  /** Resetting forgets the stored session and tells the thread; no agent is spawned for it. */
  it("resets a chat's session and refuses an unknown chat", async () => {
    const created = await post("/api/chats", { agent: "claude", scope: { kind: "general" } });
    const meta = (await created.json()) as ChatMeta;
    const r = await post(`/api/chats/${meta.id}/reset-session`, {});
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as ChatMeta).sessions, undefined);
    const chat = (await (await fetch(`${srv.url}/api/chats/${meta.id}`)).json()) as { events: Array<{ type: string; message?: string }> };
    assert.ok(chat.events.some((e) => e.type === "error" && /session reset/.test(e.message ?? "")));
    assert.equal((await post("/api/chats/chat-2026-01-01-0000-00-none/reset-session", {})).status, 404);
  });

  /** The agent-facing controls refuse cleanly when no agent is up (nothing is spawned for them). */
  it("steering, settings, task stop and questions refuse without an agent or a pending request", async () => {
    const created = await post("/api/chats", { agent: "claude", scope: { kind: "general" } });
    const meta = (await created.json()) as ChatMeta;
    assert.equal((await post(`/api/chats/${meta.id}/config`, { configId: "model", value: "x" })).status, 409);
    assert.equal((await post(`/api/chats/${meta.id}/task-stop`, { taskId: "t" })).status, 409);
    assert.equal((await post(`/api/chats/${meta.id}/elicitation`, { requestId: "nope", action: "accept", content: {} })).status, 409);
    assert.equal((await post(`/api/chats/${meta.id}/elicitation`, { requestId: "nope", action: "maybe" })).status, 400);
    assert.equal((await post("/api/chats/chat-2026-01-01-0000-00-none/steer", { text: "hi" })).status, 409);
  });

  /** Files dropped into a chat are stored under it and served back; names are sanitized. */
  it("stores and serves attachments", async () => {
    const created = await post("/api/chats", { agent: "claude", scope: { kind: "general" } });
    const meta = (await created.json()) as ChatMeta;
    const up = await fetch(`${srv.url}/api/chats/${meta.id}/attachments`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-file-name": encodeURIComponent("my shot (1).png"), origin: new URL(srv.url).origin },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    assert.equal(up.status, 200);
    const a = (await up.json()) as { name: string; mimeType: string; size: number };
    assert.match(a.name, /^\d{8}-\d{6}-my-shot-1-\.png$|^\d{8}-\d{6}-my-shot-1\.png$/);
    assert.equal(a.mimeType, "image/png");
    assert.equal(a.size, 4);
    const got = await fetch(`${srv.url}/api/chats/${meta.id}/attachments/${a.name}`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get("content-type"), "image/png");
    assert.equal(Buffer.from(await got.arrayBuffer()).length, 4);
    assert.equal((await fetch(`${srv.url}/api/chats/${meta.id}/attachments/..%2Fmeta.json`)).status, 404);
    assert.equal((await fetch(`${srv.url}/api/chats/${meta.id}/attachments/nope.png`)).status, 404);
  });

  /** A fork carries the attachments along, so the copy survives the original's deletion. */
  it("copies attachments into a forked chat", async () => {
    const created = await post("/api/chats", { agent: "claude", scope: { kind: "general" } });
    const meta = (await created.json()) as ChatMeta;
    const up = await fetch(`${srv.url}/api/chats/${meta.id}/attachments`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-file-name": "note.txt", origin: new URL(srv.url).origin },
      body: "hello",
    });
    const a = (await up.json()) as { name: string };
    // The fork itself needs a live agent (never from a test); the copy step is what carries the files.
    const copy = (await (await post("/api/chats", { agent: "claude", scope: { kind: "general" } })).json()) as ChatMeta;
    const { copyChatFiles } = await import("../../src/inspector/chat/store.js");
    await copyChatFiles(meta.id, copy.id);
    const got = await fetch(`${srv.url}/api/chats/${copy.id}/attachments/${a.name}`);
    assert.equal(got.status, 200);
    assert.equal(await got.text(), "hello");
    // And a chat without attachments copies cleanly too.
    const bare = (await (await post("/api/chats", { agent: "claude", scope: { kind: "general" } })).json()) as ChatMeta;
    await copyChatFiles(bare.id, copy.id);
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
