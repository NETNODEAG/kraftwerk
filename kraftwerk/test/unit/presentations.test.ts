import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSlides, getSlideNotes, getSlideShapes, getShapeKind, getShapeText, loadPresentation } from "@office-kit/pptx";
import { parseDeck, serializeDeck } from "../../src/core/presentations/deck.js";
import { DEFAULT_SLOT, getSlot, joinSlots, setSlot, slotsOf } from "../../src/core/presentations/slots.js";
import { inlineRuns, parseMarkdown } from "../../src/core/presentations/markdown.js";
import { renderDeck } from "../../src/core/presentations/render.js";
import { DEFAULT_TEMPLATE, defaultTemplateYaml, layoutFor, parseTemplate, resolveColor, slideSlots } from "../../src/core/presentations/template.js";
import { getShapeBounds, getShapeChartSpec, getShapeName, getShapePosition, getShapeRotation, getSlideSize, getSlideTransition, isSlideHidden } from "@office-kit/pptx";
import { slidePng, toPdf, toPptx } from "../../src/core/presentations/export.js";
import { slideHtml, slideView, slotStyle, stageCss, standaloneHtml, type StageTemplate } from "../../src/core/presentations/html.js";
import { chartSvg, parseChart, chartSource } from "../../src/core/presentations/chart.js";
import { templateColors } from "../../src/core/presentations/layout.js";
import { DEFAULT_CSS } from "../../src/core/presentations/builtin.js";
import { mergeDrafts } from "../../src/core/presentations/merge.js";

/**
 * The presentations engine without a server: deck.md in and out, slot
 * markdown into blocks, the template schema, and the renderer's model —
 * read back through office-kit itself — plus the three exports' shapes.
 */
const PNG_1X1 = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));

const DECK = `---
title: Why NodeHive
template: default
layout: title
author: lisa
---
# Why NodeHive

::subtitle::
Review · Nov 2026

::notes::
Open with the timeline.

---
layout: two-column
---
# Faster editing

::left::
- One API for **every** channel
- Editors in \`markdown\`
  - nested point
- [Docs](https://netnode.ch)

::right::
![Architecture](assets/arch.png)

---
layout: chart
---
# Plan

::chart::
\`\`\`chart
kind: column
categories: [Q1, Q2]
series:
  - name: Revenue
    values: [120, 180]
\`\`\`

---
layout: table
---
# Numbers

| Item | Value |
|---|---|
| Pages | **120** |

---
# Plain content

A paragraph, then a code fence that hides a separator:

\`\`\`
---
not a slide
\`\`\`
`;

