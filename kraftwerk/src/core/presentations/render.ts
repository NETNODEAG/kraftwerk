import * as ok from "@office-kit/pptx";
import { parse } from "yaml";
import { chartPalette } from "./chart.js";
import { type DeckDoc, type SlideDef } from "./deck.js";
import { DEFAULT_SLOT, slotsOf, splitDefault } from "./slots.js";
import { inlineRuns, parseMarkdown, plain, type Block, type Run } from "./markdown.js";
import { CANVAS, PPI, defaultSlotOf, layoutFor, slideSlots, resolveColor, resolveFont, type LayoutDef, type SlotDef, type Template } from "./template.js";

/**
 * Deck + template → the PowerPoint model (@office-kit/pptx). Every slide
 * picks a layout; every slot of the layout is drawn from the slide's
 * markdown for it: a text box with paragraphs, a picture, a native chart
 * or a table. Nothing is guessed: content a slot cannot show is reported
 * as a warning with the slide and slot, so the editor and `presentations
 * check` can point at it.
 */

export interface RenderWarning {
  /** 1-based slide number. */
  slide: number;
  slot?: string;
  level: "error" | "warning";
  message: string;
}

export interface AssetReader {
  /** The bytes of a file referenced from a slide (`assets/arch.png`), null when it does not exist. */
  read(src: string): Promise<Uint8Array | null>;
}

export interface RenderOptions {
  /** Pictures of the slots a PowerPoint shape cannot carry (HTML, embeds), keyed "<slide>:<slot>" (1-based slide), as the browser drew them. */
  images?: Map<string, Uint8Array>;
}

/** A slot whose markdown carries raw HTML: PowerPoint gets it as a picture when there is one. */
export const hasHtml = (md: string): boolean => /<(div|span|section|svg|table|img|figure|ol|ul|p|h[1-6]|br|strong|em|a)\b[^>]*>/i.test(md);

export interface Rendered {
  pres: ok.PresentationData;
  warnings: RenderWarning[];
}

type ChartSpec = Parameters<typeof ok.addSlideChart>[1]["spec"];
type Color = Parameters<typeof ok.setSlideBackground>[1];
/** resolveColor gives #RRGGBB, which is a Color; the type is branded, so one cast here. */
const col = (hex: string): Color => hex as Color;
const CHART_KINDS = ["column", "bar", "line", "pie", "doughnut", "area"] as const;

