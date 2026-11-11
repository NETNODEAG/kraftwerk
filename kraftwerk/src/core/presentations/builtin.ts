import type { LayoutDef, SlotDef, Template } from "./template.js";

/**
 * The built-in template: a calm, light look (warm page, ink, one accent,
 * hairlines) with ten layouts on a 16:9 canvas, the theme CSS that styles
 * the HTML slides, and snippets for the editor's insert menu. Workspace
 * templates copy its shape (`kraftwerk presentations templates init`).
 */

const slot = (kind: SlotDef["kind"], x: number, y: number, w: number, h: number, more: Partial<SlotDef> = {}): SlotDef => ({ kind, x, y, w, h, ...more }) as SlotDef;

/** The head of a content slide: the title, a small label at the right, a hairline under both. */
const head = (): Pick<LayoutDef, "slots" | "shapes"> => ({
  slots: {
    title: slot("text", 0.44, 0.28, 7.3, 0.8, { size: 24, bold: true, font: "heading", color: "text", valign: "bottom", placeholder: "Title" }),
    eyebrow: slot("text", 7.74, 0.28, 1.82, 0.8, { size: 9, color: "muted", align: "right", valign: "bottom", class: "eyebrow", placeholder: "Label" }),
  },
  shapes: [{ kind: "rect", x: 0.54, y: 1.12, w: 8.92, h: 0.012, fill: "line" }],
});

const withHead = (description: string, slots: Record<string, SlotDef>, extra: Partial<LayoutDef> = {}): LayoutDef => {
  const h = head();
  return { description, shapes: h.shapes, slots: { ...h.slots, ...slots }, ...extra } as LayoutDef;
};

export const DEFAULT_CSS = `/* kraftwerk default theme: the slides' look. Scoped to the slide; every class here can be used in a slot's HTML. */
.eyebrow { text-transform: uppercase; letter-spacing: 0.09em; font-weight: 600; }
.statement { letter-spacing: -0.02em; line-height: 1.15; }
.muted { color: var(--c-muted); }
.accent { color: var(--c-accent); }
.small { font-size: 0.8em; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 0.9em; }
.card { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: 0.5em; padding: 0.9em 1em; }
.card h3 { font-size: 1em; margin: 0 0 0.3em; }
.card p { color: var(--c-muted); font-size: 0.82em; line-height: 1.35; }
.card .num { display: block; font-size: 1.6em; font-weight: 700; color: var(--c-accent); line-height: 1; margin-bottom: 0.35em; letter-spacing: -0.02em; }

.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 1.2em; }
.kpi { border-top: 3px solid var(--c-accent); padding-top: 0.5em; }
.kpi strong { display: block; font-family: var(--font-heading); font-size: 2.4em; line-height: 1; letter-spacing: -0.03em; }
.kpi span { display: block; margin-top: 0.35em; color: var(--c-muted); font-size: 0.8em; }

.flow { display: flex; align-items: stretch; gap: 0.6em; }
.flow .arrow { align-self: center; color: var(--c-muted); font-size: 1.3em; }
.box { flex: 1; border-radius: 0.5em; padding: 0.8em 0.9em; font-weight: 600; display: flex; flex-direction: column; justify-content: center; font-size: 0.9em; }
.box small { display: block; font-weight: 400; color: var(--c-muted); font-size: 0.8em; margin-top: 0.25em; }
.box.ghost { border: 1px dashed #c3c2b7; color: var(--c-muted); }
.box.solid { border: 1px solid var(--c-line); background: var(--c-surface); }
.box.accent { border: 1px solid var(--c-accent); background: color-mix(in srgb, var(--c-accent) 10%, transparent); }

.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 1.6em; }
.cols h3 { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--c-accent); margin-bottom: 0.4em; }
.cols p { font-size: 0.9em; }

.timeline { list-style: none; padding: 0; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 0.8em; border-top: 2px solid var(--c-line); }
.timeline li { position: relative; padding-top: 0.9em; margin: 0; }
.timeline li::before { content: ""; position: absolute; top: -0.42em; left: 0; width: 0.7em; height: 0.7em; border-radius: 50%; background: var(--c-accent); }
.timeline b { display: block; color: var(--c-accent); }
.timeline span { display: block; font-size: 0.82em; color: var(--c-muted); margin-top: 0.2em; }

.callout { border-left: 4px solid var(--c-accent); background: color-mix(in srgb, var(--c-accent) 8%, transparent); padding: 0.7em 1em; border-radius: 0 0.4em 0.4em 0; }
.pill { display: inline-block; border: 1px solid var(--c-line); border-radius: 999px; padding: 0.15em 0.65em; font-size: 0.75em; color: var(--c-muted); }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2em; }
.compare > div { border-radius: 0.5em; padding: 0.9em 1em; background: var(--c-surface); border: 1px solid var(--c-line); }
.compare > div:last-child { border-color: var(--c-accent); }
.compare h3 { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.5em; }

/* The slide number, bottom right, on every slide but the title and section slides. */
&[data-nn]:not(.layout-title):not(.layout-section)::after { content: attr(data-nn); position: absolute; right: 72px; bottom: 30px; font-size: 18px; color: var(--c-muted); font-variant-numeric: tabular-nums; }
`;