describe("presentations: deck.md", () => {
  it("parses headmatter, slide blocks, slots and notes; fences hide separators and markers", () => {
    const deck = parseDeck(DECK);
    assert.equal(deck.title, "Why NodeHive");
    assert.equal(deck.template, "default");
    assert.deepEqual(deck.meta, { author: "lisa" });
    assert.deepEqual(
      deck.slides.map((s) => s.layout),
      ["title", "two-column", "chart", "table", undefined],
    );
    assert.equal(deck.slides[0].notes, "Open with the timeline.");
    assert.ok(!deck.slides[0].content.includes("::notes::"), "notes are lifted out of the content");
    const slots = slotsOf(deck.slides[1].content);
    assert.deepEqual(Object.keys(slots), [DEFAULT_SLOT, "left", "right"]);
    assert.equal(slots[DEFAULT_SLOT], "# Faster editing");
    assert.match(slots.right, /^!\[Architecture\]/);
    assert.match(deck.slides[4].content, /^---\nnot a slide\n```$/m);
  });

  it("serialises to the normalised form and parses back to the same deck", () => {
    const deck = parseDeck(DECK);
    const text = serializeDeck(deck);
    assert.match(text, /^---\ntitle: Why NodeHive\ntemplate: default\nauthor: lisa\nlayout: title\n---\n# Why NodeHive/);
    assert.match(text, /\n---\nlayout: two-column\n---\n# Faster editing\n/);
    assert.match(text, /::notes::\nOpen with the timeline\./);
    assert.deepEqual(parseDeck(text), deck);
  });

  it("a `---` with no YAML after it is a plain separator; an empty file is one empty slide", () => {
    const deck = parseDeck("---\ntitle: T\n---\n# One\n\n---\n\n# Two\n");
    assert.equal(deck.slides.length, 2);
    assert.equal(deck.slides[1].content, "# Two");
    assert.deepEqual(parseDeck("").slides, [{ extra: {}, content: "" }]);
    assert.equal(joinSlots({ [DEFAULT_SLOT]: "# T", right: "x" }), "# T\n\n::right::\nx");
  });
});

describe("presentations: slots in place", () => {
  const content = "# Faster editing\n\nIntro line.\n\n::right::\n![a](assets/a.png)";
  it("reads a slot from its block, the title from the heading, the default slot from the rest", () => {
    assert.equal(getSlot(content, "title", "left"), "Faster editing");
    assert.equal(getSlot(content, "left", "left"), "Intro line.");
    assert.equal(getSlot(content, "right", "left"), "![a](assets/a.png)");
    assert.equal(getSlot(content, "caption", "left"), undefined);
  });
  it("writes a slot back where it lives; an empty text removes it", () => {
    assert.equal(setSlot(content, "title", "Slower editing", "left"), "# Slower editing\n\nIntro line.\n\n::right::\n![a](assets/a.png)");
    assert.equal(setSlot(content, "left", "- one\n- two", "left"), "# Faster editing\n\n- one\n- two\n\n::right::\n![a](assets/a.png)");
    assert.equal(setSlot(content, "right", "", "left"), "# Faster editing\n\nIntro line.");
    assert.equal(setSlot(content, "caption", "Fig. 1", "left"), "# Faster editing\n\nIntro line.\n\n::right::\n![a](assets/a.png)\n\n::caption::\nFig. 1");
    assert.equal(setSlot("", "title", "New", "body"), "# New");
    assert.equal(setSlot("::body::\ntext", "body", "other", "body"), "::body::\nother");
  });
});

describe("presentations: a slide's own slots", () => {
  const content = DEFAULT_TEMPLATE.layouts.content;
  it("merges the slide's changes over the layout's slots and adds its own boxes; bad entries are named", () => {
    const { slots, problems } = slideSlots(content, { title: { y: 1, size: 44 }, text1: { kind: "markdown", x: 1, y: 2, w: 4, h: 1 }, nobox: { size: 12 }, body: { align: "middle" } });
    assert.equal(slots.title.y, 1);
    assert.equal(slots.title.size, 44);
    assert.equal(slots.title.x, content.slots.title.x, "what the slide does not change stays the layout's");
    assert.deepEqual(slots.text1, { kind: "markdown", x: 1, y: 2, w: 4, h: 1, own: true });
    assert.equal(slots.title.changed, true);
    assert.equal(slots.nobox, undefined);
    assert.equal(slots.body.align, undefined);
    assert.equal(problems.length, 2);
    assert.match(problems.join("\n"), /slots\.nobox: a slot the layout does not have needs x, y, w and h/);
    assert.match(problems.join("\n"), /slots\.body/);
  });

  it("the changes live in the slide's YAML head — the first slide's in the headmatter — and move what is drawn", async () => {
    const src = "---\ntitle: T\nslots:\n  title:\n    x: 2\n    y: 3\n---\n# One\n\nbody\n\n---\nlayout: content\nslots:\n  text1:\n    kind: markdown\n    x: 1\n    y: 4\n    w: 3\n    h: 1\n---\n# Two\n\nbody\n\n::text1::\nA free box\n";
    const deck = parseDeck(src);
    assert.deepEqual(deck.meta, {});
    assert.deepEqual(deck.slides[0].extra, { slots: { title: { x: 2, y: 3 } } });
    assert.deepEqual(parseDeck(serializeDeck(deck)), deck);
    const { pres, warnings } = await renderDeck(deck, DEFAULT_TEMPLATE, { read: async () => null });
    assert.deepEqual(warnings, []);
    const [one, two] = getSlides(pres);
    const inch = 914400;
    const named = (slide: (typeof one), n: string) => getSlideShapes(slide).find((s) => getShapeName(s) === n)!;
    const t = getShapePosition(named(one, "title"));
    assert.deepEqual([t?.x, t?.y], [2 * inch, 3 * inch]);
    const free = named(two, "text1");
    assert.equal(getShapeText(free), "A free box");
    assert.deepEqual([getShapePosition(free)?.x, getShapePosition(free)?.y], [1 * inch, 4 * inch]);
  });

  it("the PPTX page is the 10in canvas the layouts are drawn on, and a hairline rule stays a hairline", async () => {
    // Keynote showed every slide squeezed into the left 3/4: office-kit's 16:9 preset is 13.333in wide.
    const inch = 914400;
    for (const [size, h] of [["16:9", 5.625], ["4:3", 7.5]] as const) {
      const { pres } = await renderDeck({ ...parseDeck("# A\n"), size }, DEFAULT_TEMPLATE, { read: async () => null });
      const s = getSlideSize(pres)!;
      assert.deepEqual([s.width, s.height], [10 * inch, h * inch], size);
    }
    const { pres } = await renderDeck(parseDeck("---\nlayout: content\n---\n# A\n\nbody\n"), DEFAULT_TEMPLATE, { read: async () => null });
    const rule = getSlideShapes(getSlides(pres)[0]).find((s) => getShapeName(s) === "Decoration")!;
    assert.ok(getShapeBounds(rule)!.h < 0.02 * inch);
  });
});

describe("presentations: markdown", () => {
  it("turns slot markdown into blocks with inline runs, list levels, images, tables and chart blocks", () => {
    const blocks = parseMarkdown("# Head\n\nA **bold** and `code` [link](https://x.y).\n\n- one\n  - two\n1. three\n\n![alt](a.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```chart\nkind: pie\n```\n");
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ["heading", "paragraph", "list", "list", "image", "table", "chart"],
    );
    const p = blocks[1];
    assert.ok(p.kind === "paragraph");
    assert.deepEqual(p.runs, [{ text: "A " }, { text: "bold", bold: true }, { text: " and " }, { text: "code", code: true }, { text: " " }, { text: "link", href: "https://x.y" }, { text: "." }]);
    const list = blocks[2];
    assert.ok(list.kind === "list");
    assert.deepEqual(
      list.items.map((i) => [i.level, i.ordered, i.runs[0].text]),
      [
        [0, false, "one"],
        [1, false, "two"],
      ],
    );
    assert.deepEqual(inlineRuns("# **Big** title"), [{ text: "Big", bold: true }, { text: " title" }]);
  });
});

describe("presentations: template", () => {
  it("the built-in template round-trips through its YAML and the schema; colors and layouts resolve", () => {
    const t = parseTemplate("mine", defaultTemplateYaml(), "mine/template.yml");
    assert.equal(t.slug, "mine");
    assert.deepEqual(Object.keys(t.layouts), Object.keys(DEFAULT_TEMPLATE.layouts));
    assert.equal(resolveColor(DEFAULT_TEMPLATE, "accent"), "#0284C7");
    assert.equal(resolveColor(DEFAULT_TEMPLATE, "#abcdef"), "#ABCDEF");
    assert.equal(resolveColor(DEFAULT_TEMPLATE, "nope"), null);
    assert.equal(layoutFor(DEFAULT_TEMPLATE, undefined)?.name, "content");
    assert.equal(layoutFor(DEFAULT_TEMPLATE, "quote")?.name, "quote");
    assert.equal(layoutFor(DEFAULT_TEMPLATE, "missing"), null);
  });

  it("rejects a template whose default slot or layout does not exist, naming the field", () => {
    assert.throws(() => parseTemplate("t", "name: T\nlayouts:\n  a:\n    default: nope\n    slots:\n      body: {x: 0, y: 0, w: 1, h: 1}\n"), /default slot "nope"/);
    assert.throws(() => parseTemplate("t", "name: T\ndefault: zz\nlayouts:\n  a:\n    slots:\n      body: {x: 0, y: 0, w: 1, h: 1}\n"), /default layout "zz"/);
    assert.throws(() => parseTemplate("t", "name: T\nlayouts:\n  a:\n    slots:\n      body: {kind: video, x: 0, y: 0, w: 1, h: 1}\n"), /kind/);
  });
});

describe("presentations: renderer and exports", () => {
  const assets = { read: async (src: string) => (src === "assets/arch.png" ? PNG_1X1 : null) };

  it("draws every slot kind into the PowerPoint model and reports what it cannot place", async () => {
    const deck = parseDeck(DECK);
    deck.slides.push({ layout: "nope", extra: {}, content: "x" }, { layout: "quote", extra: {}, content: "::bogus::\nx" }, { layout: "image", extra: {}, content: "# T\n::image::\n![m](assets/missing.png)" });
    const { pres, warnings } = await renderDeck(deck, DEFAULT_TEMPLATE, assets);
    const slides = getSlides(pres);
    assert.equal(slides.length, 8);
    // Each slot's shape carries the slot's name; decorations (the layout's hairlines) have none of theirs.
    const kinds = (i: number) => Object.fromEntries(getSlideShapes(slides[i]).filter((s) => /^[a-z]/.test(getShapeName(s))).map((s) => [getShapeName(s), getShapeKind(s)]));
    assert.deepEqual(kinds(0), { title: "shape", subtitle: "shape" }, "title + subtitle");
    assert.deepEqual(kinds(1), { title: "shape", left: "shape", right: "picture" }, "title, bullets, the picture");
    assert.deepEqual(kinds(2), { title: "shape", chart: "graphicFrame" }, "title + the chart");
    // The series take the template's accent, like the HTML chart, not PowerPoint's default blue.
    const chartSpecRead = getShapeChartSpec(getSlideShapes(slides[2]).find((s) => getShapeName(s) === "chart")!);
    assert.equal(chartSpecRead?.series[0].color?.toUpperCase(), resolveColor(DEFAULT_TEMPLATE, "accent")?.toUpperCase());
    assert.deepEqual(kinds(3), { title: "shape", table: "graphicFrame" }, "title + the table");
    assert.equal(getSlideNotes(slides[0]), "Open with the timeline.");
    assert.match(getShapeText(getSlideShapes(slides[1]).find((s) => getShapeName(s) === "left")!), /One API for every channel/);
    assert.deepEqual(
      warnings.map((w) => [w.slide, w.slot, w.level]),
      [
        [6, undefined, "error"],
        [7, "bogus", "error"],
        [7, "quote", "warning"],
        [8, "image", "error"],
      ],
    );
    assert.match(warnings[0].message, /unknown layout "nope", using "content"/);
    assert.match(warnings[3].message, /image not found: assets\/missing\.png/);
  });

  it("writes a PPTX office-kit can load again, a PNG per slide and a PDF with one page per slide", async () => {
    const { pres } = await renderDeck(parseDeck(DECK), DEFAULT_TEMPLATE, assets);
    const pptx = await toPptx(pres);
    assert.equal(getSlides(await loadPresentation(pptx)).length, 5);
    const png = slidePng(pres, 1, 320);
    assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    const pdf = Buffer.from(toPdf(pres, "16:9", 320));
    assert.equal(pdf.subarray(0, 8).toString("latin1"), "%PDF-1.4");
    assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length, 5);
    assert.match(pdf.toString("latin1"), /\/MediaBox \[0 0 720\.00 405\.00\]/);
    assert.match(pdf.subarray(-40).toString("latin1"), /%%EOF\n$/);
  });
});

describe("presentations: the HTML slides", () => {
  const stage = (): StageTemplate => ({
    slug: "default",
    name: "Default",
    size: "16:9",
    fonts: DEFAULT_TEMPLATE.fonts,
    colors: templateColors(DEFAULT_TEMPLATE),
    layouts: DEFAULT_TEMPLATE.layouts,
    default: "content",
    css: DEFAULT_CSS,
    snippets: DEFAULT_TEMPLATE.snippets,
  });
  const asset = (src: string) => `/files/${src}`;

  it("draws every slot kind as HTML in its box, pictures through the caller's URL, charts as SVG", () => {
    const deck = parseDeck(DECK);
    const two = slideView(deck.slides[1], stage(), { asset });
    assert.equal(two.layout, "two-column");
    assert.deepEqual([two.width, two.height], [1600, 900]);
    const left = two.slots.find((s) => s.name === "left")!;
    assert.deepEqual([left.x, left.y, left.w, left.h], [0.44, 1.32, 4.46, 3.95]);
    assert.match(left.html, /<ul>\n<li>One API for <strong>every<\/strong> channel<\/li>/);
    assert.match(left.html, /<a href="https:\/\/netnode.ch">Docs<\/a>/);
    const right = two.slots.find((s) => s.name === "right")!;
    assert.match(right.html, /<img src="\/files\/assets\/arch.png" data-src="assets\/arch.png" alt="Architecture">/);
    const chart = slideView(deck.slides[2], stage(), { asset }).slots.find((s) => s.name === "chart")!;
    assert.match(chart.html, /^<svg [^>]*viewBox="0 0 1427.2 536"/);
    assert.equal((chart.html.match(/<rect /g) ?? []).length, 2, "one bar per value, one series: no legend");
    const table = slideView(deck.slides[3], stage(), { asset }).slots.find((s) => s.name === "table")!;
    assert.match(table.html, /<table>[\s\S]*<th>Item<\/th>[\s\S]*<strong>120<\/strong>/);
    const style = slotStyle(left, stage());
    assert.deepEqual(style, { left: "70.4px", top: "211.2px", width: "713.6px", height: "632px", "font-size": "31.11px", color: "#161310" });
  });

  it("an html slot keeps its markup, an embed is a URL or a page; empty slots have no HTML; what the layout lacks is a problem", () => {
    const slide = { layout: "content", extra: { slots: { piece: { kind: "html", x: 1, y: 1, w: 4, h: 2 }, live: { kind: "embed", x: 5, y: 1, w: 4, h: 2 }, page: { kind: "embed", x: 5, y: 3, w: 4, h: 2 } } }, content: '# T\n\n::piece::\n<div class="cards"><div class="card">A</div></div>\n\n::live::\nhttps://example.com/x\n\n::page::\n<!doctype html><script>1</script>\n\n::ghost::\nx' };
    const v = slideView(slide, stage(), { asset });
    const by = (n: string) => v.slots.find((s) => s.name === n)!;
    assert.equal(by("piece").html, '<div class="cards"><div class="card">A</div></div>');
    assert.deepEqual(by("live").embed, { src: "https://example.com/x" });
    assert.deepEqual(by("page").embed, { srcdoc: "<!doctype html><script>1</script>" });
    assert.equal(by("body").html, "");
    assert.equal(by("body").md, undefined);
    assert.deepEqual(v.problems, ['layout has no slot "ghost"']);
    const bad = slideView({ layout: "chart", extra: {}, content: "# C\n\n::chart::\n```chart\nkind: radar\n```" }, stage(), { asset }).slots.find((s) => s.name === "chart")!;
    assert.match(bad.error ?? "", /chart kind "radar" is not one of/);
  });

  it("a picture a slot's own HTML names goes through the caller's URL, in an html slot and in markdown alike; what is already a URL stays", () => {
    const markup = '<figure style="background: url(assets/bg.jpg)"><img src="assets/shot.png" alt="Shot"><img src="https://netnode.ch/x.png"><img src="/api/y.png"></figure>';
    const slide = { layout: "content", extra: { slots: { piece: { kind: "html", x: 1, y: 1, w: 4, h: 2 } } }, content: `# T\n\n::piece::\n${markup}\n\n::body::\n${markup}` };
    const v = slideView(slide, stage(), { asset });
    for (const name of ["piece", "body"]) {
      const html = v.slots.find((s) => s.name === name)!.html;
      assert.match(html, /url\(\/files\/assets\/bg\.jpg\)/, name);
      assert.match(html, /src="\/files\/assets\/shot\.png"/, name);
      assert.match(html, /src="https:\/\/netnode\.ch\/x\.png"/, name);
      assert.match(html, /src="\/api\/y\.png"/, name);
    }
  });

  it("scopes the theme to its slides: :root, html and body mean the slide; fonts and keyframes stay at the top; the deck's CSS comes last", () => {
    const css = stageCss({ ...stage(), slug: "brand", css: '@font-face { font-family: "X"; src: url("a.woff"); }\n:root { --ink: red; }\nbody, .card { color: var(--ink); }\n@keyframes pop { from { opacity: 0 } to { opacity: 1 } }\n@media (min-width: 1px) { html .x { color: blue; } }' }, ".slot-title { letter-spacing: -1px; }");
    assert.match(css, /^@font-face \{ font-family: "X"; src: url\("a.woff"\); \}\n@keyframes pop/);
    assert.match(css, /\.deck-theme-brand \{ [^}]*--c-accent: #0284C7;[^}]*--font-heading: "Helvetica Neue", system-ui/);
    assert.match(css, /\.deck-theme-brand \{\n& \{ --ink: red; \}\n&, \.card \{ color: var\(--ink\); \}\n@media \(min-width: 1px\) \{ & \.x \{ color: blue; \} \}\n\}/);
    assert.match(css, /\.deck-theme-brand\.deck-slide \{\n\.slot-title \{ letter-spacing: -1px; \}\n\}$/);
  });

  it("one slide as an HTML string and the deck as a file that stands alone", () => {
    const deck = parseDeck(DECK);
    const html = slideHtml(slideView(deck.slides[0], stage(), { asset }), stage());
    assert.match(html, /^<section class="deck-slide deck-theme-default layout-title" data-transition="fade" style="width:1600px;height:900px;background:#F9F9F7">/);
    assert.match(html, /<div class="deck-slot kind-text slot-title statement" data-slot="title" data-valign="top" style="left: 70.4px; top: 312px;/);
    const page = standaloneHtml({ title: "T", slides: deck.slides, css: ".x{}" }, stage(), { asset });
    assert.equal((page.match(/<section class="deck-slide/g) ?? []).length, 5);
    assert.match(page, /@page \{ size: 1600px 900px; margin: 0; \}/);
    assert.match(page, /addEventListener\("keydown"/);
  });

  it("charts: every kind draws, bad data says what is wrong", () => {
    const look = { palette: ["#111111", "#222222"], text: "#000", muted: "#666", line: "#ddd", fontSize: 20 };
    for (const kind of ["column", "bar", "line", "area", "pie", "doughnut"]) {
      const svg = chartSvg(parseChart(`kind: ${kind}\ncategories: [a, b]\nseries:\n  - name: s\n    values: [1, 3]\n  - name: t\n    values: [2, 2]`), 800, 400, look);
      assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 800 400"/, kind);
      assert.ok(svg.includes("#111111"), kind);
    }
    assert.throws(() => parseChart("kind: column\ncategories: [a]\nseries:\n  - values: [1, 2]"), /series 1: values must be 1 numbers/);
    assert.throws(() => parseChart("```chart\nkind: column\n```"), /chart needs categories/);
  });
});

describe("presentations: boxes as ChatGPT's editor sets them", () => {
  const stage = (): StageTemplate => ({ slug: "default", name: "Default", size: "16:9", fonts: DEFAULT_TEMPLATE.fonts, colors: templateColors(DEFAULT_TEMPLATE), layouts: DEFAULT_TEMPLATE.layouts, default: "content", css: DEFAULT_CSS, snippets: [] });
  const asset = (src: string) => `/files/${src}`;

  it("rotation, corners, border, shadow, opacity, layer, underline and strike become the box's CSS; bad values are named", () => {
    const slide = { layout: "content", extra: { slots: { title: { rotate: -8, radius: 6, border: 2, borderColor: "accent", shadow: true, opacity: 0.5, z: 7, underline: true, strike: true, font: "Georgia" }, body: { rotate: "a lot" } } }, content: "# T\n\nbody" };
    const v = slideView(slide, stage(), { asset });
    const title = v.slots.find((s) => s.name === "title")!;
    const css = slotStyle(title, stage());
    assert.equal(css.transform, "rotate(-8deg)");
    assert.equal(css["border-radius"], "13.33px");
    assert.equal(css.border, "4.44px solid #0284C7");
    assert.equal(css["box-shadow"], "0 10px 30px rgb(0 0 0 / 0.18)");
    assert.equal(css.opacity, "0.5");
    assert.equal(css["z-index"], "7");
    assert.equal(css["text-decoration"], "underline line-through");
    assert.equal(css["font-family"], '"Georgia", var(--font-body)');
    assert.deepEqual(v.problems, ['slots.body: rotate: "a lot" is not valid']);
  });

  it("a picture as the slide's background covers it; a hidden slide is marked and left out of the file; slides carry their numbers", () => {
    const pic = slideView({ layout: "content", background: "assets/hero.jpg", extra: {}, content: "# T" }, stage(), { asset });
    assert.equal(pic.background, 'url("/files/assets/hero.jpg") center / cover no-repeat');
    const hidden = slideView({ layout: "content", extra: { hidden: true }, content: "# Gone" }, stage(), { asset });
    assert.equal(hidden.hidden, true);
    const page = standaloneHtml({ title: "T", slides: [{ layout: "content", extra: {}, content: "# One" }, { layout: "content", extra: { hidden: true }, content: "# Gone" }, { layout: "content", extra: {}, content: "# Two" }] }, stage(), { asset });
    assert.equal((page.match(/<section class="deck-slide/g) ?? []).length, 2);
    assert.doesNotMatch(page, /Gone/);
    assert.match(page, /data-n="2" data-nn="02" data-of="2"/);
  });

  it("PowerPoint: a hidden slide stays in the file hidden; rotation and border carry over", async () => {
    const deck = parseDeck("---\ntitle: T\nslots:\n  title: { rotate: 15, border: 2 }\n---\n# Turned\n\n---\nhidden: true\n---\n# Hidden\n");
    assert.deepEqual(deck.slides[1].extra, { hidden: true });
    const { pres } = await renderDeck(deck, DEFAULT_TEMPLATE, { read: async () => null });
    const [one, two] = getSlides(pres);
    assert.equal(isSlideHidden(two), true);
    assert.equal(isSlideHidden(one), false);
    const title = getSlideShapes(one).find((s) => getShapeName(s) === "title")!;
    assert.equal(getShapeRotation(title), 15);
  });
});

describe("presentations: slide transitions", () => {
  const stage = (): StageTemplate => ({ slug: "default", name: "Default", size: "16:9", fonts: DEFAULT_TEMPLATE.fonts, colors: templateColors(DEFAULT_TEMPLATE), layouts: DEFAULT_TEMPLATE.layouts, default: "content", css: DEFAULT_CSS, snippets: [] });
  const asset = (src: string) => `/files/${src}`;
  it("fade by default; slide, zoom and none mark the slide for present mode and the HTML file; an unknown one fades with a warning; PowerPoint gets push, zoom, fade", async () => {
    const deck = parseDeck("---\ntitle: T\n---\n# Plain\n\n---\ntransition: slide\n---\n# Slides in\n\n---\ntransition: zoom\n---\n# Zooms\n\n---\ntransition: none\n---\n# Cut\n\n---\ntransition: spin\n---\n# Unknown\n");
    const views = deck.slides.map((x) => slideView(x, stage(), { asset }));
    assert.deepEqual(views.map((v) => v.transition), ["fade", "slide", "zoom", "none", "fade"]);
    assert.match(views[4].problems.join(), /transition "spin" is not one of fade, slide, zoom, none/);
    const page = standaloneHtml(deck, stage(), { asset });
    assert.match(page, /data-transition="slide"/);
    assert.match(page, /\[data-transition="zoom"\] \{ animation: deck-in-zoom/);
    assert.match(page, /prefers-reduced-motion/);
    const { pres } = await renderDeck(deck, DEFAULT_TEMPLATE, { read: async () => null });
    assert.deepEqual(getSlides(pres).map((x) => getSlideTransition(x)?.effect ?? null), [null, "push", "zoom", null, null]);
  });
});

describe("presentations: slide numbers", () => {
  const stage = (): StageTemplate => ({ slug: "default", name: "Default", size: "16:9", fonts: DEFAULT_TEMPLATE.fonts, colors: templateColors(DEFAULT_TEMPLATE), layouts: DEFAULT_TEMPLATE.layouts, default: "content", css: DEFAULT_CSS, snippets: [] });
  const asset = (src: string) => `/files/${src}`;
  const SRC = "---\ntitle: T\nlayout: title\n---\n# Title\n\n---\nlayout: content\n---\n# Two\n\nbody\n\n---\nlayout: content\nnumber: false\n---\n# Three\n\nbody\n\n---\nlayout: content\n---\n# Four\n\nbody\n";
  const numberFields = (pres: Awaited<ReturnType<typeof renderDeck>>["pres"]) => getSlides(pres).map((x) => getSlideShapes(x).filter((sh) => getShapeName(sh) === "Slide number").map((sh) => getShapeText(sh)));

  it("on by default (the theme draws them, not on the title slide); a slide's `number: false` drops its own; PowerPoint gets a slide-number field", async () => {
    const deck = parseDeck(SRC);
    assert.equal(deck.numbers, undefined);
    assert.equal(deck.slides[2].extra.number, false);
    assert.deepEqual(parseDeck(serializeDeck(deck)), deck);
    const views = deck.slides.map((x) => slideView(x, stage(), { asset }));
    assert.deepEqual(views.map((v) => v.numbered), [true, true, false, true]);
    const page = standaloneHtml(deck, stage(), { asset });
    assert.deepEqual([...page.matchAll(/data-nn="(\d+)"/g)].map((m) => m[1]), ["01", "02", "04"]);
    assert.match(DEFAULT_CSS, /\[data-nn\]:not\(\.layout-title\):not\(\.layout-section\)::after \{ content: attr\(data-nn\)/);
    const { pres } = await renderDeck(deck, DEFAULT_TEMPLATE, { read: async () => null });
    assert.deepEqual(numberFields(pres), [[], ["02"], [], ["04"]]);
  });

  it("`numbers: false` in the headmatter turns them off everywhere: HTML, present mode's views and PowerPoint", async () => {
    const deck = parseDeck(SRC.replace("title: T\n", "title: T\nnumbers: false\n"));
    assert.equal(deck.numbers, false);
    assert.deepEqual(deck.meta, {});
    assert.match(serializeDeck(deck), /^numbers: false$/m);
    assert.deepEqual(parseDeck(serializeDeck(deck)), deck);
    assert.ok(deck.slides.every((x) => !slideView(x, stage(), { asset, numbers: false }).numbered));
    assert.doesNotMatch(standaloneHtml(deck, stage(), { asset }), /data-nn=/);
    const { pres } = await renderDeck(deck, DEFAULT_TEMPLATE, { read: async () => null });
    assert.deepEqual(numberFields(pres), [[], [], [], []]);
  });
});

describe("presentations: two editors on one deck", () => {
  const s = (content: string) => ({ extra: {}, content });
  const base = { title: "T", template: "default", css: "", slides: [s("# A"), s("# B"), s("# C")] };
  it("keeps both sides' changes slide by slide; a slide changed on both sides keeps theirs and is reported", () => {
    const mine = { ...base, title: "Mine", slides: [s("# A mine"), s("# B"), s("# C mine")] };
    const theirs = { ...base, slides: [s("# A"), s("# B theirs"), s("# C theirs"), s("# D")] };
    const { draft, lost } = mergeDrafts(base, mine, theirs);
    assert.equal(draft.title, "Mine");
    assert.deepEqual(draft.slides.map((x) => x.content), ["# A mine", "# B theirs", "# C theirs", "# D"]);
    assert.deepEqual(lost, [3]);
  });
  it("one side unchanged: the other side wins whole; slides added here while theirs changed gives way to theirs", () => {
    assert.deepEqual(mergeDrafts(base, base, { ...base, css: "x" }).draft.css, "x");
    const added = { ...base, slides: [...base.slides, s("# New")] };
    assert.deepEqual(mergeDrafts(base, added, base).draft.slides.length, 4);
    const r = mergeDrafts(base, added, { ...base, slides: [s("# A2"), s("# B"), s("# C")] });
    assert.deepEqual(r.draft.slides.map((x) => x.content), ["# A2", "# B", "# C"]);
    assert.deepEqual(r.lost, [1, 2, 3, 4]);
  });
});

describe("presentations: the chart data grid writes the block back", () => {
  it("round-trips kind, title, categories and series, quoting what YAML would misread, keeping the fence", () => {
    const c = { kind: "line" as const, title: "Pages: per week", categories: ["Week 1", "2026", "yes", "Q3 [est]"], series: [{ name: "Done", values: [8, 12.5, 0, -3] }, { name: "Plan, revised", values: [10, 10, 10, 10] }] };
    const src = chartSource(c, true);
    assert.match(src, /^```chart\nkind: line\ntitle: "Pages: per week"\ncategories: \[Week 1, "2026", "yes", "Q3 \[est\]"\]\nseries:\n  - name: Done\n    values: \[8, 12.5, 0, -3\]\n/);
    assert.ok(src.endsWith("\n```"));
    assert.deepEqual(parseChart(src), c);
    assert.deepEqual(parseChart(chartSource(c, false)), c);
  });
});
