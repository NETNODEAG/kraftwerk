import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import * as z from "zod";
import { SLUG_RE } from "../slug.js";

/**
 * The template engine: a template names the canvas, the fonts and the
 * colors, and defines layouts — each a set of named slots placed on the
 * canvas in inches, plus decorative shapes behind them. A slide picks a
 * layout and fills its slots with markdown; the renderer draws exactly
 * what the layout says. One template (`default`) is built in; a workspace
 * adds its own as `templates/<slug>/template.yml` under the presentations
 * root with the same schema, and agents can write those too.
 */

import { SLOT_KINDS, CANVAS } from "./layout.js";

export { SLOT_KINDS, CANVAS, BASE_COLORS, PPI, STAGE_W, layoutFor, defaultSlotOf, resolveColor, resolveFont, slideSlots, templateColors, type SlotKind, type SlotPatch } from "./layout.js";

const Color = z.string().min(1);
const Box = { x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() };

const Slot = z.object({
  kind: z.enum(SLOT_KINDS).default("markdown"),
  ...Box,
  /** Font size in points (text, markdown, table cells). */
  size: z.number().positive().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  /** A color name of the template (text, accent, …) or #hex. */
  color: Color.optional(),
  /** `heading`, `body` or a font family name. */
  font: z.string().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(),
  /** The box's own background (a color name or #hex). */
  fill: Color.optional(),
  /** A slide using the layout must fill it; the check reports it otherwise. */
  required: z.boolean().optional(),
  /** What the slot shows when empty (the renderer leaves it out; the editor hints it). */
  placeholder: z.string().optional(),
  /** CSS classes of the slot's box in the HTML render (the theme styles them: `eyebrow`, `statement`, …). */
  class: z.string().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  /** Degrees, clockwise. */
  rotate: z.number().optional(),
  /** Corner radius in points. */
  radius: z.number().min(0).optional(),
  /** Border width in points, and its color (a name of the template or #hex). */
  border: z.number().min(0).optional(),
  borderColor: Color.optional(),
  shadow: z.boolean().optional(),
  /** 0 to 1. */
  opacity: z.number().min(0).max(1).optional(),
  /** Stacking: higher is in front. Default: the order of the slots. */
  z: z.number().optional(),
  /** A picture: `contain` (default) or `cover` the box. */
  fit: z.enum(["contain", "cover"]).optional(),
});
export type SlotDef = z.output<typeof Slot>;

const Shape = z.object({
  kind: z.enum(["rect", "line"]).default("rect"),
  ...Box,
  fill: Color.optional(),
  color: Color.optional(),
  /** Line width in points. */
  width: z.number().positive().optional(),
});
export type ShapeDef = z.output<typeof Shape>;

const Layout = z.object({
  /** The slide background (a color name or #hex); the template's `background` otherwise. */
  background: Color.optional(),
  shapes: z.array(Shape).default([]),
  slots: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/i), Slot),
  /** The slot the slide's unmarked content goes into; the first markdown slot otherwise. */
  default: z.string().optional(),
  /** What the layout is for, shown in the editor's layout picker. */
  description: z.string().optional(),
});
export type LayoutDef = z.output<typeof Layout>;

export const TemplateSchema = z.object({
  name: z.string().min(1),
  size: z.enum(["16:9", "4:3"]).default("16:9"),
  fonts: z.object({ heading: z.string().default("Calibri"), body: z.string().default("Calibri") }).default({ heading: "Calibri", body: "Calibri" }),
  colors: z.record(z.string(), Color).default({}),
  layouts: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), Layout),
  /** The layout of a slide that names none. Default: `content` when it exists, else the first. */
  default: z.string().optional(),
  /** The theme stylesheet, relative to the template folder (default: theme.css when it exists). It styles the HTML slides; fonts and pictures it names sit beside it. */
  css: z.string().optional(),
  /** Ready-made pieces for the editor's insert menu: cards, figures, a flow — HTML (or markdown) that the theme styles. */
  snippets: z.array(z.object({ name: z.string().min(1), description: z.string().optional(), kind: z.enum(["html", "markdown"]).default("html"), content: z.string(), w: z.number().positive().default(8), h: z.number().positive().default(2.4) })).default([]),
});
export type TemplateDef = z.output<typeof TemplateSchema>;
export type Snippet = TemplateDef["snippets"][number];

