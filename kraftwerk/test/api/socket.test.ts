import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * The control plane's socket (/api/ws): a hello, routes called by name,
 * watched results pushed again after a change made through the API, chat
 * event streams with replay, and the refusals — upload routes, unknown
 * topics, a page from another origin.
 */
type Msg = Record<string, unknown> & { id?: number; watch?: string; event?: string; data?: unknown };

class Conn {
  private readonly ws: WebSocket;
  private readonly inbox: Msg[] = [];
  private waiters: Array<() => void> = [];
  private seq = 0;
  readonly opened: Promise<void>;

  constructor(url: string, headers?: Record<string, string>) {
    // Node's WebSocket takes headers as an undocumented option; enough for the Origin test.
    this.ws = new WebSocket(url, headers ? ({ headers } as unknown as string[]) : undefined);
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("socket refused"));
    });
    this.ws.onmessage = (m) => {
      this.inbox.push(JSON.parse(String(m.data)) as Msg);
      for (const w of this.waiters.splice(0)) w();
    };
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
  /** The next message matching `pred` (seen or yet to come), within 5 s. */
  async next(pred: (m: Msg) => boolean): Promise<Msg> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const i = this.inbox.findIndex(pred);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      if (Date.now() > deadline) throw new Error("timed out waiting for a message");
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 200);
      });
    }
  }
  /** How many messages matching `pred` arrived and were not taken yet. */
  pending(pred: (m: Msg) => boolean): number {
    return this.inbox.filter(pred).length;
  }
  async call(call: string, input?: unknown): Promise<Msg> {
    const id = ++this.seq;
    this.send({ id, call, input });
    return this.next((m) => m.id === id);
  }
  close() {
    this.ws.close();
  }
}

describe("socket", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let conn: Conn;
  const wsUrl = () => srv.url.replace(/^http/, "ws") + "/api/ws";

  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
    conn = new Conn(wsUrl());
    await conn.opened;
  });
  after(async () => {
    conn.close();
    await srv.close();
    await fx.cleanup();
  });

  it("says hello with the protocol version", async () => {
    const hello = await conn.next((m) => "hello" in m);
    assert.equal((hello.hello as { protocol: number }).protocol, 1);
  });

  it("runs routes by name: results, refusals, HTTP-only routes", async () => {
    const meta = await conn.call("meta.get", { query: { probe: true } });
    assert.equal(meta.status, 200);
    assert.equal((meta.data as { workspaceRoot: string }).workspaceRoot, fx.root);
    assert.deepEqual(await conn.call("chats.get", { id: "nope" }), { id: 2, status: 404, data: { error: "not found" } });
    assert.equal((await conn.call("files.upload", {})).status, 400);
    assert.equal((await conn.call("no.such")).status, 404);
  });

  it("pushes a watched result again when a change comes through the API", async () => {
    conn.send({ watch: "k", name: "knowledge.list", interval: 60_000 });
    const first = await conn.next((m) => m.watch === "k" && "data" in m);
    assert.doesNotMatch(JSON.stringify(first.data), /socket-made/);
    const made = await fetch(srv.url + "/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "socket-made" }) });
    assert.equal(made.status, 200);
    // Long before the 60 s interval: the change itself triggers the push.
    const pushed = await conn.next((m) => m.watch === "k" && JSON.stringify(m.data).includes("socket-made"));
    assert.ok(pushed);
    conn.send({ unwatch: "k" });
    const refused = (conn.send({ watch: "x", name: "files.raw" }), await conn.next((m) => m.watch === "x"));
    assert.match(String(refused.error), /cannot be watched/);
  });

  it("streams a chat's events after a sequence number", async () => {
    const id = "chat-2026-01-01-0000-00-sock";
    const ev = (o: Record<string, unknown>) => JSON.stringify(o) + "\n";
    await fx.write(`output/chats/${id}/meta.json`, JSON.stringify({ id, agent: "claude", title: "t", cwd: fx.root, scope: { kind: "general" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }));
    await fx.write(
      `output/chats/${id}/events.jsonl`,
      ev({ type: "user_message", text: "one", seq: 1, ts: "2026-01-01T00:00:00.000Z" }) +
        ev({ type: "turn_end", stopReason: "end_turn", seq: 2, ts: "2026-01-01T00:00:01.000Z" }) +
        ev({ type: "user_message", text: "two", seq: 3, ts: "2026-01-01T00:00:02.000Z" }),
    );
    conn.send({ sub: "c", topic: `chat.${id}`, after: 1 });
    const second = await conn.next((m) => m.event === "c");
    assert.equal((second.data as { seq: number }).seq, 2);
    const third = await conn.next((m) => m.event === "c");
    assert.equal((third.data as { text: string }).text, "two");
    conn.send({ unsub: "c" });

    conn.send({ sub: "u", topic: "nothing.here" });
    assert.match(String((await conn.next((m) => m.sub === "u")).error), /unknown topic/);
  });

  it("one key subscribed twice in a row is one subscription: each later event arrives once", async () => {
    const json = { "content-type": "application/json" };
    assert.equal((await fetch(srv.url + "/api/settings", { method: "PUT", headers: json, body: JSON.stringify({ vibeables: { enabled: true, root: "kraftwerk-data/vibeables" } }) })).status, 200);
    assert.equal((await fetch(srv.url + "/api/vibeables", { method: "POST", headers: json, body: JSON.stringify({ name: "twice" }) })).status, 201);
    conn.send({ sub: "v", topic: "vibeable.twice" });
    conn.send({ sub: "v", topic: "vibeable.twice" });
    // Let both set up (the file watcher starts with the first listener).
    await new Promise((r) => setTimeout(r, 300));
    await fx.write("kraftwerk-data/vibeables/twice/index.html", "<h1>once</h1>\n");
    await conn.next((m) => m.event === "v" && (m.data as { type: string }).type === "change");
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(conn.pending((m) => m.event === "v" && (m.data as { type: string }).type === "change"), 0, "the superseded subscription let go");
    conn.send({ unsub: "v" });
  });

  it("refuses a socket opened by a page from another origin", async () => {
    const evil = new Conn(wsUrl(), { origin: "https://evil.example" });
    await assert.rejects(evil.opened, /refused/);
  });
});