export async function renderDeck(deck: DeckDoc, template: Template, assets: AssetReader, options: RenderOptions = {}): Promise<Rendered> {
  const size = deck.size ?? template.size;
  const pres = ok.createPresentation({ size });
  // office-kit's 16:9 is 13.333in wide; kraftwerk lays out on a 10in canvas (the HTML stage), so the PPTX gets that size.
  ok.setSlideSize(pres, { width: ok.inches(CANVAS[size].w), height: ok.inches(CANVAS[size].h), type: size === "16:9" ? "screen16x9" : "screen4x3" });
  ok.setPresentationFonts(pres, { majorLatin: template.fonts.heading, minorLatin: template.fonts.body });
  const warnings: RenderWarning[] = [];
  const slides = deck.slides.length ? deck.slides : [{ extra: {}, content: "" }];
  for (const [i, slide] of slides.entries()) {
    const n = i + 1;
    const warn = (message: string, slot?: string, level: "error" | "warning" = "warning") => warnings.push({ slide: n, ...(slot ? { slot } : {}), level, message });
    const s = ok.addBlankSlide(pres);
    // An unknown layout falls back to the template's default, with a warning naming both.
    const found = layoutFor(template, slide.layout) ?? layoutFor(template, undefined);
    if (!found) {
      warn(`template "${template.slug}" has no layouts`, undefined, "error");
      continue;
    }
    if (slide.layout && found.name !== slide.layout) warn(`unknown layout "${slide.layout}", using "${found.name}"`, undefined, "error");
    // The slide's own slot changes and additions (`slots:` in its head) on top of the layout's; the default slot stays the layout's.
    const own = slideSlots(found.layout, slide.extra.slots);
    for (const problem of own.problems) warn(problem, undefined, "error");
    const dflt = defaultSlotOf(found.layout);
    const layout: LayoutDef = { ...found.layout, slots: own.slots, ...(dflt ? { default: dflt } : {}) };
    if (slide.extra?.hidden === true) ok.setSlideHidden(s, true);
    // A transition set on the slide carries over: fade, slide (PowerPoint's push), zoom; none is a cut.
    if (slide.transition === "fade" || slide.transition === "slide" || slide.transition === "zoom") ok.setSlideTransition(s, { effect: slide.transition === "slide" ? "push" : slide.transition, speed: "med" });
    const bgPicture = slide.background && /\.(png|jpe?g|gif)$/i.test(slide.background.trim()) ? slide.background.trim() : null;
    const background = resolveColor(template, bgPicture ? (layout.background ?? "background") : (slide.background ?? layout.background ?? "background"));
    if (slide.background && !bgPicture && !/\.(webp|svg|avif)$/i.test(slide.background) && !resolveColor(template, slide.background)) warn(`unknown background color "${slide.background}"`);
    if (background) ok.setSlideBackground(s, col(background));
    if (bgPicture) {
      const bytes = await assets.read(bgPicture);
      if (bytes) ok.setSlideBackgroundImage(s, bytes);
      else warn(`background picture not found: ${bgPicture}`);
    }
    drawShapes(s, template, layout, size);
    const content = contentOf(slide, layout, warn);
    for (const [name, slot] of Object.entries(layout.slots)) {
      const md = content[name];
      if (md === undefined || md.trim() === "") {
        if (slot.required) warn(`slot "${name}" is empty (${slot.kind}${slot.placeholder ? `, e.g. ${slot.placeholder.split("\n")[0]}` : ""})`, name);
        continue;
      }
      const picture = options.images?.get(`${n}:${name}`);
      if (picture && (slot.kind === "html" || slot.kind === "embed" || hasHtml(md))) {
        const b = clamp(slot, size);
        ok.addSlideImage(s, picture, { x: ok.inches(b.x), y: ok.inches(b.y), w: ok.inches(b.w), h: ok.inches(b.h), fit: "contain", name });
        continue;
      }
      if (slot.kind === "html" || slot.kind === "embed") {
        const b = clamp(slot, size);
        const ph = ok.addSlideShape(s, { preset: "rect", name, x: ok.inches(b.x), y: ok.inches(b.y), w: ok.inches(b.w), h: ok.inches(b.h), text: slot.kind === "embed" ? "Live content: open the deck as HTML" : "HTML element: export with a browser to see it here", textAnchor: "ctr" });
        ok.setShapeFill(ph, col(resolveColor(template, "surface") ?? "#F3F4F6"));
        ok.setShapeTextFormat(ph, { size: 11, color: col(resolveColor(template, "muted") ?? "#6B6B70") });
        continue;
      }
      try {
        await drawSlot(s, template, name, slot, md, assets, (m, level) => warn(m, name, level));
        // What the slide's own box settings carry over: rotation and a border.
        for (const sh of ok.getSlideShapes(s)) {
          if (ok.getShapeName(sh) !== name) continue;
          if (slot.rotate) ok.setShapeRotation(sh, slot.rotate);
          if (slot.border) ok.setShapeStroke(sh, { color: col(resolveColor(template, slot.borderColor ?? "text") ?? "#000000"), widthEmu: ok.pt(slot.border) });
        }
      } catch (err) {
        warn(`could not draw: ${(err as Error).message}`, name, "error");
      }
    }
    if (deck.numbers !== false && slide.extra.number !== false && !NO_NUMBER_LAYOUTS.has(found.name)) drawNumber(s, template, size, n);
    if (slide.notes?.trim()) ok.setSlideNotes(s, slide.notes.trim());
  }
  return { pres, warnings };
}

