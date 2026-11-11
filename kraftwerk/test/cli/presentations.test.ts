import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cli, json } from "../helpers/cli.js";
import { makeProject, type Fixture } from "../helpers/project.js";
import type { PresentationDetail, PresentationsView, TemplateSummary } from "../../src/core/presentations/index.js";

/**
 * `kraftwerk presentations` through the real bin: the flag, a deck from a
 * markdown file, show with the template's layouts and the warnings, check's
 * exit code, render into exports/, templates init, and removal to the trash.
 */
describe("kraftwerk presentations", () => {
  let fx: Fixture;
  const run = (args: string[]) => cli(fx.root, fx.home, args);
  const deckDir = () => path.join(fx.root, "kraftwerk-data/projects/netnode/presentations/pitch");

  before(async () => {
    fx = await makeProject("name: fixture\ngit:\n  interval: 0\nprojects:\n");
    const r = await run(["projects", "create", "Netnode", "--slug", "netnode"]);
    assert.equal(r.code, 0, r.all);
  });
  after(() => fx.cleanup());

  it("is off without a presentations block", async () => {
    const r = await run(["presentations"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /presentations are off/);
    await fx.write("kraftwerk.yml", "name: fixture\ngit:\n  interval: 0\nprojects:\npresentations:\n");
  });

  it("create --from writes the folder; show prints slides, layouts and warnings; check exits 1 on errors", async () => {
    const src = path.join(fx.root, "pitch.md");
    await writeFile(src, "---\ntitle: Pitch\nlayout: title\n---\n# Pitch\n\n::subtitle::\nNov\n\n---\nlayout: image\n---\n# Picture\n\n::image::\n![x](assets/nope.png)\n");
    let r = await run(["presentations", "create", "Pitch", "--project", "netnode", "--slug", "pitch", "--from", src, "--json"]);
    assert.equal(r.code, 0, r.all);
    const d = json<PresentationDetail>(r);
    assert.equal(d.name, "pitch");
    assert.equal(d.slides, 2);
    assert.ok(existsSync(path.join(deckDir(), "deck.md")));
    assert.ok(existsSync(path.join(deckDir(), "assets")));
    r = await run(["presentations", "--project", "netnode", "--json"]);
    assert.deepEqual(json<PresentationsView>(r).presentations.map((p) => [p.name, p.title, p.slides]), [["pitch", "Pitch", 2]]);
    r = await run(["presentations", "show", "pitch", "--project", "netnode"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /1 {2}\[title\] Pitch/);
    assert.match(r.stdout, /2 {2}\[image\] Picture/);
    assert.match(r.stdout, /two-column {3}title:text eyebrow:text left\*:markdown right\*:markdown/);
    assert.match(r.stdout, /error {2}slide 2 · image {2}image not found: assets\/nope\.png/);
    r = await run(["presentations", "check", "pitch", "--project", "netnode"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /image not found/);
    await mkdir(path.join(deckDir(), "assets"), { recursive: true });
    await writeFile(path.join(deckDir(), "assets/nope.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
    r = await run(["presentations", "check", "pitch", "--project", "netnode"]);
    assert.equal(r.code, 0, r.all);
    assert.match(r.stdout, /ok 2 slides, no warnings/);
  });

  it("render writes PPTX, PDF and slide PNGs into exports/", async () => {
    let r = await run(["presentations", "render", "pitch", "--project", "netnode"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--pptx, --pdf, --png and\/or --html/);
    r = await run(["presentations", "render", "pitch", "--project", "netnode", "--html", "--json"]);
    assert.equal(r.code, 0, r.all);
    const page = await readFile(path.join(deckDir(), "exports/pitch.html"), "utf8");
    assert.equal((page.match(/<section class="deck-slide/g) ?? []).length, 2);
    assert.match(page, /data:image\/png;base64,/);
    r = await run(["presentations", "render", "pitch", "--project", "netnode", "--pptx", "--pdf", "--png", "--width", "320", "--json"]);
    assert.equal(r.code, 0, r.all);
    const out = json<{ files: string[] }>(r);
    const real = await realpath(deckDir());
    assert.deepEqual(
      out.files.map((f) => path.relative(real, f)),
      ["exports/pitch.pptx", "exports/pitch.pdf", "exports/slides/01.png", "exports/slides/02.png"],
    );
    for (const f of out.files) assert.ok(existsSync(f), f);
    assert.equal((await readFile(path.join(deckDir(), "exports/pitch.pdf"))).subarray(0, 5).toString(), "%PDF-");
    r = await run(["presentations", "show", "pitch", "--project", "netnode"]);
    assert.match(r.stdout, /exports\/pitch\.pptx/);
  });

  it("templates list the built-in one; init writes a workspace copy the list then shows", async () => {
    let r = await run(["presentations", "templates", "--json"]);
    assert.deepEqual(json<{ templates: TemplateSummary[] }>(r).templates.map((t) => [t.slug, t.builtin]), [["default", true]]);
    r = await run(["presentations", "templates", "init", "brand"]);
    assert.equal(r.code, 0, r.all);
    const file = path.join(fx.root, "kraftwerk-data/presentations/templates/brand/template.yml");
    assert.ok(existsSync(file));
    assert.match(await readFile(file, "utf8"), /^name: brand$/m);
    r = await run(["presentations", "templates"]);
    assert.match(r.stdout, /brand {10}brand \(16:9; layouts: title, section, content/);
    assert.equal((await run(["presentations", "templates", "init", "brand"])).code, 1);
  });

  it("comments: an agent lists the open ones, resolves one with a reply, leaves one of its own", async () => {
    let r = await run(["presentations", "comment", "pitch", "1", "Tighter title", "--project", "netnode", "--slot", "title"]);
    assert.equal(r.code, 0, r.all);
    const id = /commented (c\w+) on slide 1/.exec(r.stdout)?.[1];
    assert.ok(id, r.stdout);
    r = await run(["presentations", "comments", "pitch", "--project", "netnode"]);
    assert.match(r.stdout, new RegExp(`${id} slide 1 · title · human:user`));
    assert.match(r.stdout, /Tighter title/);
    r = await cli(fx.root, fx.home, ["presentations", "resolve", "pitch", id!, "--reply", "shortened to four words", "--project", "netnode"], { env: { KRAFTWERK_ACTOR: "lisa/claude" } });
    assert.equal(r.code, 0, r.all);
    r = await run(["presentations", "comments", "pitch", "--project", "netnode"]);
    assert.match(r.stdout, /no open comments/);
    r = await run(["presentations", "comments", "pitch", "--project", "netnode", "--all", "--json"]);
    const all = json<{ comments: { resolved?: boolean; replies: { author: string; text: string; at: string }[] }[] }>(r).comments;
    assert.equal(all[0].resolved, true);
    assert.deepEqual(all[0].replies.map(({ author, text }) => ({ author, text })), [{ author: "lisa/claude", text: "shortened to four words" }]);
  });

  it("remove moves the deck to the trash", async () => {
    const r = await run(["presentations", "remove", "pitch", "--project", "netnode"]);
    assert.equal(r.code, 0, r.all);
    assert.ok(!existsSync(deckDir()));
    assert.ok(existsSync(path.join(fx.root, "kraftwerk-data/trash/presentations/netnode/pitch/deck.md")));
    assert.equal((await run(["presentations", "show", "pitch", "--project", "netnode"])).code, 1);
  });
});
