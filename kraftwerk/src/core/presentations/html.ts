import { Marked, type Tokens } from "marked";
import { chartPalette, chartSvg, parseChart } from "./chart.js";
import { defaultSlotOf, layoutFor, PPI, resolveColor, slideSlots, STAGE_W } from "./layout.js";
import { DEFAULT_SLOT, getSlot, slotsOf, splitDefault } from "./slots.js";
import type { SlideDef } from "./deck.js";
import type { LayoutDef, SlotDef, Snippet } from "./template.js";

/**
 * The slides as HTML: what the editor shows (and edits in place), what
 * present mode and the thumbnails show, what PDF and PNG are printed
 * from and what `render --html` writes. One model per slide (`slideView`):
 * the layout's slots with the slide's own changes, each slot's HTML, its
 * box in stage pixels (1600 wide, 160 per inch) and its look; the theme
 * styles it with plain CSS (`stageCss`). Pure — the web bundles it; the
 * caller says where pictures live (`asset`).
 */

/** The template as the HTML renderer needs it: no files, no schema. */
export interface StageTemplate {
  slug: string;
  name: string;
  size: "16:9" | "4:3";
  fonts: { heading: string; body: string };
  colors: Record<string, string>;
  layouts: Record<string, LayoutDef>;
  default?: string;
  /** Theme CSS; relative URLs already point where the caller serves the template's files. */
  css: string;
  snippets: Snippet[];
}

export interface SlotView {
  name: string;
  kind: SlotDef["kind"];
  /** Box in inches (as in the files). */
  x: number;
  y: number;
  w: number;
  h: number;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  font?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  fill?: string;
  class?: string;
  underline?: boolean;
  strike?: boolean;
  rotate?: number;
  radius?: number;
  border?: number;
  borderColor?: string;
  shadow?: boolean;
  opacity?: number;
  z?: number;
  fit?: "contain" | "cover";
  required?: boolean;
  placeholder?: string;
  /** A slot of the slide's own (not the layout's). */
  own?: boolean;
  /** The slide changes the layout's slot. */
  changed?: boolean;
  /** The slot's markdown, undefined when nothing fills it. */
  md?: string;
  /** What it shows. For `embed`, empty: see `embed`. */
  html: string;
  embed?: { src?: string; srcdoc?: string };
  /** Why it could not be drawn (a broken chart block). */
  error?: string;
}

/** How a slide comes in when presented: fade (the default), slide in from the right, zoom in, or cut (none). */
export const TRANSITIONS = ["fade", "slide", "zoom", "none"] as const;
export type Transition = (typeof TRANSITIONS)[number];
export const transitionOf = (value: string | undefined): Transition => ((TRANSITIONS as readonly string[]).includes(value ?? "") ? (value as Transition) : "fade");

export interface SlideView {
  layout: string;
  transition: Transition;
  /** A color, or `url(...) center / cover` for a picture. */
  background: string;
  /** Left out of present mode and the exports. */
  hidden: boolean;
  /** Carries its slide number (the theme draws it, usually not on title and section slides): off with the deck's `numbers: false` or the slide's `number: false`. */
  numbered: boolean;
  shapes: { x: number; y: number; w: number; h: number; fill: string }[];
  slots: SlotView[];
  problems: string[];
  /** The stage in px. */
  width: number;
  height: number;
}

export interface RenderOpts {
  /** Where a slide's picture (`assets/arch.png`) is fetched from. */
  asset: (src: string) => string;
  /** The deck's `numbers`: false leaves every slide without its number. */
  numbers?: boolean;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A picture a slot's own HTML names (`src="assets/shot.png"`, `url(assets/bg.jpg)`)
 * through the caller's `asset()`, the same way a markdown image goes — so hand-written
 * HTML shows its pictures in the editor, the thumbnails and the exports alike.
 * Absolute URLs, data URLs and anything already resolved stay as they are.
 */
const htmlAssets = (html: string, asset: (src: string) => string): string =>
  html.replace(/(?<![\w-])(src=["']|url\(["']?)((?!https?:|data:|blob:|#|\/)[^"')\s]+)/g, (m, lead: string, rel: string) => lead + asset(rel));