/** The slide's content by slot name: named `::slot::` blocks, plus the unmarked content split into title and the default slot. */
function contentOf(slide: SlideDef, layout: LayoutDef, warn: (m: string, slot?: string, level?: "error" | "warning") => void): Record<string, string> {
  const slots = slotsOf(slide.content);
  const out: Record<string, string> = {};
  for (const [name, text] of Object.entries(slots)) {
    if (name === DEFAULT_SLOT) continue;
    if (!layout.slots[name]) warn(`layout has no slot "${name}" (it has: ${Object.keys(layout.slots).join(", ")})`, name, "error");
    else out[name] = text;
  }
  const dflt = slots[DEFAULT_SLOT];
  if (dflt?.trim()) {
    const { heading, rest } = splitDefault(dflt);
    if (heading && layout.slots.title && out.title === undefined) out.title = heading;
    const leftover = heading && layout.slots.title && out.title === heading ? rest : dflt;
    if (leftover.trim()) {
      const target = defaultSlotOf(layout);
      if (target && out[target] === undefined) out[target] = leftover;
      else if (target) out[target] = `${out[target]}\n\n${leftover}`;
      else warn(`unmarked content has no slot to go to (mark it ::name:: with one of: ${Object.keys(layout.slots).join(", ")})`, undefined, "error");
    }
  }
  return out;
}

/** Where the built-in theme leaves the number off (theme.css: `:not(.layout-title):not(.layout-section)`). */
const NO_NUMBER_LAYOUTS = new Set(["title", "section"]);

/** The slide number bottom right, where the theme draws it (72px from the right, 30px up, 18px), as a field PowerPoint and Keynote keep counting. */
function drawNumber(s: ok.SlideData, template: Template, size: "16:9" | "4:3", n: number): void {
  const c = CANVAS[size];
  const w = 1;
  const h = 0.3;
  const box = ok.addSlideTextBox(s, { name: "Slide number", x: ok.inches(c.w - 72 / PPI - w), y: ok.inches(c.h - 30 / PPI - h), w: ok.inches(w), h: ok.inches(h), text: String(n).padStart(2, "0") });
  ok.setShapeTextFormat(box, { size: Math.round(((18 / PPI) * 72) * 10) / 10, color: col(resolveColor(template, "muted") ?? "#6F6D67"), font: resolveFont(template, undefined) });
  ok.setParagraphAlignment(box, 0, "right");
  ok.setShapeTextAnchor(box, "bottom");
  ok.setShapeTextField(box, "slidenum", { text: String(n).padStart(2, "0") });
}

function drawShapes(s: ok.SlideData, template: Template, layout: LayoutDef, size: "16:9" | "4:3"): void {
  for (const shape of layout.shapes) {
    const box = clamp(shape, size, 1 / PPI);
    if (shape.kind === "line") {
      ok.addSlideLine(s, { name: "Decoration", from: { x: ok.inches(box.x), y: ok.inches(box.y) }, to: { x: ok.inches(box.x + box.w), y: ok.inches(box.y + box.h) }, color: col(resolveColor(template, shape.color ?? shape.fill ?? "line") ?? "#D1D5DB"), widthEmu: ok.pt(shape.width ?? 1) });
      continue;
    }
    const r = ok.addSlideShape(s, { preset: "rect", name: "Decoration", x: ok.inches(box.x), y: ok.inches(box.y), w: ok.inches(box.w), h: ok.inches(box.h) });
    const fill = resolveColor(template, shape.fill ?? "accent");
    if (fill) ok.setShapeFill(r, col(fill));
    if (shape.color) ok.setShapeStroke(r, { color: col(resolveColor(template, shape.color) ?? "#000000"), widthEmu: ok.pt(shape.width ?? 1) });
    else ok.setShapeNoStroke(r);
  }
}

