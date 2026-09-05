import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { VibeableInfo, VibeableStatus, VibeablesView } from "../../src/inspector/vibeables.js";
import type { ChatMeta } from "../../src/inspector/chat/types.js";
import type { GitStatus } from "../../src/inspector/git.js";
import { effectiveCwd, vibeableContext } from "../../src/inspector/chat/sessions.js";

/**
 * Vibeables over the HTTP API: the feature flag, creating an app from the
 * starter, the static preview (what is served, what never is), the change
 * stream, the dev server lifecycle, opening one on a chat, and the folder
 * being in the workspace git's scope. The dev command is a tiny node http
 * server — no docker, no agent.
 */
describe("vibeables API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const post = (p: string, body?: unknown) =>
    fetch(srv.url + p, { method: "POST", headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const settings = (vibeables: unknown) =>
    fetch(srv.url + "/api/settings", { method: "PUT", headers: headers(), body: JSON.stringify({ vibeables }) });
  const meta = async (): Promise<{ vibeables: boolean }> => (await fetch(srv.url + "/api/meta")).json();
  const list = async (): Promise<VibeablesView> => (await fetch(srv.url + "/api/vibeables")).json();
  const status = async (slug: string): Promise<VibeableStatus> => (await fetch(`${srv.url}/api/vibeables/${slug}`)).json();

  before(async () => {
    fx = await makeProject("name: fixture\ngit:\n  interval: 0\n");
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
  });
  after(async () => {
    await post("/api/vibeables/hello/dev/stop").catch(() => {});
    await srv.close();
    await fx.cleanup();
  });

  const appDir = () => path.join(fx.root, "kraftwerk-data/vibeables/hello");

  it("is off without a vibeables block: listing says so, creating is refused", async () => {
    assert.equal((await meta()).vibeables, false);
    const v = await list();
    assert.equal(v.enabled, false);
    assert.match(v.error ?? "", /off/);
    assert.equal((await post("/api/vibeables", { name: "hello" })).status, 409);
    assert.equal((await fetch(`${srv.url}/vibeables/hello/`)).status, 404);
  });

  it("settings turn it on and create the root — not git-ignored, it is part of the workspace", async () => {
    const r = await settings({ enabled: true, root: "kraftwerk-data/vibeables" });
    assert.equal(r.status, 200, await r.text());
    assert.equal((await meta()).vibeables, true);
    // kraftwerk-data/vibeables is the default, so the block carries no root.
    assert.match(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), /^vibeables: \{\}$/m);
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/vibeables")));
    assert.ok(!existsSync(path.join(fx.root, ".gitignore")), "nothing ignored");
    const v = await list();
    assert.equal(v.enabled, true);
    assert.equal(v.root, path.join(fx.root, "kraftwerk-data/vibeables"));
    assert.deepEqual(v.vibeables, []);
    for (const root of [".", "..", "/tmp", fx.root]) {
      assert.equal((await settings({ enabled: true, root })).status, 400, root);
    }
  });

  it("POST /api/vibeables creates a folder with the starter", async () => {
    const r = await post("/api/vibeables", { name: "hello" });
    const v = (await r.json()) as VibeableInfo;
    assert.equal(r.status, 201, JSON.stringify(v));
    assert.equal(v.slug, "hello");
    assert.equal(v.path, appDir());
    assert.equal(v.hasIndex, true);
    assert.equal(v.dev, undefined, "the starter template is all comments");
    for (const f of ["index.html", "app.js", "style.css", "vibeable.yml", ".gitignore", "README.md"]) {
      assert.ok(existsSync(path.join(appDir(), f)), `${f} missing`);
    }
    assert.match(await readFile(path.join(appDir(), "index.html"), "utf8"), /<h1>hello<\/h1>/);
    assert.ok(!existsSync(path.join(appDir(), ".git")), "no repository of its own");
    assert.equal((await post("/api/vibeables", { name: "hello" })).status, 400, "same name twice");
    assert.equal((await post("/api/vibeables", { name: "../x" })).status, 400);
    assert.equal((await post("/api/vibeables", { name: ".hidden" })).status, 400);
    assert.equal((await post("/api/vibeables", {})).status, 400);
    assert.deepEqual((await list()).vibeables.map((x) => x.slug), ["hello"]);
  });

  it("the folder is in the workspace git's scope: its files are syncable", async () => {
    const st = (await (await fetch(`${srv.url}/api/git?fresh=1`)).json()) as GitStatus;
    const file = st.files?.find((f) => f.path === "kraftwerk-data/vibeables/hello/index.html");
    assert.ok(file, JSON.stringify(st.files?.map((f) => f.path)));
    assert.equal(file?.syncable, true, file?.reason ?? "not syncable");
  });

  it("GET /vibeables/<slug>/ serves the folder sandboxed; dot paths and escapes never", async () => {
    const r = await fetch(`${srv.url}/vibeables/hello/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/html/);
    assert.match(r.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts/);
    assert.equal(r.headers.get("access-control-allow-origin"), "*", "module scripts from the opaque origin need CORS");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.match(await r.text(), /<h1>hello<\/h1>/);

    const css = await fetch(`${srv.url}/vibeables/hello/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);

    const noSlash = await fetch(`${srv.url}/vibeables/hello`, { redirect: "manual" });
    assert.equal(noSlash.status, 302);
    assert.equal(noSlash.headers.get("location"), "/vibeables/hello/");

    assert.equal((await fetch(`${srv.url}/vibeables/hello/missing.js`)).status, 404);
    await writeFile(path.join(appDir(), "index.html.bak"), await readFile(path.join(appDir(), "index.html")));
    await (await import("node:fs/promises")).rm(path.join(appDir(), "index.html"));
    const noIndex = await fetch(`${srv.url}/vibeables/hello/`);
    assert.equal(noIndex.status, 404);
    assert.match(noIndex.headers.get("content-type") ?? "", /text\/html/, "a page while the agent rewrites, not JSON");
    assert.equal(noIndex.headers.get("access-control-allow-origin"), "*");
    assert.match(await noIndex.text(), /no index\.html yet/);
    await (await import("node:fs/promises")).rename(path.join(appDir(), "index.html.bak"), path.join(appDir(), "index.html"));
    assert.equal((await fetch(`${srv.url}/vibeables/hello/.gitignore`)).status, 404, "dot segment");
    assert.equal((await fetch(`${srv.url}/vibeables/hello/..%2Fhello%2Findex.html`)).status, 404, "encoded escape");
    assert.equal((await fetch(`${srv.url}/vibeables/hello/%2e%2e/index.html`)).status, 404, "encoded dots");
    assert.equal((await fetch(`${srv.url}/vibeables/nope/`)).status, 404, "unknown app");
    assert.equal((await fetch(`${srv.url}/vibeables/hello/`, { method: "POST", headers: headers() })).status, 405);
    // A client normalises plain ".." before sending; only encoded forms reach
    // the server, and those must not climb out of the app folder.
    assert.equal((await fetch(`${srv.url}/vibeables/hello/..%2F..%2F..%2Fkraftwerk.yml`)).status, 404);
    assert.equal((await fetch(`${srv.url}/vibeables/hello/%2e%2e%2f%2e%2e%2fkraftwerk.yml`)).status, 404);
  });

  it("GET /api/vibeables/<slug> reports static mode and a broken vibeable.yml without failing", async () => {
    let st = await status("hello");
    assert.equal(st.mode, "static");
    assert.equal(st.url, "/vibeables/hello/");
    assert.equal(st.dir, appDir());
    assert.deepEqual(st.config, {});
    assert.equal(st.configError, undefined);

    await writeFile(path.join(appDir(), "vibeable.yml"), "dev: 42\n");
    st = await status("hello");
    assert.match(st.configError ?? "", /dev must be a command string/);
    assert.equal((await fetch(`${srv.url}/vibeables/hello/`)).status, 200, "static preview still works");

    await writeFile(path.join(appDir(), "vibeable.yml"), "dir: ../../\n");
    st = await status("hello");
    assert.match(st.configError ?? "", /inside the vibeable/);
    assert.equal(st.dir, appDir(), "falls back to the folder itself");

    await writeFile(path.join(appDir(), "vibeable.yml"), "");
    assert.equal((await fetch(`${srv.url}/api/vibeables/nope`)).status, 404);
  });

  it("GET /api/vibeables/<slug>/events streams a change when a file is written", async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    try {
      const res = await fetch(`${srv.url}/api/vibeables/hello/events`, { signal: ac.signal });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      // First chunk is the ":ok" comment: the watcher is up once it arrives.
      while (!buf.includes(":ok")) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
      }
      await new Promise((r) => setTimeout(r, 150));
      await writeFile(path.join(appDir(), "index.html"), "<h1>changed</h1>\n");
      let ev: { type: string; files: string[] } | undefined;
      while (!ev) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const line = buf.split("\n").find((l) => l.startsWith("data: ") && l.includes('"change"'));
        if (line) ev = JSON.parse(line.slice(6));
      }
      assert.ok(ev, "no change event");
      assert.equal(ev.type, "change");
      assert.ok(ev.files.includes("index.html"), JSON.stringify(ev.files));
    } finally {
      clearTimeout(timer);
      ac.abort();
    }
    assert.equal((await fetch(`${srv.url}/api/vibeables/nope/events`)).status, 404);
  });

  it("dev start refuses without a dev command, then runs and stops the app's server", async () => {
    let r = await post("/api/vibeables/hello/dev/start");
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /no dev command/);

    await writeFile(
      path.join(appDir(), "server.js"),
      "require('node:http').createServer((q, s) => s.end('hi from dev')).listen(process.env.PORT, '127.0.0.1');\n"
    );
    await writeFile(path.join(appDir(), "vibeable.yml"), "dev: node server.js\n");
    assert.equal((await list()).vibeables[0].dev, "node server.js");
    r = await post("/api/vibeables/hello/dev/start");
    let st = (await r.json()) as VibeableStatus;
    assert.equal(r.status, 200, JSON.stringify(st));
    assert.equal(st.mode, "dev");
    assert.equal(st.dev?.running, true);
    assert.equal(st.dev?.command, "node server.js");
    assert.ok(st.dev!.port > 0);
    const port = st.dev!.port;

    for (let i = 0; i < 60 && !st.dev?.ready; i++) {
      await new Promise((res) => setTimeout(res, 250));
      st = await status("hello");
    }
    assert.equal(st.dev?.ready, true, JSON.stringify(st.dev));
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), "hi from dev");
    const again = (await (await post("/api/vibeables/hello/dev/start")).json()) as VibeableStatus;
    assert.equal(again.dev?.pid, st.dev?.pid, "start is idempotent while running");

    // While it runs, the preview prefix proxies to it — same origin as the
    // inspector, sandboxed like static files, so containers and proxies work.
    const proxied = await fetch(`${srv.url}/vibeables/hello/`);
    assert.equal(proxied.status, 200);
    assert.equal(await proxied.text(), "hi from dev");
    assert.match(proxied.headers.get("content-security-policy") ?? "", /^sandbox/);
    assert.equal(proxied.headers.get("access-control-allow-origin"), "*");
    assert.equal(await (await fetch(`${srv.url}/vibeables/hello/deep/path.json?x=1`)).text(), "hi from dev", "sub paths too");

    r = await post("/api/vibeables/hello/dev/stop");
    st = (await r.json()) as VibeableStatus;
    assert.equal(r.status, 200);
    assert.equal(st.mode, "static");
    assert.equal(st.dev?.running, false);
    assert.notEqual(st.dev?.exitCode, undefined);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`), "the server is gone");
    assert.match(await (await fetch(`${srv.url}/vibeables/hello/`)).text(), /<h1>changed<\/h1>/, "static again");
    assert.equal((await post("/api/vibeables/nope/dev/start")).status, 404);
  });

  it("two concurrent starts share one process", async () => {
    const [a, b] = await Promise.all([post("/api/vibeables/hello/dev/start"), post("/api/vibeables/hello/dev/start")]);
    const sa = (await a.json()) as VibeableStatus;
    const sb = (await b.json()) as VibeableStatus;
    assert.equal(a.status, 200, JSON.stringify(sa));
    assert.equal(b.status, 200, JSON.stringify(sb));
    assert.ok(sa.dev?.pid, "spawned");
    assert.equal(sa.dev?.pid, sb.dev?.pid, "one child, not two");
    await post("/api/vibeables/hello/dev/stop");
  });

  it("switching the feature off kills a running dev server and the agent context says so", async () => {
    let st = (await (await post("/api/vibeables/hello/dev/start")).json()) as VibeableStatus;
    const port = st.dev!.port;
    for (let i = 0; i < 60 && !st.dev?.ready; i++) {
      await new Promise((res) => setTimeout(res, 250));
      st = await status("hello");
    }
    assert.equal(st.dev?.ready, true);
    assert.equal((await settings({ enabled: false })).status, 200);
    assert.equal((await fetch(`${srv.url}/api/vibeables/hello`)).status, 409, "off");
    for (let i = 0; i < 20; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/`);
        await new Promise((res) => setTimeout(res, 100));
      } catch {
        break;
      }
    }
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`), "the dev server died with the feature");
    assert.match(await vibeableContext("hello", appDir()), /switched off/);
    assert.equal((await settings({ enabled: true })).status, 200);
    assert.equal((await fetch(`${srv.url}/api/vibeables/hello`)).status, 200);
  });

  it("POST /api/chats/:id/vibeable moves the chat into the app folder and back", async () => {
    const created = await post("/api/chats", { agent: "claude", scope: { kind: "general" } });
    const chat = (await created.json()) as ChatMeta;
    assert.equal(created.status, 200, JSON.stringify(chat));
    assert.equal(chat.cwd, fx.root);
    assert.equal(chat.vibeable, undefined);

    let r = await post(`/api/chats/${chat.id}/vibeable`, { slug: "hello" });
    let m = (await r.json()) as ChatMeta;
    assert.equal(r.status, 200, JSON.stringify(m));
    assert.equal(m.vibeable, "hello");
    assert.equal(m.cwd, appDir());
    const stored = (await (await fetch(`${srv.url}/api/chats/${chat.id}`)).json()) as { meta: ChatMeta };
    assert.equal(stored.meta.vibeable, "hello", "persisted");
    assert.equal(stored.meta.cwd, appDir());
    assert.match(await readFile(path.join(fx.root, "output/chats", chat.id, "meta.json"), "utf8"), /"vibeable": "hello"/);

    assert.equal((await post(`/api/chats/${chat.id}/vibeable`, { slug: "nope" })).status, 404);
    assert.equal((await post(`/api/chats/${chat.id}/vibeable`, { slug: "../x" })).status, 400);
    assert.equal((await post(`/api/chats/chat-nope/vibeable`, { slug: "hello" })).status, 404);

    r = await post(`/api/chats/${chat.id}/vibeable`, { slug: null });
    m = (await r.json()) as ChatMeta;
    assert.equal(r.status, 200);
    assert.equal(m.vibeable, undefined);
    assert.equal(m.cwd, fx.root);
    assert.equal((await fetch(srv.url + `/api/chats/${chat.id}`, { method: "DELETE", headers: headers() })).status, 200);
  });

  it("DELETE /api/vibeables/<slug> removes the folder; a chat still pointing there falls back to the project root", async () => {
    const chat = (await (await post("/api/chats", { agent: "claude", scope: { kind: "general" } })).json()) as ChatMeta;
    const meta = (await (await post(`/api/chats/${chat.id}/vibeable`, { slug: "hello" })).json()) as ChatMeta;
    assert.equal(meta.cwd, appDir());
    const r = await fetch(`${srv.url}/api/vibeables/hello`, { method: "DELETE", headers: headers() });
    assert.equal(r.status, 200);
    assert.ok(!existsSync(appDir()));
    // The agent would be spawned in a missing folder: the backend uses the default cwd instead, and the context tells the truth.
    assert.equal(await effectiveCwd(meta), fx.root);
    assert.match(await vibeableContext("hello", meta.cwd), /folder is gone/);
    assert.equal((await fetch(srv.url + `/api/chats/${chat.id}`, { method: "DELETE", headers: headers() })).status, 200);
    assert.equal((await fetch(`${srv.url}/api/vibeables/hello`, { method: "DELETE", headers: headers() })).status, 404);
    assert.deepEqual((await list()).vibeables, []);
  });
});
