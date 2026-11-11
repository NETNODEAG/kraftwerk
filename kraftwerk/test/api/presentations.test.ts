import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSlides, loadPresentation } from "@office-kit/pptx";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import { taskContext } from "../../src/core/boards.js";
import { Workspace } from "../../src/core/workspace.js";
import type { DeckComment, PresentationDetail, PresentationsView, TemplateSummary } from "../../src/core/presentations/index.js";

/**
 * Presentations over the API: the flag, a deck per project and workspace
 * as a folder, the editor's save (slides and whole source), the render
 * (slide PNG, PPTX, PDF) with its warnings, templates, and removal to the
 * trash.
 */
describe("presentations api", () => {
  let fx: Fixture;
  let srv: RunningServer;
  let origin: string;
  const headers = () => ({ "content-type": "application/json", origin });
  const send = (method: string, p: string, body?: unknown) => fetch(srv.url + p, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const post = (p: string, body?: unknown) => send("POST", p, body);
  const put = (p: string, body: unknown) => send("PUT", p, body);
  const del = (p: string) => send("DELETE", p);
  const get = async <T>(p: string): Promise<T> => (await fetch(srv.url + p)).json() as Promise<T>;
  const deckDir = (name: string, project?: string) => path.join(fx.root, project ? `kraftwerk-data/projects/${project}/presentations/${name}` : `kraftwerk-data/presentations/${name}`);

  before(async () => {
    fx = await makeProject("name: fixture\ngit:\n  interval: 0\nprojects:\n");
    srv = await startServer(fx);
    origin = new URL(srv.url).origin;
    assert.equal((await post("/api/projects", { title: "Netnode", slug: "netnode" })).status, 201);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  it("is off without a presentations block: listing says so, creating is refused, meta carries the flag", async () => {
    const v = await get<PresentationsView>("/api/presentations");
    assert.equal(v.enabled, false);
    assert.match(v.error ?? "", /presentations are off/);
    assert.equal((await post("/api/presentations", { title: "Pitch" })).status, 409);
    assert.equal((await get<{ presentations: boolean }>("/api/meta")).presentations, false);
  });

  it("settings turn it on and create the root; a deck is a folder with deck.md and assets/", async () => {
    assert.equal((await put("/api/settings", { presentations: { enabled: true } })).status, 200);
    assert.match(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), /^presentations: \{\}$/m);
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/presentations")));
    assert.equal((await get<{ presentations: boolean }>("/api/meta")).presentations, true);

    const r = await post("/api/presentations", { title: "Why NodeHive", project: "netnode" });
    assert.equal(r.status, 201);
    const d = (await r.json()) as PresentationDetail;
    assert.equal(d.name, "why-nodehive");
    assert.equal(d.project, "netnode");
    assert.equal(d.slides, 2);
    assert.equal(d.template, "default");
    assert.ok(existsSync(path.join(deckDir("why-nodehive", "netnode"), "deck.md")));
    assert.ok(existsSync(path.join(deckDir("why-nodehive", "netnode"), "assets")));
    assert.match(await readFile(path.join(deckDir("why-nodehive", "netnode"), "deck.md"), "utf8"), /^title: Why NodeHive\ntemplate: default\nlayout: title\n---\n# Why NodeHive/m);
    assert.ok(d.layouts.some((l) => l.name === "two-column" && l.slots.map((s) => s.name).join() === "title,eyebrow,left,right"));
    assert.deepEqual(d.warnings, []);

    const ws = await post("/api/presentations", { title: "Town hall", source: "---\ntitle: Town hall\n---\n# Hello\n\n- a\n" });
    assert.equal(ws.status, 201);
    assert.ok(existsSync(path.join(deckDir("town-hall"), "deck.md")));
    assert.equal((await post("/api/presentations", { title: "Town hall" })).status, 400);
  });

  it("lists per project, per workspace and all at once; get knows a missing deck", async () => {
    assert.deepEqual((await get<PresentationsView>("/api/presentations?project=netnode")).presentations.map((p) => p.name), ["why-nodehive"]);
    assert.deepEqual((await get<PresentationsView>("/api/presentations")).presentations.map((p) => p.name), ["town-hall"]);
    assert.deepEqual(
      (await get<PresentationsView>("/api/presentations?all=1")).presentations.map((p) => [p.project, p.name]),
      [
        [undefined, "town-hall"],
        ["netnode", "why-nodehive"],
      ],
    );
    assert.equal((await fetch(`${srv.url}/api/presentations/nope?project=netnode`)).status, 404);
  });

  it("save replaces the slides from the editor and the renderer reports the warnings; the whole source saves too", async () => {
    let r = await put("/api/presentations/why-nodehive?project=netnode", {
      title: "Why NodeHive, really",
      slides: [
        { layout: "title", content: "# Why NodeHive\n\n::subtitle::\nNov 2026", notes: "Start here." },
        { layout: "image", content: "# Picture\n\n::image::\n![missing](assets/nope.png)" },
        { layout: "quote", content: "::bogus::\ntext" },
      ],
    });
    const text = await r.text();
    assert.equal(r.status, 200, text);
    let d = JSON.parse(text) as PresentationDetail;
    assert.equal(d.title, "Why NodeHive, really");
    assert.equal(d.slides, 3);
    assert.equal(d.deck.slides[0].notes, "Start here.");
    assert.deepEqual(
      d.warnings.map((w) => [w.slide, w.slot, w.level]),
      [
        [2, "image", "error"],
        [3, "bogus", "error"],
        [3, "quote", "warning"],
      ],
    );
    const file = await readFile(path.join(deckDir("why-nodehive", "netnode"), "deck.md"), "utf8");
    assert.match(file, /^title: Why NodeHive, really$/m);
    assert.match(file, /::notes::\nStart here\./);

    // Slide numbers: off for the deck is `numbers: false` in its headmatter; on again removes it.
    r = await put("/api/presentations/why-nodehive?project=netnode", { numbers: false });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as PresentationDetail).deck.numbers, false);
    assert.match(await readFile(path.join(deckDir("why-nodehive", "netnode"), "deck.md"), "utf8"), /^numbers: false$/m);
    r = await put("/api/presentations/why-nodehive?project=netnode", { numbers: true });
    assert.equal(((await r.json()) as PresentationDetail).deck.numbers, undefined);
    assert.doesNotMatch(await readFile(path.join(deckDir("why-nodehive", "netnode"), "deck.md"), "utf8"), /numbers:/);

    r = await put("/api/presentations/why-nodehive?project=netnode", { source: "---\ntitle: Short\n---\n# Only one\n" });
    assert.equal(r.status, 200);
    d = (await r.json()) as PresentationDetail;
    assert.equal(d.slides, 1);
    assert.equal(d.source, "---\ntitle: Short\n---\n# Only one\n");
    assert.notEqual((await put("/api/presentations/why-nodehive?project=netnode", { source: "---\n- not: a mapping\n---\n" })).status, 200);
  });

  it("serves a slide as PNG and the deck as PPTX and PDF, all from the same render", async () => {
    const png = await fetch(`${srv.url}/api/presentations/why-nodehive/slides/1?project=netnode&width=320`);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await png.arrayBuffer()).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal((await fetch(`${srv.url}/api/presentations/why-nodehive/slides/9?project=netnode`)).status, 404);

    const pptx = await fetch(`${srv.url}/api/presentations/why-nodehive/export?format=pptx&project=netnode`);
    assert.equal(pptx.status, 200);
    assert.match(pptx.headers.get("content-disposition") ?? "", /attachment; filename\*=UTF-8''why-nodehive\.pptx/);
    assert.equal(getSlides(await loadPresentation(new Uint8Array(await pptx.arrayBuffer()))).length, 1);

    const pdf = await fetch(`${srv.url}/api/presentations/why-nodehive/export?format=pdf&project=netnode`);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  });

  it("a picture uploads into assets/ and a slide's own slot shows it; the detail carries the canvas, the colors and the slots' boxes", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
    const upload = (name: string, body: Buffer) => fetch(`${srv.url}/api/presentations/why-nodehive/assets?project=netnode`, { method: "POST", headers: { origin, "x-file-name": encodeURIComponent(name), "content-type": "image/png" }, body: new Uint8Array(body) });
    let r = await upload("My Logo.PNG", png);
    assert.equal(r.status, 201, await r.clone().text());
    assert.deepEqual(await r.json(), { path: "assets/my-logo.png", size: png.length });
    assert.ok(existsSync(path.join(deckDir("why-nodehive", "netnode"), "assets/my-logo.png")));
    assert.equal(((await (await upload("My Logo.PNG", png)).json()) as { path: string }).path, "assets/my-logo-2.png");
    assert.equal((await upload("notes.txt", png)).status, 400);

    r = await put("/api/presentations/why-nodehive?project=netnode", {
      slides: [{ layout: "content", content: "# Only one\n\ntext\n\n::image1::\n![logo](assets/my-logo.png)", extra: { slots: { image1: { kind: "image", x: 6, y: 1, w: 3, h: 3 }, title: { size: 40 } } } }],
    });
    assert.equal(r.status, 200);
    const d = (await r.json()) as PresentationDetail;
    assert.deepEqual(d.warnings, []);
    assert.deepEqual(d.canvas, { w: 10, h: 5.625 });
    assert.equal(d.colors.accent, "#0284C7");
    assert.deepEqual(d.deck.slides[0].extra, { slots: { image1: { kind: "image", x: 6, y: 1, w: 3, h: 3 }, title: { size: 40 } } });
    const content = d.layouts.find((l) => l.name === "content");
    assert.equal(content?.default, "body");
    assert.deepEqual(content?.slots[0], { name: "title", kind: "text", x: 0.44, y: 0.28, w: 7.3, h: 0.8, size: 24, bold: true, valign: "bottom", color: "text", placeholder: "Title" });
    assert.match(await readFile(path.join(deckDir("why-nodehive", "netnode"), "deck.md"), "utf8"), /^slots:\n  image1:\n    kind: image$/m);
  });

  it("a deck carries its theme for the HTML renderer; a workspace theme's CSS points at its files; the deck's files are served, nothing outside", async () => {
    await fx.write("kraftwerk-data/presentations/templates/look/template.yml", "name: Look\nfonts: { heading: Brand Sans, body: Brand Sans }\ncolors: { accent: '#AA0000' }\nlayouts:\n  content:\n    slots:\n      title: { kind: text, x: 0.5, y: 0.3, w: 9, h: 0.8, size: 30 }\n      body: { kind: markdown, x: 0.5, y: 1.2, w: 9, h: 4 }\nsnippets:\n  - { name: Badge, content: '<span class=\"badge\">new</span>' }\n");
    await fx.write("kraftwerk-data/presentations/templates/look/theme.css", '@font-face { font-family: "Brand Sans"; src: url("fonts/brand.woff2"); }\n.badge { color: var(--c-accent); }\n');
    await fx.write("kraftwerk-data/presentations/templates/look/fonts/brand.woff2", "font");
    let r = await put("/api/presentations/why-nodehive?project=netnode", { template: "look", source: "---\ntitle: Look\ntemplate: look\ncss: |\n  .slot-title { color: red; }\n---\n# Hello\n\n![logo](assets/my-logo.png)\n" });
    assert.equal(r.status, 200);
    const d = (await r.json()) as PresentationDetail;
    assert.equal(d.theme.slug, "look");
    assert.equal(d.theme.colors.accent, "#AA0000");
    assert.match(d.theme.css, /url\("\{\{base\}\}\/api\/presentations\/templates\/look\/file\?path=fonts%2Fbrand\.woff2"\)/);
    assert.deepEqual(d.theme.snippets.map((x) => x.name), ["Badge"]);
    assert.deepEqual(d.themes.map((t) => t.slug), ["default", "look"]);
    assert.match(d.themes[0].css, /\.cards \{/);
    assert.equal(d.deck.css, ".slot-title { color: red; }\n");

    const font = await fetch(`${srv.url}/api/presentations/templates/look/file?path=fonts/brand.woff2`);
    assert.equal(font.status, 200);
    assert.equal(font.headers.get("content-type"), "font/woff2");
    assert.equal((await fetch(`${srv.url}/api/presentations/templates/look/file?path=../look/template.yml`)).status, 404);
    assert.equal((await fetch(`${srv.url}/api/presentations/templates/default/file?path=theme.css`)).status, 404);
    const pic = await fetch(`${srv.url}/api/presentations/why-nodehive/file?path=assets/my-logo.png&project=netnode`);
    assert.equal(pic.status, 200);
    assert.equal(pic.headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${srv.url}/api/presentations/why-nodehive/file?path=../../project.yml&project=netnode`)).status, 404);

    r = await fetch(`${srv.url}/api/presentations/why-nodehive/export?format=html&project=netnode`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /^text\/html/);
    const html = await r.text();
    assert.match(html, /<section class="deck-slide deck-theme-look layout-content is-current"/);
    assert.doesNotMatch(html, /data-src="data:/, "the original path stays the original path");
    assert.match(html, /src="data:image\/png;base64,iVBOR/, "pictures inlined");
    assert.match(html, /url\("data:font\/woff2;base64,/, "the theme's font inlined");
    assert.match(html, /\.deck-theme-look\.deck-slide \{\n\.slot-title \{ color: red; \}/, "the deck's CSS, scoped");
    await put("/api/presentations/why-nodehive?project=netnode", { template: "default" });
  });

  it("comments sit on a slide (which gets an id) or a box, follow the slide when it moves, are answered, resolved and removed; a stale save is refused", async () => {
    await put("/api/presentations/town-hall", { source: "---\ntitle: Town hall\n---\n# One\n\n---\n# Two\n" });
    let r = await post("/api/presentations/town-hall/comments", { slide: 2, slot: "title", text: "Shorter, please" });
    assert.equal(r.status, 201);
    const c = (await r.json()) as DeckComment;
    assert.equal(c.n, 2);
    assert.equal(c.slot, "title");
    assert.match(c.author, /\S/);
    const file = await readFile(path.join(deckDir("town-hall"), "deck.md"), "utf8");
    const id = /^id: (s\w+)$/m.exec(file)?.[1];
    assert.ok(id, "slide 2 got an id");
    assert.equal(c.slide, id);
    assert.equal((await post("/api/presentations/town-hall/comments", { slide: 9, text: "x" })).status, 404);
    assert.equal((await post("/api/presentations/town-hall/comments", { slide: 1, text: " " })).status, 400);

    // The slide moves: its comment goes with it.
    let d = await get<PresentationDetail>("/api/presentations/town-hall");
    r = await put("/api/presentations/town-hall", { slides: [d.deck.slides[1], d.deck.slides[0]] });
    d = (await r.json()) as PresentationDetail;
    assert.equal(d.comments[0].n, 1);

    r = await put(`/api/presentations/town-hall/comments/${c.id}`, { reply: "Done", resolved: true });
    assert.equal(r.status, 200);
    const done = (await r.json()) as DeckComment;
    assert.equal(done.resolved, true);
    assert.deepEqual(done.replies.map((x) => x.text), ["Done"]);
    assert.match(await readFile(path.join(deckDir("town-hall"), "comments.json"), "utf8"), /"resolved": true/);
    assert.equal((await del(`/api/presentations/town-hall/comments/${c.id}`)).status, 200);
    assert.equal((await del(`/api/presentations/town-hall/comments/${c.id}`)).status, 404);

    // Saving over a deck changed since it was read: 409 with the current updatedAt, nothing written.
    d = await get<PresentationDetail>("/api/presentations/town-hall");
    await new Promise((res) => setTimeout(res, 20));
    await fx.write("kraftwerk-data/presentations/town-hall/deck.md", "---\ntitle: Town hall\n---\n# Changed elsewhere\n");
    r = await put("/api/presentations/town-hall", { base: d.updatedAt, title: "Mine" });
    assert.equal(r.status, 409);
    const body = (await r.json()) as { updatedAt: string };
    assert.notEqual(body.updatedAt, d.updatedAt);
    assert.match(await readFile(path.join(deckDir("town-hall"), "deck.md"), "utf8"), /# Changed elsewhere/);
    assert.equal((await put("/api/presentations/town-hall", { base: body.updatedAt, title: "Mine" })).status, 200);
  });

  it("presence: each editor reports its slide and box; the deck's live topic tells the others on every move and when one leaves", async () => {
    const ws = new WebSocket(srv.url.replace(/^http/, "ws") + "/api/ws");
    const events: { viewers: { client: string; slide: number; slot?: string; who: string }[] }[] = [];
    const raw: string[] = [];
    after(() => ws.close());
    ws.onmessage = (m) => {
      raw.push(String(m.data));
      const msg = JSON.parse(String(m.data)) as { event?: string; data?: (typeof events)[number] };
      if (msg.event === "p" && msg.data) events.push(msg.data);
    };
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ sub: "p", topic: "deck.netnode/why-nodehive" }));
    const until = async (ok: () => boolean) => {
      const end = Date.now() + 3000;
      while (Date.now() < end && !ok()) await new Promise((r) => setTimeout(r, 20));
      assert.ok(ok(), raw.join("\n"));
    };
    await until(() => events.length > 0 && events.at(-1)!.viewers.length === 0);
    let r = await post("/api/presentations/why-nodehive/presence?project=netnode", { client: "a", slide: 2, slot: "title" });
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as { viewers: { client: string }[] }).viewers.map((v) => v.client), ["a"]);
    await post("/api/presentations/why-nodehive/presence?project=netnode", { client: "b", slide: 1 });
    await until(() => events.at(-1)!.viewers.length === 2);
    const a = events.at(-1)!.viewers.find((v) => v.client === "a")!;
    assert.equal(a.slide, 2);
    assert.equal(a.slot, "title");
    assert.match(a.who, /\S/);
    // A heartbeat that changes nothing is not news; a move is.
    const before = events.length;
    await post("/api/presentations/why-nodehive/presence?project=netnode", { client: "b", slide: 1 });
    await post("/api/presentations/why-nodehive/presence?project=netnode", { client: "b", slide: 3 });
    await until(() => events.at(-1)!.viewers.find((v) => v.client === "b")?.slide === 3);
    assert.equal(events.length, before + 1);
    await post("/api/presentations/why-nodehive/presence?project=netnode", { client: "a", slide: 1, leave: true });
    await until(() => events.at(-1)!.viewers.map((v) => v.client).join() === "b");
    // An editor that follows the deck with its id leaves when its connection closes.
    const tab = new WebSocket(srv.url.replace(/^http/, "ws") + "/api/ws");
    await new Promise((r) => (tab.onopen = r));
    tab.send(JSON.stringify({ sub: "me", topic: "deck.netnode/why-nodehive@c" }));
    await post("/api/presentations/why-nodehive/presence?project=netnode", { client: "c", slide: 2 });
    await until(() => events.at(-1)!.viewers.some((v) => v.client === "c"));
    tab.close();
    await until(() => !events.at(-1)!.viewers.some((v) => v.client === "c"));
    assert.equal((await post("/api/presentations/nope/presence?project=netnode", { client: "a", slide: 1 })).status, 404);

    // While the deck is open, a write to deck.md on disk (an agent) reaches a watching editor at once, not on its next poll.
    const pushed: { title?: string }[] = [];
    const watcher = new WebSocket(srv.url.replace(/^http/, "ws") + "/api/ws");
    after(() => watcher.close());
    watcher.onmessage = (m) => {
      const msg = JSON.parse(String(m.data)) as { watch?: string; data?: { title?: string } };
      if (msg.watch === "d" && msg.data) pushed.push(msg.data);
    };
    await new Promise((r) => (watcher.onopen = r));
    watcher.send(JSON.stringify({ watch: "d", name: "presentations.get", input: { name: "why-nodehive", query: { project: "netnode" } }, interval: 60_000 }));
    watcher.send(JSON.stringify({ sub: "open", topic: "deck.netnode/why-nodehive@w" }));
    await until(() => pushed.length > 0);
    const file = path.join(deckDir("why-nodehive", "netnode"), "deck.md");
    const text = await readFile(file, "utf8");
    const started = Date.now();
    await fx.write("kraftwerk-data/projects/netnode/presentations/why-nodehive/deck.md", text.replace(/^title: .*$/m, "title: Written by an agent"));
    await until(() => pushed.at(-1)?.title === "Written by an agent");
    assert.ok(Date.now() - started < 2000, `pushed after ${Date.now() - started} ms`);
    watcher.close();
    ws.close();
    await post("/api/presentations/why-nodehive/presence?project=netnode", { client: "b", slide: 1, leave: true });
  });

  it("history: a save keeps the version it replaced (a burst of saves is one version), each version reads back with its deck; an edit on disk to an open deck is kept too", async () => {
    await put("/api/presentations/history-demo", {}).catch(() => {});
    assert.equal((await post("/api/presentations", { title: "History demo" })).status, 201);
    assert.deepEqual((await get<{ versions: unknown[] }>("/api/presentations/history-demo/history")).versions, []);
    await put("/api/presentations/history-demo", { source: "---\ntitle: History demo\n---\n# First\n" });
    await put("/api/presentations/history-demo", { source: "---\ntitle: History demo\n---\n# Second\n" });
    let v = (await get<{ versions: { id: string; title: string; slides: number }[] }>("/api/presentations/history-demo/history")).versions;
    assert.equal(v.length, 1, "the second save within the minute is not a new version");
    assert.equal(v[0].slides, 2, "the starter deck");
    const one = await get<{ source: string; deck: { title: string; slides: unknown[] } }>(`/api/presentations/history-demo/history/${v[0].id}`);
    assert.equal(one.deck.title, "History demo");
    assert.match(one.source, /^title: History demo$/m);
    assert.equal((await fetch(`${srv.url}/api/presentations/history-demo/history/20990101T000000Z`)).status, 404);
    assert.equal((await fetch(`${srv.url}/api/presentations/history-demo/history/..%2F..%2Fdeck`)).status, 404);

    // Open in an editor (followed on the socket): an agent's write to deck.md keeps the version before it, whatever the minute.
    const ws = new WebSocket(srv.url.replace(/^http/, "ws") + "/api/ws");
    after(() => ws.close());
    let ready = false;
    ws.onmessage = (m) => {
      if ((JSON.parse(String(m.data)) as { event?: string }).event === "o") ready = true;
    };
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ sub: "o", topic: "deck.history-demo@x" }));
    for (let i = 0; i < 100 && !ready; i++) await new Promise((r) => setTimeout(r, 20));
    await fx.write("kraftwerk-data/presentations/history-demo/deck.md", "---\ntitle: History demo\n---\n# Written by an agent\n");
    for (let i = 0; i < 100; i++) {
      v = (await get<{ versions: { id: string; title: string; slides: number }[] }>("/api/presentations/history-demo/history")).versions;
      if (v.length === 2) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(v.length, 2);
    assert.match((await get<{ source: string }>(`/api/presentations/history-demo/history/${v[0].id}`)).source, /# Second/);
    ws.close();
  });

  it("links: a task links a deck (presentation:<name> in its refs); the deck lists the task, and the task's agent gets the deck's folder", async () => {
    assert.equal((await put("/api/settings", { boards: { enabled: true } })).status, 200);
    assert.ok((await post("/api/boards/default", { project: "netnode" })).ok);
    let r = await post("/api/boards/tasks/tasks?project=netnode", { title: "Present the pitch", refs: ["presentation:why-nodehive", "contact:nobody"] });
    const task = (await r.json()) as { ref: string; slug: string; refs: string[] };
    assert.equal(r.status, 201, JSON.stringify(task));
    assert.deepEqual(task.refs, ["presentation:why-nodehive", "contact:nobody"]);

    const links = await get<{ tasks: { ref: string; title: string; board: string; project?: string; href: string }[] }>("/api/presentations/why-nodehive/links?project=netnode");
    assert.deepEqual(links.tasks.map((t) => [t.title, t.project, t.board, t.href]), [["Present the pitch", "netnode", "tasks", `/projects/netnode/boards/tasks/${task.slug}`]]);
    assert.deepEqual((await get<{ tasks: unknown[] }>("/api/presentations/history-demo/links")).tasks, []);
    assert.equal((await fetch(`${srv.url}/api/presentations/nope/links`)).status, 404);

    // The refs resolve like every other kind's: found with the deck's title, a missing contact reported.
    r = await post("/api/refs/resolve", { tokens: task.refs });
    const refs = ((await r.json()) as { refs: { token: string; found: boolean; label?: string; href: string }[] }).refs;
    assert.deepEqual(refs.map((x) => [x.token, x.found]), [["presentation:why-nodehive", true], ["contact:nobody", false]]);
    assert.equal(refs[0].href, "/projects/netnode/presentations/why-nodehive");

    const ws = new Workspace({ outputDir: path.join(fx.root, "kraftwerk-data"), root: fx.root });
    const context = await ws.run(() => taskContext(task.ref));
    assert.match(context, /### Linked\n- presentation:why-nodehive — "[^"]+" in project netnode, 1 slides, folder .*why-nodehive \(`npx kraftwerk presentations show why-nodehive --project netnode`\)\n- contact:nobody — not found/);
  });

  it("templates: the built-in one plus the workspace's, broken ones with their error; a deck naming an unknown template renders with default and says so", async () => {
    await fx.write("kraftwerk-data/presentations/templates/brand/template.yml", "name: Brand\ncolors:\n  accent: '#D7262C'\nlayouts:\n  content:\n    slots:\n      title: { kind: text, x: 0.5, y: 0.3, w: 9, h: 0.8, size: 30 }\n      body: { kind: markdown, x: 0.5, y: 1.2, w: 9, h: 4 }\n");
    await fx.write("kraftwerk-data/presentations/templates/broken/template.yml", "name: Broken\nlayouts: []\n");
    const t = await get<{ templates: TemplateSummary[] }>("/api/presentations/templates");
    assert.deepEqual(
      t.templates.map((x) => [x.slug, x.layouts.length, !!x.error]),
      [
        ["default", 10, false],
        ["brand", 1, false],
        ["look", 1, false],
        ["broken", 0, true],
      ],
    );
    let r = await put("/api/presentations/town-hall", { template: "brand" });
    assert.equal(r.status, 200);
    let d = (await r.json()) as PresentationDetail;
    assert.deepEqual(d.layouts.map((l) => l.name), ["content"]);
    assert.deepEqual(d.warnings, []);
    r = await put("/api/presentations/town-hall", { template: "ghost" });
    d = (await r.json()) as PresentationDetail;
    assert.equal(d.warnings[0].slide, 0);
    assert.match(d.warnings[0].message, /unknown template "ghost"/);
  });

  it("DELETE moves the deck folder to the trash; settings turn the feature off", async () => {
    assert.equal((await del("/api/presentations/why-nodehive?project=netnode")).status, 200);
    assert.ok(!existsSync(deckDir("why-nodehive", "netnode")));
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/trash/presentations/netnode/why-nodehive/deck.md")));
    assert.equal((await fetch(`${srv.url}/api/presentations/why-nodehive?project=netnode`)).status, 404);
    assert.equal((await put("/api/settings", { presentations: { enabled: false } })).status, 200);
    assert.doesNotMatch(await readFile(path.join(fx.root, "kraftwerk.yml"), "utf8"), /^presentations:/m);
    assert.equal((await get<PresentationsView>("/api/presentations")).enabled, false);
  });
});