async function drawSlot(s: ok.SlideData, template: Template, name: string, slot: SlotDef, md: string, assets: AssetReader, warn: (m: string, level?: "error" | "warning") => void): Promise<void> {
  const box = clamp(slot, template.size);
  const blocks = parseMarkdown(md);
  const geometry = { x: ok.inches(box.x), y: ok.inches(box.y), w: ok.inches(box.w), h: ok.inches(box.h), name };
  switch (slot.kind) {
    case "image": {
      const img = blocks.find((b) => b.kind === "image");
      const src = img?.kind === "image" ? img.src : blocks.length === 1 && blocks[0].kind === "paragraph" ? plain(blocks[0].runs).trim() : "";
      if (!src) return warn(`expects a picture: ![caption](assets/file.png)`, "error");
      const bytes = await assets.read(src);
      if (!bytes) {
        const ph = ok.addSlideShape(s, { preset: "rect", ...geometry, text: `missing image: ${src}`, textAnchor: "ctr" });
        ok.setShapeFill(ph, col(resolveColor(template, "surface") ?? "#F3F4F6"));
        ok.setShapeTextFormat(ph, { size: 12, color: col(resolveColor(template, "muted") ?? "#6B6B70") });
        return warn(`image not found: ${src}`, "error");
      }
      ok.addSlideImage(s, bytes, { ...geometry, fit: "contain" });
      return;
    }
    case "chart": {
      const chart = blocks.find((b) => b.kind === "chart");
      if (chart?.kind !== "chart") return warn("expects a ```chart block (kind, categories, series)", "error");
      const spec = chartSpec(chart.source, chartPalette(resolveColor(template, "accent") ?? undefined));
      ok.addSlideChart(s, { ...geometry, spec });
      return;
    }
    case "table": {
      const table = blocks.find((b) => b.kind === "table");
      if (table?.kind !== "table") return warn("expects a markdown table", "error");
      drawTable(s, template, slot, geometry, table.rows);
      return;
    }
    case "text":
    case "markdown": {
      // One picture, table or chart alone in a markdown slot is drawn as such; mixed with text it is dropped with a warning.
      if (slot.kind === "markdown" && blocks.length === 1 && (blocks[0].kind === "image" || blocks[0].kind === "table" || blocks[0].kind === "chart")) {
        return drawSlot(s, template, name, { ...slot, kind: blocks[0].kind }, md, assets, warn);
      }
      const dropped = blocks.filter((b) => b.kind === "image" || b.kind === "table" || b.kind === "chart");
      for (const d of dropped) warn(`${d.kind} dropped: a ${slot.kind} slot shows text only (put it in its own slot or slide)`);
      const paragraphs = slot.kind === "text" ? [{ runs: inlineRuns(md), level: 0, bullet: "none" as const }] : paragraphsOf(blocks);
      drawText(s, template, slot, geometry, paragraphs);
      return;
    }
  }
}

interface Para {
  runs: Run[];
  level: number;
  bullet: "none" | "bullet" | "number";
  heading?: boolean;
  code?: boolean;
}

function paragraphsOf(blocks: Block[]): Para[] {
  const out: Para[] = [];
  for (const b of blocks) {
    if (b.kind === "heading") out.push({ runs: b.runs, level: 0, bullet: "none", heading: true });
    else if (b.kind === "paragraph") out.push({ runs: b.runs, level: 0, bullet: "none" });
    else if (b.kind === "list") for (const item of b.items) out.push({ runs: item.runs, level: item.level, bullet: item.ordered ? "number" : "bullet" });
    else if (b.kind === "code") for (const line of b.text.split("\n")) out.push({ runs: [{ text: line || " ", code: true }], level: 0, bullet: "none", code: true });
  }
  return out;
}

function drawText(s: ok.SlideData, template: Template, slot: SlotDef, geometry: { x: ok.Emu; y: ok.Emu; w: ok.Emu; h: ok.Emu }, paragraphs: Para[]): void {
  const shape = ok.addSlideTextBox(s, { ...geometry, text: "" });
  const size = slot.size ?? 18;
  const color = col(resolveColor(template, slot.color ?? "text") ?? "#1B1B1F");
  const font = resolveFont(template, slot.font);
  const accent = col(resolveColor(template, "accent") ?? "#1D4ED8");
  const specs = paragraphs.map((p) => ({
    ...(slot.align ? { align: slot.align } : {}),
    runs: (p.runs.length ? p.runs : [{ text: " " }]).map((r) => ({
      text: r.text,
      format: {
        size: p.heading ? size * 1.15 : p.code ? Math.max(8, size * 0.8) : size,
        bold: !!(slot.bold || r.bold || p.heading),
        italic: !!(slot.italic || r.italic),
        // Inline code keeps the body font: the preview renderer loses a wrapped line that mixes font families
        // (office-kit pptx-preview 0.21), so code is told apart by colour only; a code block is one family throughout.
        color: r.href || r.code ? accent : color,
        font: p.code ? "Courier New" : font,
        ...(r.href ? { underline: true } : {}),
      },
    })),
    endFormat: { size },
  }));
  ok.setShapeParagraphs(shape, specs);
  paragraphs.forEach((p, i) => {
    if (p.bullet !== "none") {
      ok.setParagraphBullet(shape, i, p.bullet);
      if (p.level > 0) ok.setParagraphLevel(shape, i, p.level);
    }
    if (i > 0 && p.bullet === "none") ok.setParagraphSpacing(shape, i, { beforePts: size * 0.5 });
  });
  ok.setShapeTextAnchor(shape, slot.valign === "middle" ? "center" : slot.valign === "bottom" ? "bottom" : "top");
  // No autofit: the preview renderer shrinks and shifts autofit text even when it fits, and the editor types at the size the slot says.
  if (slot.fill) {
    const fill = resolveColor(template, slot.fill);
    if (fill) ok.setShapeFill(shape, col(fill));
  }
}