export interface Template extends TemplateDef {
  slug: string;
  /** The file it came from; absent for the built-in one. */
  path?: string;
  builtin?: boolean;
  /** The theme stylesheet's text, as read (its relative URLs point into the template folder). */
  cssText?: string;
}

export { DEFAULT_TEMPLATE, DEFAULT_CSS } from "./builtin.js";
import { DEFAULT_TEMPLATE } from "./builtin.js";

export const TEMPLATES_DIR = "templates";
export const TEMPLATE_FILE = "template.yml";

/** Parse a template.yml's text. Throws with the field that is wrong. */
export function parseTemplate(slug: string, raw: string, file?: string): Template {
  const data = parse(raw);
  const r = TemplateSchema.safeParse(data);
  if (!r.success) throw new Error(`${file ?? slug}: ${z.prettifyError(r.error)}`);
  for (const [name, layout] of Object.entries(r.data.layouts)) {
    if (layout.default && !layout.slots[layout.default]) throw new Error(`${file ?? slug}: layout "${name}" names default slot "${layout.default}" which it does not define`);
  }
  if (r.data.default && !r.data.layouts[r.data.default]) throw new Error(`${file ?? slug}: default layout "${r.data.default}" is not defined`);
  return { ...r.data, slug, ...(file ? { path: file } : {}) };
}

export interface TemplateSummary {
  slug: string;
  name: string;
  size: "16:9" | "4:3";
  layouts: string[];
  builtin?: boolean;
  path?: string;
  /** Set when the file exists but cannot be used. */
  error?: string;
}

/** The workspace's templates (templates/<slug>/template.yml under the root), unusable ones with their error. */
export async function loadWorkspaceTemplates(root: string): Promise<{ templates: Template[]; errors: TemplateSummary[] }> {
  const dir = path.join(root, TEMPLATES_DIR);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const templates: Template[] = [];
  const errors: TemplateSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue;
    const file = path.join(dir, e.name, TEMPLATE_FILE);
    const raw = await fs.readFile(file, "utf8").catch(() => null);
    if (raw === null) continue;
    try {
      const t = parseTemplate(e.name, raw, file);
      const css = await fs.readFile(path.join(dir, e.name, t.css ?? "theme.css"), "utf8").catch(() => null);
      if (css !== null) t.cssText = css;
      else if (t.css) throw new Error(`${file}: css "${t.css}" does not exist`);
      templates.push(t);
    } catch (err) {
      errors.push({ slug: e.name, name: e.name, size: "16:9", layouts: [], path: file, error: (err as Error).message });
    }
  }
  templates.sort((a, b) => a.slug.localeCompare(b.slug));
  return { templates, errors };
}

export const templateSummary = (t: Template): TemplateSummary => ({ slug: t.slug, name: t.name, size: t.size, layouts: Object.keys(t.layouts), ...(t.builtin ? { builtin: true } : {}), ...(t.path ? { path: t.path } : {}) });

/** The YAML of the built-in template, for `presentations templates init` and the docs. */
export function defaultTemplateYaml(): string {
  const { slug: _s, builtin: _b, path: _p, cssText: _c, ...def } = DEFAULT_TEMPLATE;
  // A readable file: the layouts keep their key order; zod defaults are written out so the file is complete.
  return `# A kraftwerk presentation template — copy of the built-in "default".\n# Positions are inches on a ${def.size} canvas (${CANVAS[def.size].w} x ${CANVAS[def.size].h}); colors are names from \`colors\` or #hex.\n${stringify(def)}`;
}