export const stageHeight = (size: "16:9" | "4:3"): number => (size === "4:3" ? 1200 : 900);
/** A slot's font size in points as stage px. */
export const ptToPx = (pt: number): number => Math.round((pt / 72) * PPI * 100) / 100;


function markedFor(t: StageTemplate, opts: RenderOpts, slotPx: () => { w: number; h: number; size: number }): Marked {
  const m = new Marked({ gfm: true, breaks: false });
  m.use({
    renderer: {
      code(token: Tokens.Code) {
        if ((token.lang ?? "").trim().toLowerCase() === "chart") {
          try {
            const { w, h, size } = slotPx();
            return chartSvg(parseChart(token.text), w, h, look(t, size));
          } catch (err) {
            return `<p class="deck-error">chart: ${esc((err as Error).message)}</p>`;
          }
        }
        return `<pre><code>${esc(token.text)}</code></pre>`;
      },
      image(token: Tokens.Image) {
        return `<img src="${esc(opts.asset(token.href))}" data-src="${esc(token.href)}" alt="${esc(token.text ?? "")}"${token.title ? ` title="${esc(token.title)}"` : ""}>`;
      },
    },
  });
  return m;
}

const look = (t: StageTemplate, sizePt: number) => ({
  palette: chartPalette(t.colors.accent),
  text: t.colors.text ?? "#161310",
  muted: t.colors.muted ?? "#6F6D67",
  line: t.colors.line ?? "#E1E0D9",
  fontSize: ptToPx(sizePt),
});

