import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { FilesListing, FilesScopeInfo } from "../../src/core/files.js";
import type { TrashEntry } from "../../src/core/trash.js";
import { projectContext } from "../../src/core/projects.js";
import { agentFilesContext } from "../../src/core/chat/sessions.js";

/**
 * Files over the HTTP API: the workspace root and a project's own root,
 * upload (a taken name gets " (2)"), folders, the raw file served
 * sandboxed, moves, paths that try to leave the root, delete to the trash
 * and back, a big file kept out of git, and the context agents get.
 */
describe("files API", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const send = (p: string, method: string, body?: unknown) =>
    fetch(srv.url + p, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const upload = (scope: string, dir: string, name: string, body: BodyInit) =>
    fetch(`${srv.url}/api/files/upload?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(dir)}`, {
      method: "POST",
      headers: { origin, "x-file-name": encodeURIComponent(name), "content-type": "application/octet-stream" },
      body,
    });
  const list = async (scope: string, dir = ""): Promise<FilesListing> =>
    (await fetch(`${srv.url}/api/files/list?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(dir)}`)).json();
  const ws = (rel = "") => path.join(fx.root, "kraftwerk-data/files", rel);

  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
    assert.equal((await send("/api/settings", "PUT", { projects: { enabled: true } })).status, 200);
    assert.equal((await send("/api/projects", "POST", { title: "Relaunch", slug: "relaunch" })).status, 201);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("lists the roots: the workspace first, then each project", async () => {
    const { scopes } = (await (await fetch(srv.url + "/api/files")).json()) as { scopes: FilesScopeInfo[] };
    assert.deepEqual(scopes.map((s) => [s.scope, s.label, s.root, s.count]), [
      ["workspace", "Workspace", "kraftwerk-data/files", 0],
      ["project:relaunch", "Relaunch", "kraftwerk-data/projects/relaunch/files", 0],
    ]);
    assert.deepEqual((await list("workspace")).entries, [], "an empty root lists as empty");
  });

  it("upload and folders: a taken name gets a suffix, folders come first", async () => {
    assert.equal((await send("/api/files/folder", "POST", { scope: "workspace", path: "brand" })).status, 201);
    let r = await upload("workspace", "brand", "logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>");
    assert.equal(r.status, 201, await r.clone().text());
    r = await upload("workspace", "brand", "logo.svg", "<svg/>");
    assert.equal(((await r.json()) as { name: string }).name, "logo (2).svg");
    await upload("workspace", "", "notes.md", "# hi");
    const root = await list("workspace");
    assert.deepEqual(root.entries.map((e) => [e.name, e.type]), [["brand", "dir"], ["notes.md", "file"]]);
    assert.equal(root.entries[0].count, 2);
    const brand = await list("workspace", "brand");
    assert.deepEqual(brand.entries.map((e) => e.path), ["brand/logo (2).svg", "brand/logo.svg"]);
    assert.equal(brand.entries[1].mime, "image/svg+xml");
    assert.equal((await send("/api/files/folder", "POST", { scope: "workspace", path: "brand" })).status, 400, "exists");
  });

  it("serves a file sandboxed, inline or as a download", async () => {
    const r = await fetch(`${srv.url}/api/files/raw?scope=workspace&path=brand/logo.svg`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/svg+xml");
    assert.equal(r.headers.get("content-security-policy"), "sandbox");
    assert.match(r.headers.get("content-disposition") ?? "", /^inline;/);
    assert.match(await r.text(), /<svg/);
    const d = await fetch(`${srv.url}/api/files/raw?scope=workspace&path=notes.md&download=1`);
    assert.match(d.headers.get("content-disposition") ?? "", /^attachment; filename\*=UTF-8''notes\.md$/);
    assert.equal((await fetch(`${srv.url}/api/files/raw?scope=workspace&path=missing.pdf`)).status, 404);
  });

  it("refuses paths that leave the root or touch hidden files", async () => {
    for (const p of ["../kraftwerk.yml", "brand/../../x", ".gitignore", "/etc/passwd"]) {
      const r = await fetch(`${srv.url}/api/files/raw?scope=workspace&path=${encodeURIComponent(p)}`);
      assert.ok(r.status === 400 || r.status === 404, `${p}: ${r.status}`);
    }
    assert.equal((await upload("workspace", "../..", "evil.txt", "x")).status, 400);
    assert.equal((await fetch(`${srv.url}/api/files/list?scope=project:nope`)).status, 404);
    assert.equal((await fetch(`${srv.url}/api/files/list?scope=bogus`)).status, 400);
  });

  it("a project's files live in its own folder; moves stay inside the scope", async () => {
    await upload("project:relaunch", "briefing", "brief.pdf", "%PDF-1.4");
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/projects/relaunch/files/briefing/brief.pdf")));
    assert.equal((await send("/api/files/move", "POST", { scope: "project:relaunch", from: "briefing/brief.pdf", to: "archive/brief-v1.pdf" })).status, 200);
    assert.deepEqual((await list("project:relaunch", "archive")).entries.map((e) => e.name), ["brief-v1.pdf"]);
    assert.equal((await send("/api/files/move", "POST", { scope: "project:relaunch", from: "archive", to: "archive/inner" })).status, 400);
  });

  it("delete goes to the trash, mirrored under trash/files, and comes back", async () => {
    assert.equal((await send("/api/files?scope=workspace&path=brand/logo.svg", "DELETE")).status, 200);
    assert.ok(!existsSync(ws("brand/logo.svg")));
    const trash = ((await (await fetch(srv.url + "/api/trash")).json()) as { entries: TrashEntry[] }).entries;
    const e = trash.find((x) => x.kind === "files")!;
    assert.equal(e.id, "files/workspace/brand/logo.svg");
    assert.equal(e.file, "logo.svg");
    assert.equal(e.from, "kraftwerk-data/files/brand/logo.svg");
    assert.equal((await send("/api/trash/restore", "POST", { id: e.id })).status, 200);
    assert.match(await readFile(ws("brand/logo.svg"), "utf8"), /<svg/);
    // A whole folder too.
    assert.equal((await send("/api/files?scope=project:relaunch&path=archive", "DELETE")).status, 200);
    assert.ok(((await (await fetch(srv.url + "/api/trash")).json()) as { entries: TrashEntry[] }).entries.some((x) => x.id === "files/projects/relaunch/archive"));
  });

  it("a file over 25 MB stays out of git and says so", async () => {
    const big = new Uint8Array(26 * 1024 * 1024);
    const r = await upload("workspace", "video", "demo.mp4", big);
    assert.equal(r.status, 201);
    assert.equal(((await r.json()) as { local?: boolean }).local, true);
    assert.match(await readFile(ws(".gitignore"), "utf8"), /^\/video\/demo\.mp4$/m);
    assert.equal(fx.git("check-ignore", "kraftwerk-data/files/video/demo.mp4"), "kraftwerk-data/files/video/demo.mp4");
    assert.equal((await list("workspace", "video")).entries[0].local, true);
    // Deleted: the ignore line goes with it.
    await send("/api/files?scope=workspace&path=video/demo.mp4", "DELETE");
    assert.ok(!existsSync(ws(".gitignore")), "no big files, no ignore file");
  });

  it("agents and projects are told where the files are", async () => {
    const project = await projectContext("relaunch", "kraftwerk-chat/claude");
    assert.match(project, /## Files\nThe project's files .* are in kraftwerk-data\/projects\/relaunch\/files\//);
    const agent = await agentFilesContext({ files: ["brand"] });
    assert.match(agent, /in kraftwerk-data\/files\/ \(\d+ files?\)/);
    assert.match(agent, /- kraftwerk-data\/files\/brand\//);
  });
});
