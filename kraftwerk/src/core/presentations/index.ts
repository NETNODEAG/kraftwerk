import { promises as fs } from "node:fs";
import path from "node:path";
import { presentationsRootFor, resolveWorkspace, type ResolvedWorkspace } from "../../config.js";
import { changed } from "../changes.js";
import { workspaceRoot } from "../context.js";
import { newestMtime } from "../mtime.js";
import { openProjects, safeProjectSlug } from "../projects.js";
import { SLUG_RE, slugify } from "../slug.js";
import { moveToTrash } from "../trash.js";
import { parseDeck, serializeDeck, starterDeck, type DeckDoc, type SlideDef } from "./deck.js";
import { setSlot } from "./slots.js";
import { listVersions, readVersion, snapshot, type DeckVersion } from "./versions.js";
import { PPTX_MIME, slidePng, slidePngs, toPdf, toPptx } from "./export.js";
import { hasHtml, renderDeck, type RenderWarning, type Rendered } from "./render.js";
import { slideView, standaloneHtml, stageHeight, type StageTemplate } from "./html.js";
import { browserProblem, withDeckPage } from "./browser.js";
import { STAGE_W } from "./layout.js";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { CANVAS, DEFAULT_CSS, DEFAULT_TEMPLATE, defaultSlotOf, templateColors, defaultTemplateYaml, loadWorkspaceTemplates, templateSummary, TEMPLATES_DIR, TEMPLATE_FILE, type SlotKind, type Template, type TemplateSummary } from "./template.js";

export { parseDeck, serializeDeck, type DeckDoc, type SlideDef } from "./deck.js";
export { slotsOf, joinSlots, getSlot, setSlot, DEFAULT_SLOT } from "./slots.js";
export { parseMarkdown, type Block, type Run } from "./markdown.js";
export { renderDeck, type RenderWarning } from "./render.js";
export { DEFAULT_TEMPLATE, parseTemplate, defaultTemplateYaml, CANVAS, type Template, type TemplateSummary, type LayoutDef, type SlotDef } from "./template.js";
export { PPTX_MIME, toPdf, toPptx } from "./export.js";
export { slideView, stageCss, slideHtml, standaloneHtml, type StageTemplate, type SlideView, type SlotView } from "./html.js";

/**
 * Presentations: slide decks as folders, one per deck — deck.md (the
 * slides, Slidev-style markdown), assets/ (pictures), exports/ (what
 * `render` wrote). A project's decks live in projects/<p>/presentations/,
 * the workspace's under the presentations root; templates under
 * <root>/templates/<slug>/template.yml (+ theme.css, fonts, pictures).
 * Slides are HTML (html.ts): the editor, present mode, the thumbnails, the
 * HTML file and — through a headless browser (browser.ts) — the PNGs and
 * the PDF are all the same render. The PowerPoint file is a native model
 * of the same slots (render.ts), its HTML pieces drawn as pictures.
 * Agents write deck.md and look at `render --png`.
 */

export const DECK_FILE = "deck.md";
export const ASSETS_DIR = "assets";
export const EXPORTS_DIR = "exports";
export const COMMENTS_FILE = "comments.json";
const PRESENTATIONS_DIR = "presentations";

export interface PresentationRef {
  project?: string;
  name: string;
}

export interface PresentationSummary extends PresentationRef {
  title: string;
  template: string;
  slides: number;
  path: string;
  updatedAt?: string;
  /** Set when deck.md cannot be parsed; the editor shows the raw file. */
  error?: string;
}

export interface LayoutInfo {
  name: string;
  description?: string;
  /** The slot the unmarked content after the heading goes to. */
  default?: string;
  /** Position and size in inches on the canvas, for the editor's inline fields. */
  slots: SlotInfo[];
}