function drawTable(s: ok.SlideData, template: Template, slot: SlotDef, geometry: { x: ok.Emu; y: ok.Emu; w: ok.Emu; h: ok.Emu }, rows: Run[][][]): void {
  const cols = Math.max(...rows.map((r) => r.length));
  const plainRows = rows.map((r) => Array.from({ length: cols }, (_, c) => plain(r[c] ?? [])));
  const rowH = Math.min(0.45, (geometry.h as number) / ok.inches(1) / Math.max(rows.length, 1));
  const table = ok.addSlideTable(s, { ...geometry, h: ok.inches(rowH * rows.length), rows: plainRows, firstRow: true, bandRow: true });
  const size = slot.size ?? 14;
  const color = col(resolveColor(template, slot.color ?? "text") ?? "#1B1B1F");
  const font = resolveFont(template, slot.font);
  ok.getTableCells(table).forEach((cells, r) =>
    cells.forEach((cell, c) => {
      const runs = rows[r]?.[c] ?? [];
      if (runs.some((x) => x.bold || x.italic || x.code || x.href)) {
        ok.setTableCellParagraphs(cell, [{ runs: runs.map((x) => ({ text: x.text, format: { size, bold: !!x.bold || r === 0, italic: !!x.italic, font: x.code ? "Courier New" : font, color } })) }]);
      } else ok.setTableCellTextFormat(cell, { size, font, bold: r === 0, color });
    }),
  );
}

function chartSpec(source: string, palette: string[]): ChartSpec {
  const data = parse(source) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") throw new Error("chart block must be a YAML mapping (kind, categories, series)");
  const kind = String(data.kind ?? "column");
  if (!CHART_KINDS.includes(kind as never)) throw new Error(`chart kind "${kind}" is not one of ${CHART_KINDS.join(", ")}`);
  const categories = Array.isArray(data.categories) ? data.categories.map(String) : [];
  if (!categories.length) throw new Error("chart needs categories: [a, b, …]");
  const seriesIn = Array.isArray(data.series) ? data.series : [];
  if (!seriesIn.length) throw new Error("chart needs series: [{name, values}]");
  const series = seriesIn.map((x, i) => {
    const row = (x ?? {}) as Record<string, unknown>;
    const values = Array.isArray(row.values) ? row.values.map(Number) : [];
    if (values.length !== categories.length || values.some((v) => Number.isNaN(v))) throw new Error(`series ${i + 1}: values must be ${categories.length} numbers`);
    // Pie and doughnut color their slices from the theme; a series color would paint every slice the same.
    const color = kind === "pie" || kind === "doughnut" ? undefined : palette[i % palette.length];
    return { name: String(row.name ?? `Series ${i + 1}`), values, ...(color ? { color } : {}) };
  });
  const spec: Record<string, unknown> = { kind, categories, series };
  if (typeof data.title === "string" && data.title.trim()) spec.title = data.title.trim();
  return spec as unknown as ChartSpec;
}

/** Keep a box on the canvas: a template that overshoots is drawn at the edge, not off it. */
function clamp(box: { x: number; y: number; w: number; h: number }, size: "16:9" | "4:3", min = 0.1): { x: number; y: number; w: number; h: number } {
  const c = CANVAS[size];
  const x = Math.min(Math.max(0, box.x), c.w - min);
  const y = Math.min(Math.max(0, box.y), c.h - min);
  return { x, y, w: Math.max(min, Math.min(box.w, c.w - x)), h: Math.max(min, Math.min(box.h, c.h - y)) };
}
