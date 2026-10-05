import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { TrashEntry } from "../../src/inspector/trash.js";

/**
 * The trash over the HTTP API: deleting a knowledge bundle (or a chat)
 * moves it under kraftwerk-data/trash/<kind>/, the trash is git-ignored,
 * a name deleted twice gets a suffix, restore puts an entry back (and is
 * refused while the place is taken), purge and empty delete for good.
 */
describe("trash API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const post = (p: string, body?: unknown) => fetch(srv.url + p, { method: "POST", headers: headers(), body: JSON.stringify(body ?? {}) });
  const del = (p: string) => fetch(srv.url + p, { method: "DELETE", headers: headers() });
  const trash = async (): Promise<TrashEntry[]> => ((await (await fetch(srv.url + "/api/trash")).json()) as { entries: TrashEntry[] }).entries;
  const bundle = (n: string) => path.join(fx.root, "knowledge", n);
  const inTrash = (id: string) => path.join(fx.root, "kraftwerk-data/trash", id);

  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("starts empty", async () => {
    assert.deepEqual(await trash(), []);
  });

  it("DELETE /api/knowledge/<bundle> moves the bundle to trash/knowledge and keeps the trash out of git", async () => {
    assert.equal((await post("/api/knowledge", { name: "support" })).status, 200);
    assert.ok(existsSync(path.join(bundle("support"), "index.md")));
    const r = await del("/api/knowledge/support");
    assert.equal(r.status, 200, await r.text());
    assert.ok(!existsSync(bundle("support")));
    assert.ok(existsSync(path.join(inTrash("knowledge/support"), "index.md")));
    const [e] = await trash();
    assert.equal(e.id, "knowledge/support");
    assert.equal(e.kind, "knowledge");
    assert.equal(e.name, "support");
    assert.equal(e.from, "knowledge/support");
    assert.equal(await readFile(inTrash(".gitignore"), "utf8"), "*\n");
    assert.equal(fx.git("status", "--porcelain", "--untracked-files=all", "kraftwerk-data"), "", "the trash is invisible to git");
    assert.equal((await del("/api/knowledge/support")).status, 400, "already gone");
  });

  it("the same name deleted again gets a suffix; restore is refused while the place is taken", async () => {
    await post("/api/knowledge", { name: "support" });
    await del("/api/knowledge/support");
    assert.deepEqual((await trash()).map((e) => e.id).sort(), ["knowledge/support", "knowledge/support-2"]);
    await post("/api/knowledge", { name: "support" });
    const r = await post("/api/trash/restore", { id: "knowledge/support" });
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /exists again/);
    await del("/api/knowledge/support");
  });

  it("restore puts an entry back, without its trash marker", async () => {
    const r = await post("/api/trash/restore", { id: "knowledge/support-2" });
    assert.equal(r.status, 200, await r.text());
    assert.ok(existsSync(path.join(bundle("support"), "index.md")));
    assert.ok(!existsSync(path.join(bundle("support"), ".trashed.json")));
    assert.equal(((await (await fetch(srv.url + "/api/knowledge/support")).json()) as { name: string }).name, "support");
    assert.ok(!(await trash()).some((e) => e.id === "knowledge/support-2"));
  });

  it("a deleted chat lands in trash/chats", async () => {
    const r = await post("/api/chats", { agent: "claude", scope: { kind: "general" } });
    const chat = (await r.json()) as { id: string };
    assert.equal((await del(`/api/chats/${chat.id}`)).status, 200);
    assert.ok(existsSync(path.join(inTrash(`chats/${chat.id}`), "meta.json")));
    assert.equal((await fetch(`${srv.url}/api/chats/${chat.id}`)).status, 404);
  });

  it("ids outside the trash are refused; purge deletes one for good, DELETE /api/trash the rest", async () => {
    assert.equal((await post("/api/trash/purge", { id: "../knowledge/support" })).status, 400);
    assert.ok(existsSync(bundle("support")));
    const before = await trash();
    const first = before.find((e) => e.kind === "knowledge")!;
    assert.equal((await post("/api/trash/purge", { id: first.id })).status, 200);
    assert.ok(!existsSync(inTrash(first.id)));
    const r = await del("/api/trash");
    assert.equal(((await r.json()) as { purged: number }).purged, before.length - 1);
    assert.deepEqual(await trash(), []);
    assert.ok(!existsSync(inTrash("knowledge")), "empty kind folders are pruned");
  });
});
