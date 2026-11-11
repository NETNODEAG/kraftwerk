import { parse, stringify } from "yaml";
import { DEFAULT_SLOT, NOTES_SLOT, joinSlots, slotsOf, trimBlank } from "./slots.js";

export { DEFAULT_SLOT, NOTES_SLOT, joinSlots, slotsOf } from "./slots.js";

/**
 * deck.md: the whole presentation in one Markdown file, Slidev-style.
 *
 *   ---                      headmatter: the deck (title, template, size) and the
 *   title: Why NodeHive      first slide's own keys (layout, notes, background)
 *   template: default
 *   layout: title
 *   ---
 *   # Why NodeHive           slide 1 — content before the first ::slot:: marker is
 *   ::subtitle::             the default content: a leading heading fills the
 *   Review · Nov 2026        layout's title slot, the rest its body slot
 *   ::notes::                ::notes:: are the speaker notes
 *   Open with the timeline.
 *
 *   ---                      a `---` line starts the next slide; an optional YAML
 *   layout: two-column       block right after it (closed by another `---`) is
 *   ---                      the slide's keys
 *   # Faster editing
 *   ::left::
 *   - One API for every channel
 *   ::right::
 *   ![Architecture](assets/arch.png)
 *
 * The parser is tolerant: a fence (```) hides separators and markers inside
 * it, a `---` with no YAML after it is just a separator, and anything that
 * is not a mapping stays content. `serializeDeck` writes the normalised
 * form back; the editor and the CLI both go through it, agents may edit
 * the file directly.
 */

/** Headmatter keys the deck reads itself; every other non-slide key stays in `meta` (author, date, …). */
export const DECK_KEYS = ["title", "template", "size", "css", "numbers"] as const;
export const SLIDE_KEYS = ["layout", "notes", "background", "transition"] as const;

export interface SlideDef {
  /** The layout of the template this slide uses; the template's default when missing. */
  layout?: string;
  /** Speaker notes (the `notes:` key or the ::notes:: slot). */
  notes?: string;
  /** A color name of the template or #hex; overrides the layout's background. */
  background?: string;
  transition?: string;
  /** Other keys of the slide's YAML block, kept as they are. */
  extra: Record<string, unknown>;
  /** The slide's markdown including its `::slot::` markers (the notes slot removed when `notes` came from it). */
  content: string;
}

export interface DeckDoc {
  title: string;
  template: string;
  /** The deck's own CSS over the template's theme (scoped to its slides). */
  css?: string;
  size?: "16:9" | "4:3";
  /** `numbers: false` turns the slide numbers off for the whole deck; on when missing. A slide's own `number: false` hides it there. */
  numbers?: false;
  /** Other headmatter keys (author, date, …), kept as they are. */
  meta: Record<string, unknown>;
  slides: SlideDef[];
}

