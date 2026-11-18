import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * What the server reads from disk stays right while it is cached and
 * watched: a kraftwerk.yml, a chat's meta.json (in the chat list) or a
 * run's trace edited behind the server's back shows at once, and on macOS and Windows (native
 * folder watching) a watched result is pushed when a file changes — long
 * before the watch's own interval.
 */
type Msg = Record<string, unknown> & { watch?: string; data?: unknown };

function connect(url: string): Promise<{ next(pred: (m: Msg) => boolean, ms?: number): Promise<Msg>; send(m: unknown): void; close(): void }> {
  const ws = new WebSocket(url);
  const inbox: Msg[] = [];
  ws.onmessage = (m) => void inbox.push(JSON.parse(String(m.data)) as Msg);
  return new Promise((resolve, reject) => {
    ws.onerror = () => reject(new Error("socket refused"));
    ws.onopen = () =>
      resolve({
        async next(pred, ms = 5000) {
          const deadline = Date.now() + ms;
          for (;;) {
            const i = inbox.findIndex(pred);
            if (i >= 0) return inbox.splice(i, 1)[0];
            if (Date.now() > deadline) throw new Error("timed out waiting for a message");
            await new Promise((r) => setTimeout(r, 50));
          }
        },
        send: (m) => ws.send(JSON.stringify(m)),
        close: () => ws.close(),
      });
  });
}

const trace = (...events: Array<Record<string, unknown>>) => events.map((e) => JSON.stringify({ ts: new Date().toISOString(), ...e })).join("\n") + "\n";

describe("live data read from disk", () => {
  let fx: Fixture;
  let srv: RunningServer;
  const get = async (p: string) => (await fetch(srv.url + p)).json();

  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("reads kraftwerk.yml again once it changed on disk", async () => {
    assert.equal((await get("/api/meta")).workspaceName, "fixture");
    await fx.write("kraftwerk.yml", "name: renamed on disk\ngit:\n  interval: 0\n");
    assert.equal((await get("/api/meta")).workspaceName, "renamed on disk");
    await fx.write("kraftwerk.yml", "name: fixture\ngit:\n  interval: 0\n");
    assert.equal((await get("/api/meta")).workspaceName, "fixture");
  });

  it("a run's trace and a chat's meta.json edited on disk show at once in the lists", async () => {
    await fx.write("output/runs/2026-01-02-0304-05-hello/trace.jsonl", trace({ event: "run_start", workflow: "hello", steps: ["one"] }, { event: "phase_start", phase: "one", kind: "script" }));
    let run = (await get("/api/runs")).runs.find((r: { id: string }) => r.id === "2026-01-02-0304-05-hello");
    assert.equal(run.status, "running");
    await fx.write("output/runs/2026-01-02-0304-05-hello/trace.jsonl", trace({ event: "run_start", workflow: "hello", steps: ["one"] }, { event: "phase_start", phase: "one", kind: "script" }, { event: "phase_end", phase: "one", status: "ok" }, { event: "run_summary", total: {} }));
    run = (await get("/api/runs")).runs.find((r: { id: string }) => r.id === "2026-01-02-0304-05-hello");
    assert.equal(run.status, "ok");

    // A chat the server never loaded (a loaded chat's live state wins over its file): one written by another process.
    const made = (await (await fetch(srv.url + "/api/chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: "claude" }) })).json()) as { id: string };
    const stored = (await get(`/api/chats/${made.id}`)).meta;
    const id = "chat-2026-01-02-0304-05-disk";
    const titleOf = async () => ((await get("/api/chats")).chats as Array<{ id: string; title: string }>).find((c) => c.id === id)?.title;
    await fx.write(`output/chats/${id}/meta.json`, JSON.stringify({ ...stored, id, title: "written elsewhere" }, null, 2));
    assert.equal(await titleOf(), "written elsewhere");
    await fx.write(`output/chats/${id}/meta.json`, JSON.stringify({ ...stored, id, title: "renamed on disk" }, null, 2));
    assert.equal(await titleOf(), "renamed on disk");
  });

  it("pushes a watched result when a file changes, long before its interval", { skip: process.platform !== "darwin" && process.platform !== "win32" ? "no native folder watching here" : false }, async () => {
    const conn = await connect(srv.url.replace(/^http/, "ws") + "/api/ws");
    try {
      conn.send({ watch: "runs", name: "runs.list", interval: 60_000 });
      const first = await conn.next((m) => m.watch === "runs" && "data" in m);
      assert.doesNotMatch(JSON.stringify(first.data), /from-disk/);
      // Settle: the watcher may still report the fixture's own files.
      await new Promise((r) => setTimeout(r, 1500));
      await fx.write("output/runs/2026-01-02-0304-06-from-disk/trace.jsonl", trace({ event: "run_start", workflow: "from-disk", steps: ["one"] }));
      const pushed = await conn.next((m) => m.watch === "runs" && JSON.stringify(m.data).includes("from-disk"), 8000);
      assert.ok(pushed);
    } finally {
      conn.close();
    }
  });
});
