import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { ChatMeta, StoredChatEvent } from "../../src/core/chat/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Session settings (the model, thinking depth) on a chat whose agent is not
 * running: after a model hits its limit, switching away from it must not
 * need a message on that model. The pick is kept and applied when the agent
 * next starts. The agent is the scripted fake (KRAFTWERK_ACP_ADAPTER).
 */
describe("chat settings while the agent is down", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const post = (p: string, body: unknown) =>
    fetch(srv.url + p, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
  const get = async <T>(p: string): Promise<T> => (await fetch(srv.url + p)).json() as Promise<T>;
  const events = async (id: string) => (await get<{ events: StoredChatEvent[] }>(`/api/chats/${id}`)).events;
  const modelShown = async (id: string) => {
    const cfg = (await events(id)).filter((e) => e.type === "config").pop();
    return cfg?.type === "config" ? cfg.options.find((o) => o.id === "model")?.value : undefined;
  };
  async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
    for (let i = 0; i < 150; i++) {
      const v = await fn();
      if (ok(v)) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  }
  const answer = (evs: StoredChatEvent[]) => evs.filter((e) => e.type === "text" && e.text.startsWith("model:")).map((e) => (e as { text: string }).text);
  const stopAgents = async () => (await import("../../src/core/chat/sessions.js")).disposeAllBackends();

  before(async () => {
    process.env.KRAFTWERK_ACP_ADAPTER = path.join(here, "../helpers/fake-acp-agent.mjs");
    fx = await makeProject();
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
  });
  after(async () => {
    delete process.env.KRAFTWERK_ACP_ADAPTER;
    await stopAgents();
    await srv.close();
    await fx.cleanup();
  });

  it("keeps a model picked while the agent is down, shows it at once, and the next start applies it", async () => {
    const r = await post("/api/chats", { agent: "claude", scope: { kind: "kraftwerk" } });
    const meta = (await r.json()) as ChatMeta;
    assert.equal(r.status, 200, JSON.stringify(meta));
    assert.equal((await post(`/api/chats/${meta.id}/message`, { text: "which model?" })).status, 200);
    await until(() => events(meta.id), (xs) => answer(xs).length === 1, "the first answer");
    assert.deepEqual(answer(await events(meta.id)), ["model: fast"]);

    // The process goes away (idle reaper, restart, an agent that died on its limit).
    await stopAgents();

    let set = await post(`/api/chats/${meta.id}/config`, { configId: "model", value: "nonsense" });
    assert.equal(set.status, 409, "a value the agent never offered is refused");
    set = await post(`/api/chats/${meta.id}/config`, { configId: "model", value: "smart" });
    assert.equal(set.status, 200, await set.text());
    assert.equal(await modelShown(meta.id), "smart", "the picker shows the choice right away");
    assert.deepEqual((await get<{ meta: ChatMeta }>(`/api/chats/${meta.id}`)).meta.pendingConfig, { model: "smart" });

    assert.equal((await post(`/api/chats/${meta.id}/message`, { text: "which model now?" })).status, 200);
    await until(() => events(meta.id), (xs) => answer(xs).length === 2, "the second answer");
    assert.equal(answer(await events(meta.id))[1], "model: smart", "the new process runs on the picked model before the prompt");
    assert.equal(await modelShown(meta.id), "smart");
    assert.equal((await get<{ meta: ChatMeta }>(`/api/chats/${meta.id}`)).meta.pendingConfig, undefined, "applied, then dropped");
  });

  it("a new chat starts on the settings the agent announces: offered per agent, set before the first prompt", async () => {
    const offered = await get<{ options: Array<{ id: string; category?: string; choices: Array<{ value: string }> }> }>("/api/agent-options?agent=codex");
    assert.deepEqual(offered.options.map((o) => [o.id, o.category, o.choices.map((c) => c.value)]), [["model", "model", ["fast", "smart"]]]);
    // pi: its own model list (none without pi installed) and its thinking levels, "default" leaving pi's own setting.
    const pi = (await get<{ options: Array<{ id: string; value: string; choices: Array<{ value: string }> }> }>("/api/agent-options?agent=pi")).options;
    assert.deepEqual(pi.map((o) => [o.id, o.value, o.choices[0].value]), [["model", "default", "default"], ["thinking", "default", "default"]]);
    assert.equal((await fetch(srv.url + "/api/agent-options?agent=nobody")).status, 400);

    const r = await post("/api/chats", { agent: "codex", scope: { kind: "kraftwerk" }, config: { model: "smart" } });
    const meta = (await r.json()) as ChatMeta;
    assert.deepEqual(meta.pendingConfig, { model: "smart" });
    assert.equal((await post(`/api/chats/${meta.id}/message`, { text: "which model?" })).status, 200);
    await until(() => events(meta.id), (xs) => answer(xs).length === 1, "the first answer");
    assert.deepEqual(answer(await events(meta.id)), ["model: smart"]);
  });

  it("a setting the agent never announced is refused while it is down", async () => {
    const r = await post("/api/chats", { agent: "claude", scope: { kind: "kraftwerk" } });
    const meta = (await r.json()) as ChatMeta;
    const set = await post(`/api/chats/${meta.id}/config`, { configId: "model", value: "smart" });
    assert.equal(set.status, 409);
    assert.match(((await set.json()) as { error: string }).error, /send a message first/);
  });
});