/** Every slot of a slide with its content and look; problems name what the slide asks for and the layout cannot give. */
export function slideView(slide: SlideDef, t: StageTemplate, opts: RenderOpts): SlideView {
  const width = STAGE_W;
  const height = stageHeight(t.size);
  const problems: string[] = [];
  const found = layoutFor(t, slide.layout) ?? layoutFor(t, undefined);
  const hidden = slide.extra?.hidden === true;
  const numbered = opts.numbers !== false && slide.extra?.number !== false;
  const transition = transitionOf(slide.transition);
  if (slide.transition && transitionOf(slide.transition) !== slide.transition) problems.push(`transition "${slide.transition}" is not one of ${TRANSITIONS.join(", ")}; fading`);
  if (!found) return { layout: "", transition, background: t.colors.background ?? "#fff", hidden, numbered, shapes: [], slots: [], problems: ["the template has no layouts"], width, height };
  if (slide.layout && found.name !== slide.layout) problems.push(`unknown layout "${slide.layout}", using "${found.name}"`);
  const own = slideSlots(found.layout, slide.extra?.slots);
  problems.push(...own.problems);
  const dflt = defaultSlotOf(found.layout);
  const named = slotsOf(slide.content);
  for (const name of Object.keys(named)) if (name !== DEFAULT_SLOT && !own.slots[name]) problems.push(`layout has no slot "${name}"`);
  if (!dflt && splitDefault(named[DEFAULT_SLOT]).rest) problems.push("unmarked content has no slot to go to");

  const color = (v: string | undefined, fallback: string) => resolveColor(t, v) ?? fallback;
  // A picture as background: a path or URL (assets/hero.jpg), drawn to cover the slide.
  const bg = slide.background?.trim();
  const background = bg && /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i.test(bg) ? `url("${opts.asset(bg)}") center / cover no-repeat` : color(bg ?? found.layout.background ?? "background", "#FFFFFF");
  const shapes = (found.layout.shapes ?? []).map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, fill: color(s.fill ?? s.color ?? "accent", "#000000") }));

  const slots: SlotView[] = Object.entries(own.slots).map(([name, def]) => {
    const md = getSlot(slide.content, name, dflt);
    const d = def as SlotDef & { own?: boolean; changed?: boolean; class?: string };
    const view: SlotView = {
      name,
      kind: d.kind,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      ...(d.size ? { size: d.size } : {}),
      ...(d.bold ? { bold: true } : {}),
      ...(d.italic ? { italic: true } : {}),
      ...(d.color ? { color: d.color } : {}),
      ...(d.font ? { font: d.font } : {}),
      ...(d.align ? { align: d.align } : {}),
      ...(d.valign ? { valign: d.valign } : {}),
      ...(d.fill ? { fill: d.fill } : {}),
      ...(d.class ? { class: d.class } : {}),
      ...(d.underline ? { underline: true } : {}),
      ...(d.strike ? { strike: true } : {}),
      ...(typeof d.rotate === "number" && d.rotate ? { rotate: d.rotate } : {}),
      ...(typeof d.radius === "number" ? { radius: d.radius } : {}),
      ...(typeof d.border === "number" ? { border: d.border } : {}),
      ...(d.borderColor ? { borderColor: d.borderColor } : {}),
      ...(d.shadow ? { shadow: true } : {}),
      ...(typeof d.opacity === "number" && d.opacity < 1 ? { opacity: d.opacity } : {}),
      ...(typeof d.z === "number" ? { z: d.z } : {}),
      ...(d.fit ? { fit: d.fit } : {}),
      ...(d.required ? { required: true } : {}),
      ...(d.placeholder ? { placeholder: d.placeholder } : {}),
      ...(d.own ? { own: true } : {}),
      ...(d.changed ? { changed: true } : {}),
      ...(md !== undefined ? { md } : {}),
      html: "",
    };
    if (md === undefined || md.trim() === "") return view;
    const px = { w: d.w * PPI - 32, h: d.h * PPI - 16, size: d.size ?? 14 };
    const m = markedFor(t, opts, () => px);
    try {
      switch (d.kind) {
        case "text":
          view.html = m.parseInline(md.replace(/\s*\n\s*/g, " "), { async: false }) as string;
          break;
        case "image": {
          const img = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(md);
          const src = img ? img[2] : md.trim();
          view.html = `<img src="${esc(opts.asset(src))}" data-src="${esc(src)}" alt="${esc(img?.[1] ?? "")}">`;
          break;
        }
        case "chart":
          view.html = chartSvg(parseChart(md), px.w, px.h, look(t, px.size));
          break;
        case "html":
          view.html = htmlAssets(md, opts.asset);
          break;
        case "embed": {
          const v = md.trim();
          view.embed = /^https?:\/\/\S+$/i.test(v) ? { src: v } : { srcdoc: v };
          break;
        }
        default:
          view.html = htmlAssets(m.parse(md, { async: false }) as string, opts.asset);
      }
    } catch (err) {
      view.error = (err as Error).message;
      view.html = `<p class="deck-error">${esc(view.error)}</p>`;
    }
    return view;
  });
  return { layout: found.name, transition, background, hidden, numbered, shapes, slots, problems, width, height };
}