const SEP_RE = /^---[ \t]*$/;
const FENCE_RE = /^(`{3,}|~{3,})/;
const KEY_RE = /^[A-Za-z_][\w-]*\s*:/;

export function parseDeck(raw: string): DeckDoc {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let head: Record<string, unknown> = {};
  // Headmatter: a leading `---` block.
  if (lines.length && SEP_RE.test(lines[0])) {
    const end = lines.findIndex((l, idx) => idx > 0 && SEP_RE.test(l));
    if (end > 0) {
      head = mapping(lines.slice(1, end).join("\n"));
      i = end + 1;
    }
  }
  const doc: DeckDoc = { title: str(head.title) || "", template: str(head.template) || "default", meta: {}, slides: [] };
  if (head.size === "4:3" || head.size === "16:9") doc.size = head.size;
  if (typeof head.css === "string" && head.css.trim()) doc.css = head.css;
  if (head.numbers === false) doc.numbers = false;
  for (const [k, v] of Object.entries(head)) if (!DECK_KEYS.includes(k as never) && !FIRST_SLIDE_KEYS.includes(k as never)) doc.meta[k] = v;

  // Split the rest into slide chunks at top-level `---` lines (not inside fences).
  const chunks: { attrs: Record<string, unknown>; body: string[] }[] = [{ attrs: pickSlideKeys(head), body: [] }];
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (line.startsWith(fence)) fence = null;
      chunks[chunks.length - 1].body.push(line);
      continue;
    }
    if (!fence && SEP_RE.test(line)) {
      // A YAML block directly after the separator?
      const close = lines.findIndex((l, idx) => idx > i && SEP_RE.test(l));
      const between = close > i ? lines.slice(i + 1, close) : [];
      const isYaml = between.length > 0 && between.every((l) => l.trim() !== "") && KEY_RE.test(between[0]) && tryMapping(between.join("\n")) != null;
      if (isYaml) {
        chunks.push({ attrs: mapping(between.join("\n")), body: [] });
        i = close;
      } else chunks.push({ attrs: {}, body: [] });
      continue;
    }
    chunks[chunks.length - 1].body.push(line);
  }
  // An empty first chunk before the first separator (a deck that starts with `---` after the headmatter) is not a slide.
  if (chunks.length > 1 && chunks[0].body.join("").trim() === "" && Object.keys(chunks[0].attrs).length === 0) chunks.shift();
  doc.slides = chunks.map((c) => slideOf(c.attrs, c.body.join("\n")));
  return doc;
}

function slideOf(attrs: Record<string, unknown>, body: string): SlideDef {
  const slide: SlideDef = { extra: {}, content: trimBlank(body) };
  if (typeof attrs.layout === "string" && attrs.layout.trim()) slide.layout = attrs.layout.trim();
  if (typeof attrs.notes === "string" && attrs.notes.trim()) slide.notes = attrs.notes.trim();
  if (typeof attrs.background === "string" && attrs.background.trim()) slide.background = attrs.background.trim();
  if (typeof attrs.transition === "string" && attrs.transition.trim()) slide.transition = attrs.transition.trim();
  for (const [k, v] of Object.entries(attrs)) if (!SLIDE_KEYS.includes(k as never)) slide.extra[k] = v;
  // ::notes:: in the content wins over the key and is lifted out of the content.
  const slots = slotsOf(slide.content);
  if (slots[NOTES_SLOT] !== undefined) {
    if (slots[NOTES_SLOT].trim()) slide.notes = slots[NOTES_SLOT].trim();
    delete slots[NOTES_SLOT];
    slide.content = joinSlots(slots);
  }
  return slide;
}

/** A deck in its file form: headmatter, then slides separated by `---` lines with their YAML blocks. */
export function serializeDeck(doc: DeckDoc): string {
  const head: Record<string, unknown> = { title: doc.title || "Untitled", template: doc.template || "default" };
  if (doc.size) head.size = doc.size;
  if (doc.numbers === false) head.numbers = false;
  if (doc.css?.trim()) head.css = doc.css.replace(/\s+$/, "") + "\n";
  Object.assign(head, doc.meta);
  const slides = doc.slides.length ? doc.slides : [{ extra: {}, content: "" }];
  Object.assign(head, slideAttrs(slides[0]));
  let out = `---\n${stringify(head)}---\n`;
  out += slideBody(slides[0]);
  for (const s of slides.slice(1)) {
    const attrs = slideAttrs(s);
    out += `\n---\n`;
    if (Object.keys(attrs).length) out += `${stringify(attrs)}---\n`;
    out += slideBody(s);
  }
  return out;
}

function slideAttrs(s: SlideDef): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (s.layout) attrs.layout = s.layout;
  if (s.background) attrs.background = s.background;
  if (s.transition) attrs.transition = s.transition;
  Object.assign(attrs, s.extra);
  return attrs;
}

function slideBody(s: SlideDef): string {
  const content = trimBlank(s.content);
  const notes = s.notes?.trim() ? `::notes::\n${s.notes.trim()}` : "";
  const body = [content, notes].filter(Boolean).join("\n\n");
  return body ? `${body}\n` : "";
}

/** A new deck's file: a title slide and one content slide, so the editor opens with something to show. */
export function starterDeck(title: string, template: string): DeckDoc {
  return {
    title,
    template,
    meta: {},
    slides: [
      { layout: "title", extra: {}, content: `# ${title}\n\n::subtitle::\n${new Date().toISOString().slice(0, 10)}` },
      { layout: "content", extra: {}, content: "# First point\n\n- What this deck is about\n- Why it matters\n- What we decide" },
    ],
  };
}

/** The first slide's keys live in the headmatter: the slide keys and its `slots:` changes. */
/** The first slide's keys live in the headmatter too: id (comments point at it), hidden, number, slots. */
const FIRST_SLIDE_KEYS = [...SLIDE_KEYS, "slots", "id", "hidden", "number"] as const;

function pickSlideKeys(head: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIRST_SLIDE_KEYS) if (head[k] !== undefined) out[k] = head[k];
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

function mapping(text: string): Record<string, unknown> {
  const data = text.trim() ? parse(text) : {};
  if (data == null) return {};
  if (typeof data !== "object" || Array.isArray(data)) throw new Error("frontmatter must be a mapping");
  return data as Record<string, unknown>;
}

function tryMapping(text: string): Record<string, unknown> | null {
  try {
    const data = parse(text);
    return data != null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
