import type { LayoutDef, SlotDef, Template } from "./template.js";

/**
 * The pure half of the template engine: canvas, colors, which layout and
 * which slots a slide really has. No imports at runtime — the web editor
 * bundles this file (and html.ts) to draw slides itself; template.ts keeps
 * the schema and the files.
 */

export const SLOT_KINDS = ["text", "markdown", "image", "chart", "table", "html", "embed"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

/** Canvas in inches per aspect ratio. */
export const CANVAS: Record<"16:9" | "4:3", { w: number; h: number }> = { "16:9": { w: 10, h: 5.625 }, "4:3": { w: 10, h: 7.5 } };
/** The HTML stage: 1600 px wide whatever the ratio, so 160 px per inch. */
export const STAGE_W = 1600;
export const PPI = STAGE_W / 10;

/** The colors every template has, whatever it names itself. */
export const BASE_COLORS: Record<string, string> = {
  background: "#F9F9F7",
  surface: "#FFFFFF",
  text: "#161310",
  muted: "#6F6D67",
  accent: "#0284C7",
  onAccent: "#FFFFFF",
  line: "#E1E0D9",
};

/** The layout a slide uses: its own, else the template's default, else the first. */
export function layoutFor(template: Pick<Template, "layouts" | "default">, name: string | undefined): { name: string; layout: LayoutDef } | null {
  const key = name ?? template.default ?? (template.layouts.content ? "content" : Object.keys(template.layouts)[0]);
  const layout = key ? template.layouts[key] : undefined;
  return layout ? { name: key!, layout } : null;
}

/** Where a slide's unmarked content (after its heading) goes: the layout's `default`, else its markdown slot, else its required table/chart/picture slot, else its only other slot, else a text slot. */
export function defaultSlotOf(layout: LayoutDef): string | undefined {
  if (layout.default) return layout.default;
  const others = Object.entries(layout.slots).filter(([k]) => k !== "title");
  return others.find(([, v]) => v.kind === "markdown")?.[0] ?? others.find(([, v]) => v.required && v.kind !== "text")?.[0] ?? (others.length === 1 ? others[0][0] : undefined) ?? others.find(([, v]) => v.kind === "text")?.[0];
}

/** A color name of the template resolved to #RRGGBB (a #hex passes through). Unknown names: null. */
export function resolveColor(template: Pick<Template, "colors">, value: string | undefined, depth = 0): string | null {
  if (!value || depth > 4) return null;
  const v = value.trim();
  if (/^#?[0-9a-f]{6}$/i.test(v)) return v.startsWith("#") ? v.toUpperCase() : `#${v.toUpperCase()}`;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v.slice(1).split("").map((c) => c + c).join("")}`.toUpperCase();
  const named = template.colors[v] ?? BASE_COLORS[v];
  return named ? resolveColor(template, named, depth + 1) : null;
}

/** The template's named colors resolved to #RRGGBB, the base names included. */
export function templateColors(template: Pick<Template, "colors">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of new Set([...Object.keys(BASE_COLORS), ...Object.keys(template.colors)])) {
    const hex = resolveColor(template, name);
    if (hex) out[name] = hex;
  }
  return out;
}

/** A font key (`heading`, `body`) resolved to the family; a family name passes through. */
export const resolveFont = (template: Pick<Template, "fonts">, value: string | undefined): string => (value === "heading" ? template.fonts.heading : value === "body" || !value ? template.fonts.body : value);

/** What a slide may change of a slot (`slots:` in its YAML head). */
export type SlotPatch = Partial<Pick<SlotDef, "kind" | "x" | "y" | "w" | "h" | "size" | "bold" | "italic" | "color" | "font" | "align" | "valign" | "fill" | "underline" | "strike" | "rotate" | "radius" | "border" | "borderColor" | "shadow" | "opacity" | "z" | "fit" | "class">>;

const PATCH_KEYS: Record<string, "number" | "positive" | "boolean" | "string" | "kind" | "align" | "valign"> = {
  kind: "kind",
  x: "number",
  y: "number",
  w: "positive",
  h: "positive",
  size: "positive",
  bold: "boolean",
  italic: "boolean",
  color: "string",
  font: "string",
  align: "align",
  valign: "valign",
  fill: "string",
  class: "string",
  underline: "boolean",
  strike: "boolean",
  rotate: "number",
  radius: "number",
  border: "number",
  borderColor: "string",
  shadow: "boolean",
  opacity: "number",
  z: "number",
  fit: "string",
};

function checkPatch(raw: unknown): { patch: SlotPatch; problem?: string } {
  if (raw === null || raw === undefined) return { patch: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { patch: {}, problem: "must be a mapping" };
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const t = PATCH_KEYS[k];
    if (!t) return { patch: {}, problem: `unknown key "${k}" (one of ${Object.keys(PATCH_KEYS).join(", ")})` };
    const ok =
      t === "number"
        ? typeof v === "number" && Number.isFinite(v)
        : t === "positive"
          ? typeof v === "number" && v > 0
          : t === "boolean"
            ? typeof v === "boolean"
            : t === "string"
              ? typeof v === "string"
              : t === "kind"
                ? (SLOT_KINDS as readonly string[]).includes(v as string)
                : t === "align"
                  ? ["left", "center", "right"].includes(v as string)
                  : ["top", "middle", "bottom"].includes(v as string);
    if (!ok) return { patch: {}, problem: `${k}: ${JSON.stringify(v)} is not valid` };
    patch[k] = v;
  }
  return { patch: patch as SlotPatch };
}

/**
 * The slots a slide really has: its layout's, each with the slide's own
 * changes (`slots: {title: {y: 1.2, size: 44}}` moves and resizes the
 * title on this slide only), plus the slots the slide adds itself
 * (`slots: {text1: {kind: markdown, x, y, w, h}}`, filled by `::text1::`).
 */
export function slideSlots(layout: LayoutDef, overrides: unknown): { slots: Record<string, SlotDef & { own?: boolean; changed?: boolean }>; problems: string[] } {
  const slots: Record<string, SlotDef & { own?: boolean; changed?: boolean }> = { ...layout.slots };
  const problems: string[] = [];
  if (overrides === undefined || overrides === null) return { slots, problems };
  if (typeof overrides !== "object" || Array.isArray(overrides)) return { slots, problems: ["`slots` must be a mapping of slot name to its changes"] };
  for (const [name, raw] of Object.entries(overrides as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9_-]*$/i.test(name)) {
      problems.push(`slot name "${name}" is not valid`);
      continue;
    }
    const { patch, problem } = checkPatch(raw);
    if (problem) {
      problems.push(`slots.${name}: ${problem}`);
      continue;
    }
    const base = layout.slots[name];
    if (base) slots[name] = { ...base, ...patch, changed: true };
    else if (patch.x === undefined || patch.y === undefined || patch.w === undefined || patch.h === undefined) problems.push(`slots.${name}: a slot the layout does not have needs x, y, w and h`);
    else slots[name] = { kind: patch.kind ?? "text", ...patch, own: true } as SlotDef & { own: boolean };
  }
  return { slots, problems };
}