/** A slot's own CSS: its box in stage px and how its text looks. */
export function slotStyle(s: Pick<SlotView, "x" | "y" | "w" | "h" | "size" | "bold" | "italic" | "color" | "font" | "align" | "fill" | "underline" | "strike" | "rotate" | "radius" | "border" | "borderColor" | "shadow" | "opacity" | "z">, t: StageTemplate): Record<string, string> {
  const st: Record<string, string> = {
    left: `${px(s.x)}px`,
    top: `${px(s.y)}px`,
    width: `${px(s.w)}px`,
    height: `${px(s.h)}px`,
  };
  if (s.size) st["font-size"] = `${ptToPx(s.size)}px`;
  if (s.bold) st["font-weight"] = "700";
  if (s.italic) st["font-style"] = "italic";
  if (s.color) st.color = resolveColor(t, s.color) ?? s.color;
  if (s.font) st["font-family"] = s.font === "heading" ? "var(--font-heading)" : s.font === "body" ? "var(--font-body)" : `"${s.font}", var(--font-body)`;
  if (s.align) st["text-align"] = s.align;
  if (s.fill) st.background = resolveColor(t, s.fill) ?? s.fill;
  const deco = [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ");
  if (deco) st["text-decoration"] = deco;
  if (s.rotate) st.transform = `rotate(${s.rotate}deg)`;
  if (s.radius) st["border-radius"] = `${ptToPx(s.radius)}px`;
  if (s.border) st.border = `${ptToPx(s.border)}px solid ${resolveColor(t, s.borderColor ?? "text") ?? s.borderColor ?? "currentColor"}`;
  if (s.shadow) st["box-shadow"] = "0 10px 30px rgb(0 0 0 / 0.18)";
  if (typeof s.opacity === "number" && s.opacity < 1) st.opacity = String(s.opacity);
  if (typeof s.z === "number") st["z-index"] = String(Math.round(s.z));
  if (s.radius || s.border) st.overflow = "hidden";
  return st;
}

/** Inches as stage px, two decimals. */
const px = (inches: number): number => Math.round(inches * PPI * 100) / 100;

const fontStack = (f: string): string => `${/^[\w -]+$/.test(f) && !/^(system-ui|sans-serif|serif|monospace)$/.test(f) ? `"${f}"` : f}, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;

/** Rules that must not sit inside a nested rule: fonts, imports, keyframes, properties. */
const HOIST = /^@(font-face|import|charset|keyframes|-webkit-keyframes|property|namespace|layer\s*[\w.,\s]*;)/i;

/** Split CSS into its top-level statements (a rule with its block, or an at-rule ending in `;`). */
function topLevel(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        out.push(clean.slice(start, i + 1).trim());
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      out.push(clean.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = clean.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** `:root`, `html` and `body` in selectors mean the slide once nested. */
const rescope = (rule: string): string => rule.replace(/(^|[{};])([^{};@]*)(?=\{)/g, (_m, lead: string, prelude: string) => lead + prelude.replace(/(^|[\s,>+~(])(:root|html|body)(?=$|[\s,.:#[>+~)])/g, "$1&"));

/**
 * The CSS of a deck's slides: the base (boxes, type, lists, tables), the
 * template's colors and fonts as variables, the theme scoped to
 * `.deck-theme-<slug>`, then the deck's own CSS scoped to its slides.
 */
export function stageCss(t: StageTemplate, deckCss = ""): string {
  const scope = `.deck-theme-${t.slug}`;
  const vars = Object.entries(t.colors)
    .map(([k, v]) => `--c-${k}: ${v};`)
    .join(" ");
  const hoisted: string[] = [];
  const nest = (css: string): string =>
    topLevel(css)
      .filter((st) => {
        if (HOIST.test(st)) {
          hoisted.push(st);
          return false;
        }
        return true;
      })
      .map(rescope)
      .join("\n");
  const theme = nest(t.css);
  const deck = nest(deckCss);
  return [
    ...hoisted,
    BASE_CSS,
    `${scope} { ${vars} --font-heading: ${fontStack(t.fonts.heading)}; --font-body: ${fontStack(t.fonts.body)}; }`,
    theme.trim() ? `${scope} {\n${theme}\n}` : "",
    deck.trim() ? `${scope}.deck-slide {\n${deck}\n}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** What every slide gets, whatever the theme; `:where()` keeps it weaker than any theme rule. */
export const BASE_CSS = `
.deck-slide { position: relative; overflow: hidden; isolation: isolate; color: var(--c-text); font-family: var(--font-body); font-size: 28px; line-height: 1.3; text-align: left; letter-spacing: normal; -webkit-font-smoothing: antialiased; }
.deck-slide :where(*, *::before, *::after) { box-sizing: border-box; }
.deck-slide .deck-slot { position: absolute; display: flex; flex-direction: column; min-width: 0; padding: 8px 16px; overflow-wrap: break-word; }
.deck-slide .deck-slot[data-valign="middle"] { justify-content: center; }
.deck-slide .deck-slot[data-valign="bottom"] { justify-content: flex-end; }
.deck-slide .deck-content { min-height: 0; outline: none; }
.deck-slide .deck-shape { position: absolute; }
.deck-slide :where(h1, h2, h3, h4, h5, h6) { font-family: var(--font-heading); font-weight: 700; line-height: 1.1; letter-spacing: -0.015em; margin: 0; font-size: 1.15em; }
.deck-slide :where(p, ul, ol, blockquote, figure, table, pre, dl) { margin: 0; }
.deck-slide :where(p, ul, ol, table, pre, blockquote, figure, div, h1, h2, h3, h4) + :where(p, ul, ol, table, pre, blockquote, figure, h1, h2, h3, h4) { margin-top: 0.5em; }
.deck-slide :where(ul, ol) { padding-left: 1.15em; }
.deck-slide :where(ul) { list-style: disc; }
.deck-slide :where(ol) { list-style: decimal; }
.deck-slide :where(ul ul) { list-style: circle; }
.deck-slide :where(li + li) { margin-top: 0.25em; }
.deck-slide :where(li)::marker { color: var(--c-accent); }
.deck-slide :where(strong, b) { font-weight: 700; }
.deck-slide :where(em, i) { font-style: italic; }
.deck-slide :where(a) { color: var(--c-accent); text-decoration: underline; text-underline-offset: 0.12em; }
.deck-slide :where(code) { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.9em; color: var(--c-accent); }
.deck-slide :where(pre) { font-size: 0.7em; line-height: 1.4; background: var(--c-surface); border: 1px solid var(--c-line); padding: 0.6em 0.8em; border-radius: 0.3em; white-space: pre-wrap; }
.deck-slide :where(pre code) { color: inherit; font-size: 1em; }
.deck-slide :where(blockquote) { border-left: 4px solid var(--c-accent); padding-left: 0.8em; color: var(--c-muted); }
.deck-slide :where(img, svg, video) { max-width: 100%; }
.deck-slide :where(table) { border-collapse: collapse; width: 100%; font-size: 0.95em; }
.deck-slide :where(th, td) { padding: 0.45em 0.65em; border-bottom: 1px solid var(--c-line); text-align: left; vertical-align: top; }
.deck-slide :where(th) { font-weight: 700; border-bottom: 2px solid var(--c-text); }
.deck-slide .kind-image .deck-content, .deck-slide .kind-chart .deck-content, .deck-slide .kind-embed .deck-content { flex: 1; display: flex; align-items: center; justify-content: center; }
.deck-slide .kind-image img { width: 100%; height: 100%; object-fit: contain; display: block; }
.deck-slide .kind-image[data-fit="cover"] img { object-fit: cover; }
.deck-slide .kind-chart svg { width: 100%; height: 100%; display: block; overflow: visible; }
.deck-slide .kind-embed iframe { width: 100%; height: 100%; border: 0; display: block; background: #fff; }
.deck-slide .kind-image, .deck-slide .kind-chart, .deck-slide .kind-embed { padding: 0; }
.deck-slide .deck-error { color: #B91C1C; font-size: 0.6em; font-family: ui-monospace, Menlo, monospace; }
`;

const attrs = (o: Record<string, string>): string => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("; ");

/** One slide as an HTML string (the export's, the print's and the CLI's form of what the editor shows). */
export function slideHtml(v: SlideView, t: StageTemplate, extraClass = "", number?: { n: number; of: number }): string {
  const shapes = v.shapes.map((s) => `<div class="deck-shape" style="left:${s.x * PPI}px;top:${s.y * PPI}px;width:${s.w * PPI}px;height:${s.h * PPI}px;background:${s.fill}"></div>`).join("");
  const slots = v.slots
    .filter((s) => s.html || s.embed)
    .map((s) => {
      const inner = s.embed ? `<iframe ${s.embed.src ? `src="${esc(s.embed.src)}"` : `srcdoc="${esc(s.embed.srcdoc ?? "")}"`} sandbox="allow-scripts allow-popups allow-forms" loading="lazy"></iframe>` : s.html;
      return `<div class="deck-slot kind-${s.kind} slot-${s.name}${s.class ? ` ${esc(s.class)}` : ""}" data-slot="${s.name}"${s.valign ? ` data-valign="${s.valign}"` : ""}${s.fit ? ` data-fit="${s.fit}"` : ""} style="${attrs(slotStyle(s, t))}"><div class="deck-content">${inner}</div></div>`;
    })
    .join("");
  return `<section class="deck-slide deck-theme-${t.slug} layout-${v.layout}${extraClass ? ` ${extraClass}` : ""}"${number && v.numbered ? ` data-n="${number.n}" data-nn="${String(number.n).padStart(2, "0")}" data-of="${number.of}"` : ""} data-transition="${v.transition}" style="width:${v.width}px;height:${v.height}px;background:${v.background}">${shapes}${slots}</section>`;
}

/**
 * The deck as one HTML file: every slide, the theme, arrows and space to
 * step through, F for full screen, P to print (a PDF, one slide a page).
 * The caller inlines the pictures and fonts (`asset` returning data URLs,
 * the theme's URLs rewritten) so the file stands alone.
 */
export function standaloneHtml(deck: { title: string; slides: SlideDef[]; css?: string; numbers?: false }, t: StageTemplate, opts: RenderOpts): string {
  // Hidden slides stay in the file, not in the deck shown.
  const views = deck.slides.map((s) => slideView(s, t, { ...opts, ...(deck.numbers === false ? { numbers: false } : {}) })).filter((v) => !v.hidden);
  const h = stageHeight(t.size);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deck.title)}</title>
