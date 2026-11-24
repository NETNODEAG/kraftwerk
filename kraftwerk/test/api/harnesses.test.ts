import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * The harnesses and what they sign in with (#/settings/harnesses). No agent
 * is started: the list is read from disk and the environment. What is
 * tested: every harness is listed with what it can be given; a key is
 * stored on this machine (0600, outside the workspace folder), shown by
 * its last four characters and never returned; it reaches what the
 * workspace spawns as the variable the harness reads, and the other kind's
 * variable is gone; the workspace's own wins over the machine's; only this
 * machine sets one — a paired device reads the list and nothing more.
 */
describe("harnesses", () => {
  let fx: Fixture;
  let local: RunningServer;
  let remote: RunningServer;
  let token = "";
  const KEY = "sk-ant-test-0000000000000000-abcd";
  const TOKEN = "sk-ant-oat-test-0000000000000-wxyz";
  const MACHINE_KEY = "sk-ant-test-machine-00000000-mmmm";
  const kept: Record<string, string | undefined> = {};

  type Harness = { id: string; available: boolean; accepts: Array<{ kind: string }>; credential?: { scope: string; kind: string; ending: string; setAt: number }; env: string[]; login: string };
  const list = async (): Promise<Harness[]> => ((await (await fetch(local.url + "/api/harnesses")).json()) as { harnesses: Harness[] }).harnesses;
  const one = async (id: string): Promise<Harness> => (await list()).find((h) => h.id === id)!;
  const put = (id: string, body: unknown, base = local.url, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/harnesses/${id}/credential`, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  /** The environment the workspace's processes get, as the server computes it. */
  const spawnEnv = async (): Promise<NodeJS.ProcessEnv> => {
    const { Workspace } = await import("../../src/core/workspace.js");
    const { workspaceEnv } = await import("../../src/core/env.js");
    return new Workspace({ outputDir: path.join(fx.root, "output"), root: fx.root }).run(() => workspaceEnv());
  };

  before(async () => {
    // Whatever the developer's shell has must not leak into what is asserted.
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"]) {
      kept[name] = process.env[name];
      delete process.env[name];
    }
    fx = await makeProject();
    local = await startServer(fx);
    remote = await startServer(fx, { trustLoopback: false });
    const { code } = (await (await fetch(local.url + "/api/devices/code", { method: "POST" })).json()) as { code: string };
    const paired = await fetch(remote.url + "/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "phone" }) });
    token = ((await paired.json()) as { token: string }).token;
  });
  after(async () => {
    await local.close();
    await remote.close();
    await fx.cleanup();
    for (const [name, value] of Object.entries(kept)) if (value !== undefined) process.env[name] = value;
  });

  it("lists every harness with what it can be given; nothing is set at first", async () => {
    const all = await list();
    assert.deepEqual(all.map((h) => h.id), ["claude", "codex", "pi", "antigravity"]);
    assert.deepEqual((await one("claude")).accepts.map((a) => a.kind), ["api_key", "subscription_token"]);
    assert.deepEqual((await one("codex")).accepts.map((a) => a.kind), ["api_key"]);
    assert.deepEqual((await one("antigravity")).accepts, []);
    assert.equal((await one("claude")).available, true, "its adapter comes with kraftwerk");
    assert.ok(all.every((h) => h.credential === undefined && h.env.length === 0));
  });

  it("a key is stored on this machine, shown by its ending, and never returned", async () => {
    const r = await put("claude", { kind: "api_key", value: `  ${KEY}\n` });
    assert.equal(r.status, 200);
    const body = await r.text();
    assert.ok(!body.includes(KEY));
    const c = (await one("claude")).credential!;
    assert.deepEqual([c.scope, c.kind, c.ending], ["workspace", "api_key", "abcd"]);
    assert.ok(!JSON.stringify(await list()).includes(KEY));
    const file = path.join(fx.home, ".kraftwerk", "harness-credentials.json");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.ok((await readFile(file, "utf8")).includes(KEY), "kept under HOME");
    assert.ok(!path.resolve(file).startsWith(path.resolve(fx.root) + path.sep), "not in the workspace folder, so never synced");
  });

  it("it reaches what the workspace spawns, as the variable the harness reads", async () => {
    assert.equal((await spawnEnv()).ANTHROPIC_API_KEY, KEY);
  });

  it("a subscription token replaces the key: the other kind's variables are gone, also the shell's", async () => {
    assert.equal((await put("claude", { kind: "subscription_token", value: TOKEN })).status, 200);
    process.env.ANTHROPIC_AUTH_TOKEN = "from-the-shell";
    try {
      const env = await spawnEnv();
      assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, TOKEN);
      assert.equal(env.ANTHROPIC_API_KEY, undefined);
      assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    } finally {
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    }
    assert.equal((await one("claude")).credential!.kind, "subscription_token");
  });

  it("the machine's is used where the workspace has none of its own", async () => {
    assert.equal((await put("claude", { kind: "api_key", value: MACHINE_KEY, scope: "machine" })).status, 200);
    assert.equal((await one("claude")).credential!.scope, "workspace", "its own still wins");
    const gone = await fetch(local.url + "/api/harnesses/claude/credential?scope=workspace", { method: "DELETE" });
    assert.deepEqual(await gone.json(), { ok: true, removed: true });
    const c = (await one("claude")).credential!;
    assert.deepEqual([c.scope, c.ending], ["machine", "mmmm"]);
    assert.equal((await spawnEnv()).ANTHROPIC_API_KEY, MACHINE_KEY);
    await fetch(local.url + "/api/harnesses/claude/credential?scope=machine", { method: "DELETE" });
    assert.equal((await one("claude")).credential, undefined);
    assert.equal((await spawnEnv()).ANTHROPIC_API_KEY, undefined);
  });

  it("a variable from the shell or the .env is named, not shown", async () => {
    process.env.OPENAI_API_KEY = "sk-from-the-shell-000000";
    try {
      const codex = await one("codex");
      assert.deepEqual(codex.env, ["OPENAI_API_KEY"]);
      assert.ok(!JSON.stringify(codex).includes("sk-from-the-shell"));
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("refuses what cannot be one: a kind the harness does not take, a value with spaces, an unknown harness", async () => {
    assert.equal((await put("codex", { kind: "subscription_token", value: TOKEN })).status, 400);
    assert.equal((await put("antigravity", { kind: "api_key", value: KEY })).status, 400);
    assert.equal((await put("claude", { kind: "api_key", value: "two words here" })).status, 400);
    assert.equal((await put("nope", { kind: "api_key", value: KEY })).status, 404);
    assert.equal((await put("claude", { kind: "password", value: KEY })).status, 400);
  });

  it("only this machine sets one: a paired device reads the list, an unpaired caller nothing", async () => {
    const auth = { authorization: `Bearer ${token}` };
    assert.equal((await fetch(remote.url + "/api/harnesses", { headers: auth })).status, 200);
    assert.equal((await put("claude", { kind: "api_key", value: KEY }, remote.url, auth)).status, 403);
    assert.equal((await fetch(remote.url + "/api/harnesses/claude/credential", { method: "DELETE", headers: auth })).status, 403);
    assert.equal((await fetch(remote.url + "/api/harnesses")).status, 401);
    assert.equal((await one("claude")).credential, undefined);
  });
});