export const DEFAULT_TEMPLATE: Template = {
  slug: "default",
  name: "Default",
  builtin: true,
  size: "16:9",
  fonts: { heading: "Helvetica Neue", body: "Helvetica Neue" },
  colors: { background: "#F9F9F7", surface: "#FFFFFF", text: "#161310", muted: "#6F6D67", accent: "#0284C7", onAccent: "#FFFFFF", line: "#E1E0D9" },
  default: "content",
  cssText: DEFAULT_CSS,
  layouts: {
    title: {
      description: "Opening slide: a big title with a line above and a footer",
      shapes: [{ kind: "rect", x: 0.54, y: 4.72, w: 8.92, h: 0.012, fill: "line" }],
      slots: {
        kicker: slot("text", 0.44, 1.45, 9.12, 0.5, { size: 13, color: "muted", placeholder: "What this is about" }),
        title: slot("text", 0.44, 1.95, 9.12, 1.75, { size: 50, bold: true, font: "heading", color: "text", valign: "top", required: true, class: "statement", placeholder: "Title" }),
        subtitle: slot("text", 0.44, 3.7, 9.12, 0.6, { size: 16, color: "muted", placeholder: "Subtitle" }),
        foot: slot("text", 0.44, 4.8, 9.12, 0.5, { size: 10, color: "muted", placeholder: "Who · where · when" }),
      },
    },
    section: {
      description: "Divider between parts, on dark",
      background: "text",
      shapes: [{ kind: "rect", x: 0.54, y: 2.1, w: 0.9, h: 0.05, fill: "accent" }],
      slots: {
        eyebrow: slot("text", 0.44, 1.6, 9.12, 0.45, { size: 11, color: "accent", class: "eyebrow", placeholder: "Part 1" }),
        title: slot("text", 0.44, 2.3, 9.12, 1.4, { size: 40, bold: true, font: "heading", color: "background", valign: "top", required: true, class: "statement", placeholder: "Section title" }),
      },
    },
    content: withHead("Title and a body of text, lists or HTML", {
      body: slot("markdown", 0.44, 1.32, 9.12, 3.95, { size: 15, color: "text", required: true, placeholder: "The slide's text, lists or a table" }),
    }),
    statement: {
      description: "One sentence that carries the slide",
      shapes: [],
      slots: {
        eyebrow: slot("text", 0.44, 1.2, 9.12, 0.45, { size: 11, color: "accent", class: "eyebrow", placeholder: "In one sentence" }),
        title: slot("text", 0.44, 1.7, 8.4, 2.6, { size: 34, bold: true, font: "heading", color: "text", valign: "top", required: true, class: "statement", placeholder: "The statement" }),
        note: slot("markdown", 0.44, 4.4, 9.12, 0.85, { size: 13, color: "muted", placeholder: "Why it matters" }),
      },
    },
    "two-column": withHead("Title with a left and a right column", {
      left: slot("markdown", 0.44, 1.32, 4.46, 3.95, { size: 14, color: "text", required: true }),
      right: slot("markdown", 5.1, 1.32, 4.46, 3.95, { size: 14, color: "text", required: true }),
    }),
    image: withHead("Title, text on the left, a picture on the right", {
      body: slot("markdown", 0.44, 1.32, 4.1, 3.95, { size: 14, color: "text" }),
      image: slot("image", 4.74, 1.32, 4.82, 3.95, { required: true, placeholder: "![caption](assets/picture.png)" }),
    }),
    chart: withHead("Title, a chart, a caption below it", {
      chart: slot("chart", 0.44, 1.32, 9.12, 3.45, { size: 11, required: true, placeholder: "```chart\nkind: column\ncategories: [Q1, Q2]\nseries:\n  - name: Revenue\n    values: [120, 180]\n```" }),
      caption: slot("text", 0.44, 4.82, 9.12, 0.45, { size: 10, color: "muted", placeholder: "Source or takeaway" }),
    }),
    table: withHead("Title and a table", {
      table: slot("table", 0.44, 1.32, 9.12, 3.95, { size: 13, color: "text", required: true, placeholder: "| Item | Value |\n|---|---|\n| Pages | 120 |" }),
    }),
    quote: {
      description: "A quotation and who said it",
      background: "surface",
      shapes: [{ kind: "rect", x: 0.7, y: 1.45, w: 0.06, h: 2.4, fill: "accent" }],
      slots: {
        quote: slot("text", 1.0, 1.4, 8.2, 2.1, { size: 28, italic: true, font: "heading", color: "text", valign: "middle", required: true, class: "statement", placeholder: "The quote" }),
        attribution: slot("text", 1.0, 3.55, 8.2, 0.5, { size: 13, color: "muted", placeholder: "Who said it" }),
      },
    },
    blank: { description: "The whole canvas as one body (HTML welcome)", shapes: [], slots: { body: slot("markdown", 0.44, 0.35, 9.12, 4.95, { size: 15, color: "text", required: true }) } },
  },
  snippets: [
    { name: "Cards", description: "Three cards with a number, a heading and a line", kind: "html", w: 9.12, h: 2.2, content: '<div class="cards">\n  <div class="card"><span class="num">01</span><h3>First</h3><p>What it is and why it matters.</p></div>\n  <div class="card"><span class="num">02</span><h3>Second</h3><p>What it is and why it matters.</p></div>\n  <div class="card"><span class="num">03</span><h3>Third</h3><p>What it is and why it matters.</p></div>\n</div>' },
    { name: "Key figures", description: "Big numbers with a label", kind: "html", w: 9.12, h: 1.6, content: '<div class="kpis">\n  <div class="kpi"><strong>120</strong><span>pages migrated</span></div>\n  <div class="kpi"><strong>5 min</strong><span>to publish a text</span></div>\n  <div class="kpi"><strong>−60%</strong><span>time per text</span></div>\n</div>' },
    { name: "Flow", description: "Boxes from left to right with arrows", kind: "html", w: 9.12, h: 1.6, content: '<div class="flow">\n  <div class="box ghost">Sources<small>CSV, Excel</small></div>\n  <div class="arrow">→</div>\n  <div class="box accent">We build this<small>import, checks, API</small></div>\n  <div class="arrow">→</div>\n  <div class="box solid">Channels<small>web, newsletter, social</small></div>\n</div>' },
    { name: "Timeline", description: "Points on a line, left to right", kind: "html", w: 9.12, h: 1.4, content: '<ol class="timeline">\n  <li><b>December</b><span>Website</span></li>\n  <li><b>January</b><span>Newsletter, LinkedIn</span></li>\n  <li><b>February</b><span>Review with the same texts</span></li>\n</ol>' },
    { name: "Before / after", description: "Two boxes side by side", kind: "html", w: 9.12, h: 2.2, content: '<div class="compare">\n  <div><h3>Today</h3><p>Every text is copied by hand into four tools.</p></div>\n  <div><h3>With the change</h3><p>Written once, published everywhere.</p></div>\n</div>' },
    { name: "Columns", description: "Three columns with a small heading", kind: "html", w: 9.12, h: 2, content: '<div class="cols">\n  <div><h3>For</h3><p>Who it serves.</p></div>\n  <div><h3>Not now</h3><p>What stays out.</p></div>\n  <div><h3>Next</h3><p>What follows.</p></div>\n</div>' },
    { name: "Callout", description: "A highlighted note", kind: "html", w: 6, h: 1, content: '<div class="callout"><strong>Note:</strong> the one thing to remember.</div>' },
  ],
};