<style>
${stageCss(t, deck.css ?? "")}
html, body { margin: 0; height: 100%; background: #111; }
.deck-viewport { position: fixed; inset: 0; display: grid; place-items: center; overflow: hidden; }
.deck-viewport .deck-slide { position: absolute; left: 50%; top: 50%; transform-origin: 0 0; display: none; }
.deck-viewport .deck-slide.is-current { display: block; }
.deck-viewport .deck-slide.is-current[data-transition="fade"] { animation: deck-in-fade 300ms ease-out; }
.deck-viewport .deck-slide.is-current[data-transition="slide"] { animation: deck-in-slide 420ms cubic-bezier(.2,.7,.2,1); }
.deck-viewport .deck-slide.is-current[data-transition="zoom"] { animation: deck-in-zoom 380ms cubic-bezier(.2,.7,.2,1); }
@keyframes deck-in-fade { from { opacity: 0; } }
@keyframes deck-in-slide { from { opacity: 0; translate: 8% 0; } }
@keyframes deck-in-zoom { from { opacity: 0; scale: .92; } }
@media (prefers-reduced-motion: reduce) { .deck-viewport .deck-slide.is-current { animation: none !important; } }
.deck-counter { position: fixed; right: 16px; bottom: 10px; font: 12px system-ui, sans-serif; color: #999; }
@page { size: ${STAGE_W}px ${h}px; margin: 0; }
@media print {
  html, body { height: auto; background: none; }
  .deck-viewport { position: static; display: block; }
  .deck-viewport .deck-slide { position: relative; left: 0; top: 0; display: block !important; transform: none !important; break-after: page; }
  .deck-counter { display: none; }
}
</style></head>
<body>
<main class="deck-viewport">
${views.map((v, i) => slideHtml(v, t, i === 0 ? "is-current" : "", { n: i + 1, of: views.length })).join("\n")}
</main>
<div class="deck-counter"></div>
<script>
(() => {
  const slides = [...document.querySelectorAll(".deck-slide")];
  let i = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));
  const fit = () => {
    const s = Math.min(innerWidth / ${STAGE_W}, innerHeight / ${h});
    for (const el of slides) el.style.transform = "scale(" + s + ") translate(-50%, -50%)";
  };
  const show = (n) => {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((el, k) => el.classList.toggle("is-current", k === i));
    document.querySelector(".deck-counter").textContent = (i + 1) + " / " + slides.length;
    history.replaceState(null, "", "#" + (i + 1));
  };
  addEventListener("resize", fit);
  addEventListener("keydown", (e) => {
    if (["ArrowRight", " ", "PageDown", "Enter"].includes(e.key)) { e.preventDefault(); show(i + 1); }
    else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); show(i - 1); }
    else if (e.key === "Home") show(0);
    else if (e.key === "End") show(slides.length - 1);
    else if (e.key === "f" || e.key === "F") document.documentElement.requestFullscreen?.();
    else if (e.key === "p" || e.key === "P") print();
  });
  addEventListener("click", (e) => { if (!e.target.closest("a, iframe")) show(e.clientX > innerWidth / 3 ? i + 1 : i - 1); });
  fit(); show(i);
})();
</script>
</body></html>
`;
}
