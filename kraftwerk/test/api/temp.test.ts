import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { StoredChatEvent } from "../../src/core/chat/types.js";
import type { TempView } from "../../src/core/temp.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The temp folder: a chat session's agent process gets a scratch folder of
 * its own under kraftwerk-data/temp/<chat-id> as TMPDIR and KRAFTWERK_TEMP,
 * and is told about it in its context; the root is invisible to git; a
 * deleted chat takes its folder with it; GET /api/temp lists the folders
 * and DELETE /api/temp cleans by age or entirely. The agent is the scripted
 * fake (KRAFTWERK_ACP_ADAPTER) — no coding agent runs.
 */
describe("temp API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const send = (p: string, method: string, body?: unknown) => fetch(srv.url + p, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const events = async (id: string): Promise<StoredChatEvent[]> => ((await (await fetch(`${srv.url}/api/chats/${id}`)).json()) as { events: StoredChatEvent[] }).events;
  const temp = async (): Promise<TempView> => (await (await fetch(srv.url + "/api/temp")).json()) as TempView;
  const tempRoot = () => path.join(fx.root, "kraftwerk-data/temp");
  /** Poll until the predicate holds (the fake agent answers asynchronously). */
  async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
    for (let i = 0; i < 100; i++) {
      const v = await get();
      if (ok(v)) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  }
  const newChat = async (): Promise<string> => ((await (await send("/api/chats", "POST", { agent: "claude", scope: { kind: "agent", slug: "lisa" } })).json()) as { id: string }).id;

  before(async () => {
    process.env.KRAFTWERK_ACP_ADAPTER = path.join(here, "../helpers/fake-acp-agent.mjs");
    fx = await makeProject();
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
    assert.equal((await send("/api/agents/lisa", "PUT", { name: "Lisa", emoji: "🦊", harness: "claude" })).status, 200);
  });
  after(async () => {
    delete process.env.KRAFTWERK_ACP_ADAPTER;
    const { disposeAllBackends } = await import("../../src/core/chat/sessions.js");
    await disposeAllBackends();
    await srv.close();
    await fx.cleanup();
  });

  let chat = "";

  it("starts with no folders", async () => {
    const v = await temp();
    assert.deepEqual(v.entries, []);
    assert.equal(v.bytes, 0);
  });

  it("a session's agent gets its own folder as TMPDIR and KRAFTWERK_TEMP, and is briefed about it", async () => {
    chat = await newChat();
    assert.equal((await send(`/api/chats/${chat}/message`, "POST", { text: "where is temp?" })).status, 200);
    const evs = await until(() => events(chat), (xs) => xs.some((e) => e.type === "text" && e.text.startsWith("temp:")), "the agent's answer");
    const said = evs.find((e) => e.type === "text" && e.text.startsWith("temp:")) as { text: string };
    const dir = path.join(tempRoot(), chat);
    assert.equal(said.text, `temp: ${dir}|${dir}|briefed`);
    assert.ok(existsSync(dir), "the folder exists before the agent starts");
    assert.equal(await readFile(path.join(tempRoot(), ".gitignore"), "utf8"), "*\n");
    await writeFile(path.join(dir, "scratch.txt"), "half-done\n");
    assert.equal(fx.git("status", "--porcelain", "--untracked-files=all", "kraftwerk-data"), "", "the temp root is invisible to git");
  });

  it("GET /api/temp lists the folder with its files and size", async () => {
    const v = await temp();
    assert.equal(v.entries.length, 1);
    assert.equal(v.entries[0].id, chat);
    assert.equal(v.entries[0].path, `kraftwerk-data/temp/${chat}`);
    assert.equal(v.entries[0].files, 1);
    assert.equal(v.entries[0].bytes, 10);
    assert.equal(v.bytes, 10);
  });

  it("deleting a chat removes its folder for good (no trash)", async () => {
    const other = await newChat();
    assert.equal((await send(`/api/chats/${other}/message`, "POST", { text: "where is temp?" })).status, 200);
    await until(() => events(other), (xs) => xs.some((e) => e.type === "text"), "the second agent's answer");
    assert.ok(existsSync(path.join(tempRoot(), other)));
    assert.equal((await send(`/api/chats/${other}`, "DELETE")).status, 200);
    assert.ok(!existsSync(path.join(tempRoot(), other)), "gone with the chat");
    assert.ok(!existsSync(path.join(fx.root, "kraftwerk-data/trash/temp")), "not in the trash");
    assert.ok(existsSync(path.join(tempRoot(), chat)), "the other chat's folder stays");
  });

  it("DELETE /api/temp removes only folders idle for a week unless told otherwise", async () => {
    await mkdir(path.join(tempRoot(), "stale-1"), { recursive: true });
    await writeFile(path.join(tempRoot(), "stale-1", "old.txt"), "x");
    const { utimes } = await import("node:fs/promises");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(path.join(tempRoot(), "stale-1", "old.txt"), eightDaysAgo, eightDaysAgo);
    await utimes(path.join(tempRoot(), "stale-1"), eightDaysAgo, eightDaysAgo);
    assert.equal((await temp()).entries.length, 2);

    let r = (await (await send("/api/temp", "DELETE")).json()) as { removed: string[]; bytes: number };
    assert.deepEqual(r, { ok: true, removed: ["stale-1"], bytes: 1 } as unknown);
    assert.ok(existsSync(path.join(tempRoot(), chat)), "a fresh folder stays");

    r = (await (await send("/api/temp?olderThanDays=0", "DELETE")).json()) as { removed: string[]; bytes: number };
    assert.deepEqual(r.removed, [chat], "idle for 0 days: everything");
    assert.ok(!existsSync(path.join(tempRoot(), chat)));

    await mkdir(path.join(tempRoot(), "fresh-1"), { recursive: true });
    r = (await (await send("/api/temp?all=1", "DELETE")).json()) as { removed: string[]; bytes: number };
    assert.deepEqual(r.removed, ["fresh-1"]);
    assert.deepEqual((await temp()).entries, []);
  });
});
