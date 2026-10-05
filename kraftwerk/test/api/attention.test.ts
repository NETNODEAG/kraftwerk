import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { AttentionItem } from "../../src/inspector/attention.js";
import type { NotificationsView } from "../../src/inspector/notifications.js";
import type { AgentStatus } from "../../src/inspector/agent-status.js";

/**
 * What needs you, with real waiting requests: the adapter is replaced by a
 * scripted fake (test/helpers/fake-acp-agent.mjs, via KRAFTWERK_ACP_ADAPTER)
 * that asks for one permission per prompt, or one question — no model, no
 * tools, no coding agent. Checks that /api/attention lists each request
 * with its owner (agent, project), the deep link to the card, the status
 * line and the bell title; that answering clears it; and that an unread
 * failure is listed until it is read.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

describe("attention API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const send = (p: string, method: string, body?: unknown) =>
    fetch(srv.url + p, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const attention = async (): Promise<AttentionItem[]> => ((await (await fetch(srv.url + "/api/attention")).json()) as { items: AttentionItem[] }).items;
  /** Poll until the predicate holds (the fake agent answers asynchronously). */
  async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
    for (let i = 0; i < 100; i++) {
      const v = await get();
      if (ok(v)) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  before(async () => {
    process.env.KRAFTWERK_ACP_ADAPTER = path.join(here, "../helpers/fake-acp-agent.mjs");
    fx = await makeProject();
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
    assert.equal((await send("/api/settings", "PUT", { projects: { enabled: true } })).status, 200);
    assert.equal((await send("/api/agents/lisa", "PUT", { name: "Lisa", emoji: "🦊", harness: "claude" })).status, 200);
    assert.equal((await send("/api/projects", "POST", { title: "Relaunch netnode.ch", slug: "relaunch" })).status, 201);
  });
  after(async () => {
    delete process.env.KRAFTWERK_ACP_ADAPTER;
    // The fake agents are child processes: stop them, or the test process stays alive.
    const { disposeAllBackends } = await import("../../src/inspector/chat/sessions.js");
    await disposeAllBackends();
    await srv.close();
    await fx.cleanup();
  });

  let agentChat = "";
  let requestId = "";

  it("is empty while nothing waits", async () => {
    assert.deepEqual(await attention(), []);
  });

  it("an agent asking for approval: listed with the agent as owner and a link to the card", async () => {
    const chat = (await (await send("/api/chats", "POST", { agent: "claude", scope: { kind: "agent", slug: "lisa" } })).json()) as { id: string };
    agentChat = chat.id;
    assert.equal((await send(`/api/chats/${agentChat}/message`, "POST", { text: "install the deps" })).status, 200);
    const [item] = await until(attention, (xs) => xs.length === 1, "the approval");
    requestId = item.id;
    assert.equal(item.kind, "approval");
    assert.equal(item.title, "Run npm install");
    assert.equal(item.chatId, agentChat);
    assert.deepEqual(item.owner, { agent: { slug: "lisa", name: "Lisa", emoji: "🦊" } });
    assert.equal(item.href, `/agents/lisa/chat/${agentChat}?focus=${requestId}`);

    const st = ((await (await fetch(srv.url + "/api/agent-status")).json()) as Record<string, AgentStatus>).lisa;
    assert.equal(st.waiting[0]?.chatId, agentChat);
    const bell = (await (await fetch(srv.url + "/api/notifications")).json()) as NotificationsView;
    const note = await until(async () => ((await (await fetch(srv.url + "/api/notifications")).json()) as NotificationsView).items, (xs) => xs.some((n) => n.kind === "approval"), "the bell item");
    assert.ok(bell);
    const approval = note.find((n) => n.kind === "approval")!;
    assert.equal(approval.title, "🦊 Lisa needs approval", "owner first");
    assert.equal(approval.href, item.href);
  });

  it("a question in a project chat: owned by the project", async () => {
    const chat = (await (await send("/api/chats", "POST", { agent: "claude", scope: { kind: "project", slug: "relaunch" } })).json()) as { id: string };
    assert.equal((await send(`/api/chats/${chat.id}/message`, "POST", { text: "please ask a question" })).status, 200);
    const items = await until(attention, (xs) => xs.length === 2, "the question");
    const q = items.find((i) => i.kind === "question")!;
    assert.equal(q.title, "Which environment should I deploy to?");
    assert.deepEqual(q.owner, { project: { slug: "relaunch", title: "Relaunch netnode.ch" } });
    assert.equal(q.href, `/projects/relaunch/chat/${chat.id}?focus=${q.id}`);
    assert.equal(items[0].id, requestId, "oldest first");
    assert.equal((await send(`/api/chats/${chat.id}/elicitation`, "POST", { requestId: q.id, action: "accept", content: { env: "staging" } })).status, 200);
    await until(attention, (xs) => xs.length === 1, "the question to clear");
  });

  it("answering clears it, the bell's approval goes with it", async () => {
    assert.equal((await send(`/api/chats/${agentChat}/permission`, "POST", { requestId, optionId: "allow" })).status, 200);
    await until(attention, (xs) => xs.length === 0, "the approval to clear");
    const bell = (await (await fetch(srv.url + "/api/notifications")).json()) as NotificationsView;
    assert.equal(bell.items.filter((n) => n.kind === "approval").length, 0);
  });

  it("an unread failure needs you until it is read", async () => {
    const { pushNotification } = await import("../../src/inspector/notifications.js");
    const n = await pushNotification({
      kind: "routine_failed",
      title: "🦊 Lisa · ⏰ Morning brief failed",
      body: "usage limit reached",
      href: "/agents/lisa",
      diagnose: { kind: "routine", agent: "lisa", routine: "morning-brief" },
    });
    const [item] = await attention();
    assert.equal(item.kind, "failed");
    assert.equal(item.notificationId, n.id);
    assert.equal(item.title, "🦊 Lisa · ⏰ Morning brief failed: usage limit reached");
    assert.equal(item.owner.agent?.slug, "lisa");
    await send("/api/notifications/read", "POST", { ids: [n.id] });
    assert.deepEqual(await attention(), []);
  });
});