export interface SlotInfo {
  name: string;
  kind: SlotKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text look, as the layout sets it (the editor's toolbar starts from these). */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  color?: string;
  required?: boolean;
  placeholder?: string;
}

export interface PresentationDetail extends PresentationSummary {
  deck: DeckDoc;
  /** deck.md as it is on disk. */
  source: string;
  warnings: RenderWarning[];
  /** The deck's template with its layouts, for the editor's picker. */
  layouts: LayoutInfo[];
  /** The canvas in inches (the slot positions' frame). */
  canvas: { w: number; h: number };
  /** The template's named colors as #RRGGBB, for the editor's swatches. */
  colors: Record<string, string>;
  /** The template as the HTML renderer needs it; `{{base}}` in its CSS stands for the API's base URL. */
  theme: StageTemplate;
  /** Every usable template the same way, for the design picker's previews. */
  themes: StageTemplate[];
  templates: TemplateSummary[];
  /** Files under assets/, relative to the deck folder. */
  assets: string[];
  /** What exports/ holds. */
  exports: string[];
  /** Comments on slides and boxes, oldest first (comments.json in the folder). */
  comments: DeckComment[];
}

export interface DeckComment {
  id: string;
  /** The slide's id (`id:` in its YAML head, given when the first comment lands), and its number when listed. */
  slide: string;
  n?: number;
  /** The box it is about, when it is about one. */
  slot?: string;
  author: string;
  text: string;
  at: string;
  resolved?: boolean;
  replies: { author: string; text: string; at: string }[];
}

export interface PresentationsView {
  enabled: boolean;
  root?: string;
  presentations: PresentationSummary[];
  error?: string;
}

/* ---------- root ---------- */

export async function openPresentations(): Promise<{ project?: ResolvedWorkspace; root?: string; off?: boolean; error?: string }> {
  let project: ResolvedWorkspace;
  try {
    project = await resolveWorkspace(workspaceRoot());
  } catch (err) {
    return { error: (err as Error).message };
  }
  const root = presentationsRootFor(project);
  if (!root) return { off: true, error: "presentations are off (enable them in settings or add `presentations:` to kraftwerk.yml)" };
  return { project, root };
}

/** Make sure the workspace presentations root exists; runs when the feature is switched on. */
export async function ensurePresentationsRoot(): Promise<void> {
  const opened = await openPresentations();
  if (opened.root) await fs.mkdir(opened.root, { recursive: true });
}

async function requireRoot(): Promise<string> {
  const opened = await openPresentations();
  if (!opened.root) throw new Error(opened.error ?? "presentations are off");
  return opened.root;
}

export function safeDeckSlug(slug: string): string {
  if (!SLUG_RE.test(slug) || slug === TEMPLATES_DIR) throw new Error(`invalid presentation name "${slug}"`);
  return slug;
}

/** The folder a deck lives in: inside its project (projects must be on) or under the workspace root. */
export async function deckDir(ref: PresentationRef): Promise<string> {
  const root = await requireRoot();
  const name = safeDeckSlug(ref.name);
  if (!ref.project) return path.join(root, name);
  const projects = await openProjects();
  if (!projects.root) throw new Error(projects.error ?? "projects are off");
  const dir = path.join(projects.root, safeProjectSlug(ref.project));
  if (!(await fs.stat(path.join(dir, "project.yml")).catch(() => null))) throw new Error(`no project "${ref.project}"`);
  return path.join(dir, PRESENTATIONS_DIR, name);
}

/** The folder of a deck that exists (its deck.md is there); throws "no presentation …" otherwise. */
export async function existingDeckDir(ref: PresentationRef): Promise<string> {
  const dir = await deckDir(ref);
  if (!(await fs.stat(path.join(dir, DECK_FILE)).catch(() => null))) throw new Error(`no presentation "${deckKey(ref)}"`);
  return dir;
}

/** "<project>/<name>" or "<name>". */
export const deckKey = (ref: PresentationRef): string => (ref.project ? `${ref.project}/${ref.name}` : ref.name);

export function parseDeckRef(text: string): PresentationRef {
  const parts = text.trim().split("/").filter(Boolean);
  if (parts.length === 1) return { name: safeDeckSlug(parts[0]) };
  if (parts.length === 2) return { project: safeProjectSlug(parts[0]), name: safeDeckSlug(parts[1]) };
  throw new Error(`invalid presentation reference "${text}" (expected <name> or <project>/<name>)`);
}

/* ---------- templates ---------- */

export async function listTemplates(): Promise<TemplateSummary[]> {
  const opened = await openPresentations();
  if (!opened.root) return [templateSummary(DEFAULT_TEMPLATE)];
  const { templates, errors } = await loadWorkspaceTemplates(opened.root);
  return [templateSummary(DEFAULT_TEMPLATE), ...templates.map(templateSummary), ...errors];
}

async function templateFor(slug: string | undefined): Promise<{ template: Template; warning?: string }> {
  const want = (slug ?? "default").trim() || "default";
  if (want === DEFAULT_TEMPLATE.slug) return { template: DEFAULT_TEMPLATE };
  const opened = await openPresentations();
  if (opened.root) {
    const { templates, errors } = await loadWorkspaceTemplates(opened.root);
    const found = templates.find((t) => t.slug === want);
    if (found) return { template: found };
    const broken = errors.find((t) => t.slug === want);
    if (broken) return { template: DEFAULT_TEMPLATE, warning: `template "${want}" cannot be used (${broken.error}); rendered with "default"` };
  }
  return { template: DEFAULT_TEMPLATE, warning: `unknown template "${want}"; rendered with "default"` };
}

/** A template with its theme CSS whose relative URLs (fonts, pictures) point where `fileUrl` says. */
export function stageTemplateOf(t: Template, fileUrl: (rel: string) => string): StageTemplate {
  return {
    slug: t.slug,
    name: t.name,
    size: t.size,
    fonts: t.fonts,
    colors: templateColors(t),
    layouts: t.layouts,
    ...(t.default ? { default: t.default } : {}),
    css: rewriteUrls(t.cssText ?? "", fileUrl),
    snippets: t.snippets ?? [],
  };
}

const rewriteUrls = (css: string, to: (rel: string) => string): string =>
  css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q: string, u: string) => (/^(data:|https?:|\/|#|\{\{)/i.test(u.trim()) ? m : `url("${to(u.trim().replace(/^\.\//, ""))}")`));

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".avif": "image/avif",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".css": "text/css", ".json": "application/json",
  ".mp4": "video/mp4", ".webm": "video/webm", ".pdf": "application/pdf", ".txt": "text/plain",
};
export const mimeOf = (file: string): string => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** A file inside `dir` named by a relative path; null when it escapes the folder, is hidden or does not exist. */
async function fileInside(dir: string, rel: string): Promise<string | null> {
  const clean = rel.replace(/^\.\//, "").split("?")[0];
  if (!clean || /^[a-z]+:/i.test(clean) || clean.startsWith("/") || clean.split(/[\\/]/).some((p) => p === ".." || p.startsWith("."))) return null;
  const abs = path.resolve(dir, clean);
  if (!abs.startsWith(dir + path.sep)) return null;
  const st = await fs.stat(abs).catch(() => null);
  return st?.isFile() ? abs : null;
}

/** A file of a workspace template (its fonts, its logo); the built-in one has none. */
export async function templateFile(slug: string, rel: string): Promise<{ path: string; mime: string } | null> {
  const { template } = await templateFor(slug);
  if (template.slug !== slug || !template.path) return null;
  const abs = await fileInside(path.dirname(template.path), rel);
  return abs ? { path: abs, mime: mimeOf(abs) } : null;
}

/** A file of a deck (its pictures under assets/); deck.md and exports are reached otherwise. */
export async function deckFile(ref: PresentationRef, rel: string): Promise<{ path: string; mime: string } | null> {
  const abs = await fileInside(await deckDir(ref), rel);
  return abs ? { path: abs, mime: mimeOf(abs) } : null;
}

/** The built-in template and the workspace's usable ones, for the HTML renderer. */
async function allThemes(fileUrl: (t: Template) => (rel: string) => string): Promise<StageTemplate[]> {
  const opened = await openPresentations();
  const list = [DEFAULT_TEMPLATE, ...(opened.root ? (await loadWorkspaceTemplates(opened.root)).templates : [])];
  return list.map((t) => stageTemplateOf(t, fileUrl(t)));
}

/** Write the built-in template as a workspace template to edit. */
export async function initTemplate(slug: string): Promise<string> {
  const root = await requireRoot();
  const name = safeDeckSlug(slug);
  const dir = path.join(root, TEMPLATES_DIR, name);
  const file = path.join(dir, TEMPLATE_FILE);
  if (await fs.stat(file).catch(() => null)) throw new Error(`template "${name}" already exists: ${file}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, defaultTemplateYaml().replace(/^name: .*$/m, `name: ${name}`), { flag: "wx" });
  // The theme beside it: the default look to change (fonts and pictures go next to it, named by relative URLs).
  await fs.writeFile(path.join(dir, "theme.css"), DEFAULT_CSS, { flag: "wx" }).catch(() => {});
  changed();
  return file;
}

/* ---------- reads ---------- */

async function deckSlugsIn(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !SLUG_RE.test(e.name) || e.name === TEMPLATES_DIR) continue;
    if (await fs.stat(path.join(dir, e.name, DECK_FILE)).catch(() => null)) out.push(e.name);
  }
  return out.sort();
}

async function readSummary(ref: PresentationRef, dir: string): Promise<PresentationSummary> {
  const file = path.join(dir, DECK_FILE);
  const raw = await fs.readFile(file, "utf8");
  const st = await fs.stat(file).catch(() => null);
  const base = { ...ref, path: dir, ...(st ? { updatedAt: new Date(st.mtimeMs).toISOString() } : {}) };
  try {
    const deck = parseDeck(raw);
    return { ...base, title: deck.title || ref.name, template: deck.template, slides: deck.slides.length };
  } catch (err) {
    return { ...base, title: ref.name, template: "default", slides: 0, error: (err as Error).message };
  }
}

/** The decks of a project, or the workspace decks when no project is given. */
export async function listDecks(project?: string): Promise<PresentationsView> {
  const opened = await openPresentations();
  if (!opened.root) return { enabled: false, presentations: [], error: opened.error };
  let dir: string;
  if (project) {
    const projects = await openProjects();
    if (!projects.root) return { enabled: true, root: opened.root, presentations: [], error: projects.error };
    dir = path.join(projects.root, safeProjectSlug(project), PRESENTATIONS_DIR);
  } else dir = opened.root;
  const presentations = await Promise.all((await deckSlugsIn(dir)).map((name) => readSummary({ ...(project ? { project } : {}), name }, path.join(dir, name))));
  return { enabled: true, root: opened.root, presentations };
}

/** Every deck of the workspace: the workspace ones first, then each project's. */
export async function listAllDecks(): Promise<PresentationSummary[]> {
  const opened = await openPresentations();
  if (!opened.root) return [];
  const out = (await listDecks()).presentations;
  const projects = await openProjects();
  if (projects.root) {
    const slugs = (await fs.readdir(projects.root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && SLUG_RE.test(e.name)).map((e) => e.name);
    for (const p of slugs) out.push(...(await listDecks(p).catch(() => ({ presentations: [] as PresentationSummary[] }))).presentations);
  }
  return out;
}

async function filesIn(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => e.name).sort();
}

/* ---------- comments ---------- */

async function readComments(dir: string): Promise<DeckComment[]> {
  const raw = await fs.readFile(path.join(dir, COMMENTS_FILE), "utf8").catch(() => null);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { comments?: DeckComment[] };
    return Array.isArray(data.comments) ? data.comments.filter((c) => c && typeof c.id === "string" && typeof c.text === "string").map((c) => ({ ...c, replies: Array.isArray(c.replies) ? c.replies : [] })) : [];
  } catch {
    return [];
  }
}

const writeComments = async (dir: string, comments: DeckComment[]): Promise<void> => {
  await fs.writeFile(path.join(dir, COMMENTS_FILE), `${JSON.stringify({ comments: comments.map(({ n: _n, ...c }) => c) }, null, 2)}\n`);
  changed();
};

/** Comments with the number of the slide they are on now (slides move; their ids do not). */
const numbered = (comments: DeckComment[], deck: DeckDoc): DeckComment[] => {
  const at = new Map(deck.slides.map((s, i) => [String(s.extra?.id ?? ""), i + 1]));
  return comments.map((c) => ({ ...c, ...(at.has(c.slide) ? { n: at.get(c.slide)! } : {}) }));
};

const newId = (): string => Math.random().toString(36).slice(2, 8);

/** A comment on slide `n` (1-based), on one of its boxes when `slot` is given. The slide gets an id the first time. */
export async function addComment(ref: PresentationRef, input: { slide: number; slot?: string; text: string; author: string }): Promise<DeckComment> {
  const text = (input.text ?? "").trim();
  if (!text) throw new Error("a comment needs text");
  const dir = await deckDir(ref);
  const file = path.join(dir, DECK_FILE);
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) throw new Error(`no presentation "${deckKey(ref)}"`);
  const deck = parseDeck(raw);
  const slide = deck.slides[input.slide - 1];
  if (!slide) throw new Error(`no slide ${input.slide} (the deck has ${deck.slides.length})`);
  let id = typeof slide.extra?.id === "string" ? (slide.extra.id as string) : "";
  if (!id) {
    id = `s${newId()}`;
    slide.extra = { id, ...slide.extra };
    await fs.writeFile(file, serializeDeck(deck));
  }
  const comment: DeckComment = { id: `c${newId()}`, slide: id, ...(input.slot ? { slot: input.slot } : {}), author: input.author, text, at: new Date().toISOString(), replies: [] };
  await writeComments(dir, [...(await readComments(dir)), comment]);
  return { ...comment, n: input.slide };
}

/** Resolve or reopen a comment, or answer it. */
export async function updateComment(ref: PresentationRef, id: string, input: { resolved?: boolean; reply?: string; author: string }): Promise<DeckComment> {
  const dir = await deckDir(ref);
  const all = await readComments(dir);
  const c = all.find((x) => x.id === id);
  if (!c) throw new Error(`no comment "${id}"`);
  if (typeof input.resolved === "boolean") c.resolved = input.resolved || undefined;
  if (input.reply?.trim()) c.replies.push({ author: input.author, text: input.reply.trim(), at: new Date().toISOString() });
  await writeComments(dir, all);
  return c;
}

export async function deleteComment(ref: PresentationRef, id: string): Promise<void> {
  const dir = await deckDir(ref);
  const all = await readComments(dir);
  if (!all.some((c) => c.id === id)) throw new Error(`no comment "${id}"`);
  await writeComments(dir, all.filter((c) => c.id !== id));
}

/** The deck's earlier versions, newest first. */
export async function deckVersions(ref: PresentationRef): Promise<DeckVersion[]> {
  return listVersions(await existingDeckDir(ref));
}

export async function deckVersion(ref: PresentationRef, id: string) {
  return readVersion(await existingDeckDir(ref), id);
}

export async function listComments(ref: PresentationRef): Promise<DeckComment[]> {
  const dir = await deckDir(ref);
  const raw = await fs.readFile(path.join(dir, DECK_FILE), "utf8").catch(() => null);
  if (raw === null) throw new Error(`no presentation "${deckKey(ref)}"`);
  return numbered(await readComments(dir), parseDeck(raw));
}

export async function getDeck(ref: PresentationRef): Promise<PresentationDetail | null> {
  const dir = await deckDir(ref);
  const file = path.join(dir, DECK_FILE);
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) return null;
  const summary = await readSummary(ref, dir);
  const templates = await listTemplates();
  const assets = (await filesIn(path.join(dir, ASSETS_DIR))).map((f) => `${ASSETS_DIR}/${f}`);
  const exports = await filesIn(path.join(dir, EXPORTS_DIR));
  const webUrl = (t: Template) => (rel: string) => `{{base}}/api/presentations/templates/${t.slug}/file?path=${encodeURIComponent(rel)}`;
  if (summary.error) {
    return { ...summary, deck: { title: ref.name, template: "default", meta: {}, slides: [] }, source: raw, warnings: [{ slide: 0, level: "error", message: `deck.md cannot be read: ${summary.error}` }], layouts: layoutsOf(DEFAULT_TEMPLATE), canvas: CANVAS[DEFAULT_TEMPLATE.size], colors: templateColors(DEFAULT_TEMPLATE), theme: stageTemplateOf(DEFAULT_TEMPLATE, webUrl(DEFAULT_TEMPLATE)), themes: await allThemes(webUrl), templates, assets, exports, comments: [] };
  }
  const rendered = await render(ref);
  return { ...summary, deck: rendered.deck, source: raw, warnings: rendered.warnings, layouts: layoutsOf(rendered.template), canvas: CANVAS[rendered.deck.size ?? rendered.template.size], colors: templateColors(rendered.template), theme: stageTemplateOf(rendered.template, webUrl(rendered.template)), themes: await allThemes(webUrl), templates, assets, exports, comments: numbered(await readComments(dir), rendered.deck) };
}

const layoutsOf = (t: Template): LayoutInfo[] =>
  Object.entries(t.layouts).map(([name, l]) => {
    const dflt = defaultSlotOf(l);
    return {
      name,
      ...(l.description ? { description: l.description } : {}),
      ...(dflt ? { default: dflt } : {}),
      slots: Object.entries(l.slots).map(([slot, s]) => ({
        name: slot,
        kind: s.kind,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        ...(s.size ? { size: s.size } : {}),
        ...(s.bold ? { bold: true } : {}),
        ...(s.italic ? { italic: true } : {}),
        ...(s.align ? { align: s.align } : {}),
        ...(s.valign ? { valign: s.valign } : {}),
        ...(s.color ? { color: s.color } : {}),
        ...(s.required ? { required: true } : {}),
        ...(s.placeholder ? { placeholder: s.placeholder } : {}),
      })),
    };
  });

async function requireDeck(ref: PresentationRef): Promise<PresentationDetail> {
  const d = await getDeck(ref);
  if (!d) throw new Error(`no presentation "${deckKey(ref)}"`);
  return d;
}

/** A deck by "<project>/<name>" or "<name>". */
export async function findDeck(reference: string): Promise<PresentationSummary | null> {
  const ref = parseDeckRef(reference);
  const dir = await deckDir(ref).catch(() => null);
  if (!dir || !(await fs.stat(path.join(dir, DECK_FILE)).catch(() => null))) return null;
  return readSummary(ref, dir);
}

/* ---------- render (cached) ---------- */

interface RenderEntry extends Rendered {
  stamp: string;
  deck: DeckDoc;
  template: Template;
}

const cache = new Map<string, RenderEntry>();

async function stampOf(dir: string, template: Template): Promise<string> {
  const deck = await fs.stat(path.join(dir, DECK_FILE)).catch(() => null);
  const assets = await newestMtime(path.join(dir, ASSETS_DIR));
  const tpl = template.path ? await fs.stat(template.path).catch(() => null) : null;
  return `${deck?.mtimeMs ?? 0}:${deck?.size ?? 0}:${assets}:${tpl?.mtimeMs ?? 0}`;
}

/** Reads a slide's pictures from the deck folder, and from nowhere else. */
const assetsOf = (dir: string) => ({
  read: async (src: string): Promise<Uint8Array | null> => {
    const clean = src.replace(/^\.\//, "").split("?")[0];
    if (/^[a-z]+:/i.test(clean) || clean.startsWith("/") || clean.split(/[\\/]/).includes("..")) return null;
    const abs = path.resolve(dir, clean);
    if (!abs.startsWith(dir + path.sep)) return null;
    const bytes = await fs.readFile(abs).catch(() => null);
    return bytes ? new Uint8Array(bytes) : null;
  },
});

/** The deck rendered into its PowerPoint model, cached until deck.md, an asset or the template changes. */
export async function render(ref: PresentationRef): Promise<RenderEntry> {
  const dir = await deckDir(ref);
  const raw = await fs.readFile(path.join(dir, DECK_FILE), "utf8").catch(() => null);
  if (raw === null) throw new Error(`no presentation "${deckKey(ref)}"`);
  const deck = parseDeck(raw);
  const { template, warning } = await templateFor(deck.template);
  const stamp = await stampOf(dir, template);
  const key = `${dir}`;
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit;
  const rendered = await renderDeck(deck, template, assetsOf(dir));
  if (warning) rendered.warnings.unshift({ slide: 0, level: "error", message: warning });
  const entry: RenderEntry = { ...rendered, stamp, deck, template };
  cache.set(key, entry);
  return entry;
}

/** One slide as PNG (1-based `n`). */
export async function deckSlidePng(ref: PresentationRef, n: number, width = 1280, hide?: string): Promise<Uint8Array> {
  const r = await render(ref);
  if (!Number.isInteger(n) || n < 1 || n > r.deck.slides.length) throw new Error(`no slide ${n} (the deck has ${r.deck.slides.length})`);
  if (!hide) return slidePng(r.pres, n - 1, width);
  // The slide without one slot's content: what the editor shows under the text being typed in place. Rendered alone, not cached.
  const slide = r.deck.slides[n - 1];
  const layout = r.template.layouts[slide.layout ?? ""] ?? r.template.layouts[r.template.default ?? "content"] ?? Object.values(r.template.layouts)[0];
  const bare = { ...slide, content: setSlot(slide.content, hide, "", layout ? defaultSlotOf(layout) : undefined) };
  const one = await renderDeck({ ...r.deck, slides: [bare] }, r.template, assetsOf(await deckDir(ref)));
  return slidePng(one.pres, 0, width);
}

export type ExportFormat = "pptx" | "pdf" | "png" | "html";

export interface ExportResult {
  /** Files written, absolute. */
  files: string[];
  warnings: RenderWarning[];
}

const dataUrl = async (abs: string): Promise<string> => `data:${mimeOf(abs)};base64,${(await fs.readFile(abs)).toString("base64")}`;

/** The deck as one self-contained HTML file: pictures and the theme's fonts inlined. */
export async function deckHtml(ref: PresentationRef): Promise<{ html: string; deck: DeckDoc; template: Template; stage: StageTemplate }> {
  const dir = await deckDir(ref);
  const r = await render(ref);
  const tplDir = r.template.path ? path.dirname(r.template.path) : null;
  // The theme's files first (fonts, logos), as data URLs.
  const inlined = new Map<string, string>();
  if (tplDir) for (const m of (r.template.cssText ?? "").matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const rel = m[1].trim().replace(/^\.\//, "");
    const abs = await fileInside(tplDir, rel);
    if (abs) inlined.set(rel, await dataUrl(abs));
  }
  const stage = stageTemplateOf(r.template, (rel) => inlined.get(rel) ?? rel);
  // Every picture the slides name.
  const pics = new Map<string, string>();
  for (const s of r.deck.slides) for (const m of s.content.matchAll(/(?:\]\(|src=["'])((?!https?:|data:)[^)"'\s]+)/g)) {
    const abs = await fileInside(dir, m[1]);
    if (abs && !pics.has(m[1])) pics.set(m[1], await dataUrl(abs));
  }
  const html = standaloneHtml({ title: r.deck.title, slides: r.deck.slides, ...(r.deck.numbers === false ? { numbers: false as const } : {}), ...(r.deck.css ? { css: inlineAssets(r.deck.css, pics) } : {}) }, stage, { asset: (src) => pics.get(src.replace(/^\.\//, "")) ?? pics.get(src) ?? src });
  return { html: inlineAssets(html, pics), deck: r.deck, template: r.template, stage };
}

/** `src="assets/x.png"` written by hand in a slot's HTML also becomes a data URL. */
const inlineAssets = (html: string, pics: Map<string, string>): string => html.replace(/(?<![\w-])(src=["']|url\(["']?)(assets\/[^"')\s]+)/g, (m, lead: string, rel: string) => (pics.has(rel) ? lead + pics.get(rel) : m));

/** The pictures of the slots PowerPoint cannot carry (HTML, embeds), drawn by the browser; null without one. */
async function htmlSlotPictures(ref: PresentationRef): Promise<Map<string, Uint8Array> | null> {
  const { html, deck, stage } = await deckHtml(ref);
  const wanted: { slide: number; slot: string }[] = [];
  deck.slides.forEach((s, i) => {
    for (const v of slideView(s, stage, { asset: (x) => x }).slots) if ((v.kind === "html" || v.kind === "embed" || (v.md && hasHtml(v.md))) && (v.html || v.embed)) wanted.push({ slide: i + 1, slot: v.name });
  });
  if (!wanted.length) return new Map();
  return withDeckPage(html, { width: STAGE_W, height: stageHeight(stage.size) }, async (page) => {
    const out = new Map<string, Uint8Array>();
    for (const w of wanted) {
      const shot = await page.locator(`section.deck-slide:nth-of-type(${w.slide}) [data-slot="${w.slot}"]`).nth(0).screenshot({ type: "png", omitBackground: true }).catch(() => null);
      if (shot) out.set(`${w.slide}:${w.slot}`, new Uint8Array(shot));
    }
    return out;
  });
}

/** Every slide as PNG from the HTML (1600 px wide); null without a browser. */
async function browserPngs(ref: PresentationRef): Promise<Uint8Array[] | null> {
  const { html, deck, stage } = await deckHtml(ref);
  return withDeckPage(html, { width: STAGE_W, height: stageHeight(stage.size) }, async (page) => {
    const out: Uint8Array[] = [];
    for (let i = 0; i < deck.slides.length; i++) out.push(new Uint8Array(await page.locator("section.deck-slide").nth(i).screenshot({ type: "png" })));
    return out;
  });
}

/** The deck as PDF from the HTML, one slide a page; null without a browser. */
async function browserPdf(ref: PresentationRef): Promise<Uint8Array | null> {
  const { html, stage } = await deckHtml(ref);
  const h = stageHeight(stage.size);
  return withDeckPage(html, { width: STAGE_W, height: h }, async (page) => new Uint8Array(await page.pdf({ width: `${STAGE_W}px`, height: `${h}px`, printBackground: true, preferCSSPageSize: true })));
}

/** The PowerPoint file: the native model, its HTML pieces as the browser draws them (placeholders without one). */
async function pptxBytes(ref: PresentationRef): Promise<{ bytes: Uint8Array; warnings: RenderWarning[] }> {
  const r = await render(ref);
  const pictures = await htmlSlotPictures(ref);
  const warnings = [...r.warnings];
  if (pictures === null) warnings.unshift({ slide: 0, level: "warning", message: `HTML pieces are placeholders in the PowerPoint file: ${browserProblem()}` });
  if (!pictures?.size) return { bytes: await toPptx(r.pres), warnings };
  const fresh = await renderDeck(r.deck, r.template, assetsOf(await deckDir(ref)), { images: pictures });
  return { bytes: await toPptx(fresh.pres), warnings };
}

/** Write the deck's PPTX, PDF, slide PNGs or HTML into exports/ (or `outDir`). */
export async function exportDeck(ref: PresentationRef, format: ExportFormat, opts: { outDir?: string; width?: number } = {}): Promise<ExportResult> {
  const dir = await deckDir(ref);
  const r = await render(ref);
  const out = opts.outDir ? path.resolve(opts.outDir) : path.join(dir, EXPORTS_DIR);
  await fs.mkdir(out, { recursive: true });
  const files: string[] = [];
  let warnings = r.warnings;
  const fallback = (what: string): RenderWarning => ({ slide: 0, level: "warning", message: `${what} drawn from the PowerPoint model, not the HTML: ${browserProblem()}` });
  if (format === "pptx") {
    const file = path.join(out, `${ref.name}.pptx`);
    const p = await pptxBytes(ref);
    await fs.writeFile(file, p.bytes);
    warnings = p.warnings;
    files.push(file);
  } else if (format === "html") {
    const file = path.join(out, `${ref.name}.html`);
    await fs.writeFile(file, (await deckHtml(ref)).html);
    files.push(file);
  } else if (format === "pdf") {
    const file = path.join(out, `${ref.name}.pdf`);
    const pdf = await browserPdf(ref);
    if (!pdf) warnings = [fallback("PDF"), ...warnings];
    await fs.writeFile(file, pdf ?? toPdf(r.pres, r.deck.size ?? r.template.size, opts.width));
    files.push(file);
  } else {
    const slides = path.join(out, "slides");
    await fs.rm(slides, { recursive: true, force: true });
    await fs.mkdir(slides, { recursive: true });
    const shots = await browserPngs(ref);
    if (!shots) warnings = [fallback("slide images"), ...warnings];
    const pngs = shots ?? slidePngs(r.pres, opts.width ?? 1280);
    for (const [i, png] of pngs.entries()) {
      const file = path.join(slides, `${String(i + 1).padStart(2, "0")}.png`);
      await fs.writeFile(file, png);
      files.push(file);
    }
  }
  changed();
  return { files, warnings };
}

/** The bytes of an export for a download, without writing exports/. */
export async function exportBytes(ref: PresentationRef, format: "pptx" | "pdf" | "html"): Promise<{ bytes: Uint8Array; mime: string; filename: string }> {
  if (format === "pptx") return { bytes: (await pptxBytes(ref)).bytes, mime: PPTX_MIME, filename: `${ref.name}.pptx` };
  if (format === "html") return { bytes: new TextEncoder().encode((await deckHtml(ref)).html), mime: "text/html; charset=utf-8", filename: `${ref.name}.html` };
  const r = await render(ref);
  return { bytes: (await browserPdf(ref)) ?? toPdf(r.pres, r.deck.size ?? r.template.size), mime: "application/pdf", filename: `${ref.name}.pdf` };
}

/* ---------- writes ---------- */

export async function createDeck(input: { project?: string; title: string; slug?: string; template?: string; source?: string }): Promise<PresentationDetail> {
  const title = (input.title ?? "").trim();
  if (!title) throw new Error("title is required");
  const name = safeDeckSlug((input.slug ?? "").trim() || slugify(title) || "deck");
  const ref: PresentationRef = { ...(input.project ? { project: safeProjectSlug(input.project) } : {}), name };
  const dir = await deckDir(ref);
  if (await fs.stat(dir).catch(() => null)) throw new Error(`presentation "${deckKey(ref)}" already exists`);
  let source: string;
  if (typeof input.source === "string" && input.source.trim()) {
    const deck = parseDeck(input.source);
    if (!deck.title) deck.title = title;
    if (input.template) deck.template = input.template;
    source = serializeDeck(deck);
  } else source = serializeDeck(starterDeck(title, (input.template ?? "default").trim() || "default"));
  await fs.mkdir(path.join(dir, ASSETS_DIR), { recursive: true });
  await fs.writeFile(path.join(dir, DECK_FILE), source, { flag: "wx" });
  changed();
  return (await getDeck(ref))!;
}

/** A save made over a deck.md that changed since the caller read it (an agent, another window). */
export class StaleDeckError extends Error {
  constructor(readonly current: string) {
    super("the presentation changed since you loaded it");
  }
}

export interface SaveDeckInput {
  /** The `updatedAt` the caller's copy was read at; a newer file refuses the save (StaleDeckError). */
  base?: string;
  /** The whole deck.md; wins over the structured fields. */
  source?: string;
  title?: string;
  template?: string;
  size?: "16:9" | "4:3" | null;
  /** false turns the slide numbers off for the deck, true (or null) back on. */
  numbers?: boolean | null;
  /** Replace the slides (the editor sends them all). */
  slides?: SlideDef[];
}

export async function saveDeck(ref: PresentationRef, input: SaveDeckInput): Promise<PresentationDetail> {
  const dir = await deckDir(ref);
  const file = path.join(dir, DECK_FILE);
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) throw new Error(`no presentation "${deckKey(ref)}"`);
  if (input.base) {
    const st = await fs.stat(file);
    const now = new Date(st.mtimeMs).toISOString();
    if (now !== input.base) throw new StaleDeckError(now);
  }
  let next: string;
  if (typeof input.source === "string") {
    parseDeck(input.source); // must parse; the normalised form is not forced on a hand-written file
    next = input.source.endsWith("\n") ? input.source : `${input.source}\n`;
  } else {
    const deck = parseDeck(raw);
    if (input.title !== undefined) deck.title = String(input.title).trim() || deck.title;
    if (input.template !== undefined) deck.template = String(input.template).trim() || "default";
    if (input.size !== undefined) {
      if (input.size === "16:9" || input.size === "4:3") deck.size = input.size;
      else delete deck.size;
    }
    if (input.numbers !== undefined) {
      if (input.numbers === false) deck.numbers = false;
      else delete deck.numbers;
    }
    if (input.slides !== undefined) {
      if (!Array.isArray(input.slides)) throw new Error("slides must be a list");
      deck.slides = input.slides.map((s) => ({
        ...(s.layout ? { layout: String(s.layout) } : {}),
        ...(s.notes?.trim() ? { notes: String(s.notes).trim() } : {}),
        ...(s.background ? { background: String(s.background) } : {}),
        ...(s.transition ? { transition: String(s.transition) } : {}),
        extra: s.extra && typeof s.extra === "object" ? s.extra : {},
        content: String(s.content ?? ""),
      }));
    }
    next = serializeDeck(deck);
  }
  if (next !== raw) await snapshot(dir, raw);
  await fs.writeFile(file, next);
  changed();
  return (await getDeck(ref))!;
}

const ASSET_EXT = /\.(png|jpe?g|gif)$/i;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** Save an uploaded picture into the deck's assets/ (png, jpg, gif; 25 MB). Returns the path a slide references: `assets/<name>`. */
export async function saveAsset(ref: PresentationRef, name: string, body: Readable): Promise<{ path: string; size: number }> {
  const dir = await deckDir(ref);
  if (!(await fs.stat(path.join(dir, DECK_FILE)).catch(() => null))) throw new Error(`no presentation "${deckKey(ref)}"`);
  const clean = path.basename(name).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  if (!ASSET_EXT.test(clean)) throw new Error("a picture must be a .png, .jpg or .gif file");
  const assets = path.join(dir, ASSETS_DIR);
  await fs.mkdir(assets, { recursive: true });
  let final = clean;
  for (let i = 2; await fs.stat(path.join(assets, final)).catch(() => null); i++) final = clean.replace(/(\.[^.]+)$/, `-${i}$1`);
  const tmp = path.join(assets, `.upload-${process.pid}-${Date.now()}`);
  let size = 0;
  body.on("data", (c: Buffer) => {
    size += c.length;
    if (size > MAX_ASSET_BYTES) body.destroy(new Error("picture too large (25 MB at most)"));
  });
  try {
    await pipeline(body, createWriteStream(tmp));
    if (size === 0) throw new Error("empty file");
    await fs.rename(tmp, path.join(assets, final));
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  changed();
  return { path: `${ASSETS_DIR}/${final}`, size };
}

/** Move the deck folder, assets and exports included, to the trash. */
export async function deleteDeck(ref: PresentationRef): Promise<void> {
  const d = await requireDeck(ref);
  await moveToTrash("presentations", deckKey(ref), d.path);
  cache.delete(d.path);
  changed();
}

/* ---------- context for chats and agents ---------- */

const cliScope = (ref: PresentationRef): string => (ref.project ? `--project ${ref.project}` : "");

/**
 * The "## Presentations" block of a project chat (its decks) or the
 * workspace's: what exists, the file format in short, and the CLI.
 */
export async function presentationsContext(project: string | undefined): Promise<string> {
  const view = await listDecks(project).catch(() => ({ enabled: false, presentations: [] as PresentationSummary[] }));
  if (!view.enabled) return "";
  const scope = project ? `--project ${project}` : "";
  const list = view.presentations.length
    ? (await Promise.all(view.presentations.map(async (p) => {
        const open = (await readComments(p.path).catch(() => [] as DeckComment[])).filter((c) => !c.resolved).length;
        return `- ${p.name}: "${p.title}" (${p.slides} slides, template ${p.template})${open ? `, ${open} open comment${open === 1 ? "" : "s"}` : ""}${p.error ? ` — broken: ${p.error}` : ""}`;
      }))).join("\n")
    : "(none yet)";
  // The themes in use, with the pieces and the classes their CSS defines: what an agent reaches for in a slot's HTML.
  const used = [...new Set(view.presentations.map((p) => p.template))];
  const themeLines: string[] = [];
  for (const slug of used.length ? used : ["default"]) {
    const { template } = await templateFor(slug);
    const classes = [...new Set([...(template.cssText ?? "").matchAll(/(?:^|[\s,}])\.([a-z][\w-]*)/g)].map((m) => m[1]))].filter((c) => !/^(deck-|layout-|slot-|kind-)/.test(c)).slice(0, 40);
    themeLines.push(`- theme ${template.slug}${template.path ? ` (${path.dirname(template.path)})` : " (built in)"}: pieces ${template.snippets.map((x) => x.name).join(", ") || "none"}; classes ${classes.map((c) => `.${c}`).join(" ") || "none"}`);
  }
  return (
    `## Presentations${project ? "" : " (workspace)"}\n` +
    `Slide decks are folders with a deck.md: headmatter (title, template, optional css), slides separated by \`---\` lines, an optional YAML block after the separator with \`layout:\` and \`slots:\`. ` +
    `Content before the first \`::slot::\` marker is the title (a leading heading) and the layout's body; named slots are \`::left::\`, \`::image::\`, \`::chart::\` …; \`::notes::\` are the speaker notes. ` +
    `Slides render as HTML in the template's theme (what the editor, present mode, PDF and PNG show), so a slot may hold markdown, raw HTML (the theme's classes: cards, kpis, flow, timeline, callout, compare, cols, statement), a picture \`![caption](assets/file.png)\`, a table, or a fenced \`chart\` block (YAML: kind column|bar|line|pie|doughnut|area, categories, series with name and values). ` +
    `A slide may move or restyle a layout slot, or add boxes of its own, in its YAML head: \`slots: {title: {y: 1.4, size: 40}, box1: {kind: html, x: 1, y: 2, w: 4, h: 2}}\` filled by \`::box1::\` (kinds: text, markdown, image, chart, table, html, embed — embed is a URL or a whole page with scripts, sandboxed; box keys also: color, fill, font, align, valign, bold, italic, underline, rotate, radius, border, borderColor, shadow, opacity, z, fit). Positions are inches on a 10 × 5.625 canvas. \`background:\` takes a color or a picture (assets/x.jpg); \`hidden: true\` keeps a slide out of present mode and the exports.\n` +
    `${list}\n` +
    `${themeLines.join("\n")}\n` +
    `Work with the CLI (${scope ? `${scope} on every command` : "no --project: these are the workspace decks"}):\n` +
    `- \`npx kraftwerk presentations create "<title>" ${scope} --template default\` makes the folder; then write its deck.md directly (it prints the path) and put pictures into assets/\n` +
    `- \`npx kraftwerk presentations show <name> ${scope}\` prints the layouts of the template with their slots, the theme's pieces, and every warning (empty required slot, unknown layout, missing image)\n` +
    `- \`npx kraftwerk presentations check <name> ${scope}\` fails on errors; \`presentations render <name> --png ${scope}\` writes exports/slides/NN.png from the HTML — look at them to judge your slides, then fix the markdown\n` +
    `- Comments: \`npx kraftwerk presentations comments <name> ${scope}\` lists the open ones (slide, box, author); when you have dealt with one, \`presentations resolve <name> <id> --reply "<what you changed>" ${scope}\`; \`presentations comment <name> <slide> "<text>" ${scope}\` leaves one for the humans.\n` +
    `- \`npx kraftwerk presentations render <name> --pptx|--pdf|--html ${scope}\` writes the files a human will open; \`presentations templates\` lists the templates; a template is templates/<slug>/template.yml + theme.css (\`templates init <slug>\` copies the default).\n` +
    `\`presentation:<name>\` in a message, a task's refs or a note points at one of these decks (open the folder it names); link a deck from a task with \`npx kraftwerk tasks set <n> --refs <the existing refs>,presentation:<name>\` (it replaces the list) and write \`presentation:<name>\` in your answers so people can click through.\n` +
    `Keep one message per slide, title slides on the \`title\` layout, never more than six bullets in a body; prefer the theme's pieces over hand-made styling. The humans see the same render you do.`
  );
}

export { cliScope as presentationCliScope };
