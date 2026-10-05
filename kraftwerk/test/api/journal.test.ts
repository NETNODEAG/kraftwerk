import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import { appendJournal, journalExcerpt } from "../../src/inspector/journal.js";
import { agentJournalContext } from "../../src/inspector/chat/sessions.js";
import type { AgentStatus } from "../../src/inspector/agent-status.js";

/**
 * An agent's journal and status over the HTTP API: a human's note is
 * stamped, the agent's own lines are not, entries land newest first under
 * today, the session context carries the recent part and how to write
 * more, and /api/agent-status reports the next routine and the last
 * session. No agent is spawned.
 */
describe("agent journal and status API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const send = (p: string, method: string, body?: unknown) =>
    fetch(srv.url + p, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const today = new Date().toISOString().slice(0, 10);
  const journal = async (): Promise<string> => ((await (await fetch(srv.url + "/api/agents/lisa/journal")).json()) as { journal: string }).journal;
  const status = async (): Promise<Record<string, AgentStatus>> => (await fetch(srv.url + "/api/agent-status")).json();

  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
    const r = await send("/api/agents/lisa", "PUT", { name: "Lisa", emoji: "🦊", harness: "claude", system: "research" });
    assert.equal(r.status, 200, await r.text());
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("starts empty, and a session says so", async () => {
    assert.equal(await journal(), "");
    const ctx = await agentJournalContext({ slug: "lisa", harness: "claude" });
    assert.match(ctx, /## Your journal/);
    assert.match(ctx, /nothing recorded yet/);
    assert.match(ctx, /npx kraftwerk journal lisa "<one line>" --kind learned\|decided\|promised\|done/);
  });

  it("POST adds a human's note under today, signed", async () => {
    const r = await send("/api/agents/lisa/journal", "POST", { entry: "Lukas prefers short answers\nin German" });
    assert.equal(r.status, 200, await r.text());
    const text = await journal();
    assert.match(text, /^# Lisa's journal\n/);
    assert.match(text, new RegExp(`## ${today}\\n\\* Lukas prefers short answers in German \\(human:user\\)`));
    assert.equal(await readFile(path.join(fx.root, "agents/lisa/journal.md"), "utf8"), text);
  });

  it("the agent's own lines carry their kind and no signature, newest first", async () => {
    await appendJournal("lisa", "send the competitor summary on Friday", { kind: "promised", actor: "lisa/claude" });
    const text = await journal();
    const lines = text.split("\n").filter((l) => l.startsWith("* "));
    assert.equal(lines[0], "* **Promised**: send the competitor summary on Friday");
    assert.equal(text.match(new RegExp(`## ${today}`, "g"))?.length, 1, "one heading per day");
    assert.match(await agentJournalContext({ slug: "lisa", harness: "claude" }), /\*\*Promised\*\*: send the competitor summary/);
  });

  it("refuses an unknown kind, an empty entry and an unknown agent", async () => {
    assert.equal((await send("/api/agents/lisa/journal", "POST", { entry: "x", kind: "gossip" })).status, 400);
    assert.equal((await send("/api/agents/lisa/journal", "POST", { entry: "  " })).status, 400);
    assert.equal((await send("/api/agents/nobody/journal", "POST", { entry: "x" })).status, 400);
  });

  it("the session excerpt keeps whole recent days within its budget", () => {
    const raw = "# X's journal\n\n## 2026-10-03\n* " + "a".repeat(50) + "\n\n## 2026-10-02\n* " + "b".repeat(50) + "\n\n## 2026-10-01\n* old\n";
    const { text, truncated } = journalExcerpt(raw, 140);
    assert.match(text, /2026-10-03/);
    assert.match(text, /2026-10-02/);
    assert.doesNotMatch(text, /2026-10-01/);
    assert.equal(truncated, true);
  });

  it("/api/agent-status: idle with nothing scheduled, then the next routine and the last session", async () => {
    assert.deepEqual((await status()).lisa, { waiting: [], working: [] });
    const r = await send("/api/agents/lisa/routines", "POST", { name: "Morning brief", schedule: "0 7 * * *", prompt: "brief me" });
    assert.equal(r.status, 200, await r.text());
    const chat = await send("/api/chats", "POST", { agent: "claude", scope: { kind: "agent", slug: "lisa" } });
    assert.equal(chat.status, 200, await chat.text());
    const st = (await status()).lisa;
    assert.equal(st.nextRoutine?.name, "Morning brief");
    assert.ok(Date.parse(st.nextRoutine!.at) > Date.now());
    assert.ok(st.lastActiveAt);
    assert.deepEqual(st.working, []);
  });
});
