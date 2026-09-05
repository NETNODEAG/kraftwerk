import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { ChatMeta, StoredChatEvent } from "../../src/inspector/chat/types.js";
import type { Channel } from "../../src/inspector/channels.js";

type ChannelView = Channel & { chatId: string; busy: boolean; awaitingApproval: boolean };

/**
 * Channels: a git-tracked definition plus one chat holding the transcript.
 * No agent is spawned here — a message that mentions nobody in a channel
 * without a responder wakes nobody, which is exactly the behaviour under test.
 */
describe("channels API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  before(async () => {
    fx = await makeProject();
    await fx.write("agents/researcher/agent.yml", "name: Researcher\nemoji: 🔎\nharness: claude\n");
    await fx.write("agents/writer/agent.yml", "name: Writer\nemoji: ✍️\nharness: codex\n");
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  const send = (url: string, method: string, body?: unknown) =>
    fetch(srv.url + url, {
      method,
      headers: { "content-type": "application/json", origin: new URL(srv.url).origin },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const get = async <T,>(url: string): Promise<T> => (await fetch(srv.url + url, { cache: "no-store" })).json();

  it("creates a channel: slug from the name, yml on disk, one chat for the transcript", async () => {
    const r = await send("/api/channels", "POST", {
      name: "Website relaunch",
      purpose: "ship the new site",
      members: ["researcher", "writer"],
    });
    const c = (await r.json()) as ChannelView & { error?: string };
    assert.equal(r.status, 200, JSON.stringify(c));
    assert.equal(c.slug, "website-relaunch");
    assert.deepEqual(c.members, ["researcher", "writer"]);
    assert.equal(c.responder, undefined);
    assert.equal(c.maxHops, 3);
    assert.match(c.chatId, /^chat-/);
    const yml = await readFile(path.join(fx.root, "channels", "website-relaunch", "channel.yml"), "utf8");
    assert.match(yml, /name: Website relaunch/);
    assert.match(yml, /- researcher/);
    const chat = await get<{ meta: ChatMeta }>(`/api/chats/${c.chatId}`);
    assert.deepEqual(chat.meta.scope, { kind: "channel", slug: "website-relaunch" });
    assert.equal(chat.meta.title, "Website relaunch");
    const list = await get<{ channels: ChannelView[] }>("/api/channels");
    assert.equal(list.channels.length, 1);
    assert.equal(list.channels[0].chatId, c.chatId, "the same chat is reused, not created again");
  });

  it("refuses unknown members and a second channel with the same name", async () => {
    const bad = await send("/api/channels", "POST", { name: "Ops", members: ["ghost"] });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /ghost/);
    const dup = await send("/api/channels", "POST", { name: "Website relaunch", members: ["writer"] });
    assert.equal(dup.status, 400);
  });

  it("a human message is signed with the poster's name and wakes nobody without mention or responder", async () => {
    const { channels } = await get<{ channels: ChannelView[] }>("/api/channels");
    const c = channels[0];
    const r = await send(`/api/chats/${c.chatId}/message`, "POST", { text: "kickoff tomorrow?", from: "Lukas" });
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 100));
    const chat = await get<{ events: StoredChatEvent[]; busy: boolean }>(`/api/chats/${c.chatId}`);
    const msg = chat.events.find((e) => e.type === "user_message");
    assert.ok(msg);
    assert.deepEqual(msg.from, { kind: "human", name: "Lukas" });
    assert.equal(chat.events.some((e) => e.type === "turn_start"), false, "no agent was woken");
    assert.equal(chat.busy, false);
  });

  it("updates members and drops a responder that left", async () => {
    const set = await send("/api/channels/website-relaunch", "PUT", { responder: "writer" });
    assert.equal(set.status, 200);
    assert.equal(((await set.json()) as ChannelView).responder, "writer");
    const shrink = await send("/api/channels/website-relaunch", "PUT", { members: ["researcher"] });
    const c = (await shrink.json()) as ChannelView;
    assert.deepEqual(c.members, ["researcher"]);
    assert.equal(c.responder, undefined);
    const empty = await send("/api/channels/website-relaunch", "PUT", { members: [] });
    assert.equal(empty.status, 400);
  });

  it("an agent session becomes a channel and keeps its transcript", async () => {
    const created = await send("/api/chats", "POST", { agent: "claude", scope: { kind: "agent", slug: "researcher" } });
    const meta = (await created.json()) as ChatMeta;
    const r = await send("/api/channels/from-chat", "POST", {
      chatId: meta.id,
      name: "Pairing",
      members: ["researcher", "writer"],
      responder: "researcher",
    });
    const c = (await r.json()) as ChannelView & { error?: string };
    assert.equal(r.status, 200, JSON.stringify(c));
    assert.equal(c.slug, "pairing");
    assert.equal(c.chatId, meta.id, "the existing chat is the channel's transcript");
    const chat = await get<{ meta: ChatMeta }>(`/api/chats/${meta.id}`);
    assert.deepEqual(chat.meta.scope, { kind: "channel", slug: "pairing" });
    assert.equal(chat.meta.title, "Pairing");
  });

  it("only agent sessions convert; the channel is not left behind on failure", async () => {
    const general = (await (await send("/api/chats", "POST", { agent: "claude", scope: { kind: "general" } })).json()) as ChatMeta;
    const r = await send("/api/channels/from-chat", "POST", { chatId: general.id, name: "Nope", members: ["writer"] });
    assert.equal(r.status, 409);
    await assert.rejects(access(path.join(fx.root, "channels", "nope")));
    const missing = await send("/api/channels/from-chat", "POST", { chatId: general.id, name: "Also nope", members: ["writer"] });
    assert.equal(missing.status, 409);
  });

  it("delete removes the definition and the transcript", async () => {
    const before = await get<{ channels: ChannelView[] }>("/api/channels");
    const pairing = before.channels.find((c) => c.slug === "pairing")!;
    const r = await send("/api/channels/pairing", "DELETE");
    assert.equal(r.status, 200);
    await assert.rejects(access(path.join(fx.root, "channels", "pairing")));
    const chat = await fetch(srv.url + `/api/chats/${pairing.chatId}`);
    assert.equal(chat.status, 404);
    const gone = await send("/api/channels/pairing", "GET");
    assert.equal(gone.status, 404);
  });
});
