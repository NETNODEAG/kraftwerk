/**
 * The slots inside a slide's markdown — shared by the deck parser on the
 * server and the editor in the browser (no imports, so the web bundle
 * carries nothing else). Content before the first `::name::` marker is the
 * default content: its leading heading is the title, the rest goes to the
 * layout's default slot. A fence hides markers inside it.
 */

export const NOTES_SLOT = "notes";
/** The default content of a slide: what comes before the first `::slot::` marker. */
export const DEFAULT_SLOT = "_";

const FENCE_RE = /^(`{3,}|~{3,})/;
const SLOT_RE = /^::([a-z][a-z0-9_-]*)::[ \t]*$/i;
const HEADING_RE = /^\s*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/;

export const trimBlank = (s: string): string => s.replace(/^\s*\n/, "").replace(/\s+$/, "");

/** The slots of a slide's content: DEFAULT_SLOT for what precedes the first marker, then one entry per `::name::`. */
export function slotsOf(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current = DEFAULT_SLOT;
  let buf: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const text = trimBlank(buf.join("\n"));
    if (current === DEFAULT_SLOT ? text !== "" : true) out[current] = out[current] ? `${out[current]}\n${text}` : text;
    buf = [];
  };
  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    const f = FENCE_RE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (line.startsWith(fence)) fence = null;
      buf.push(line);
      continue;
    }
    const m = !fence && SLOT_RE.exec(line);
    if (m) {
      flush();
      current = m[1].toLowerCase();
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

/** Content from slots: the default content first, then `::name::` blocks. */
export function joinSlots(slots: Record<string, string>): string {
  const parts: string[] = [];
  if (slots[DEFAULT_SLOT]?.trim()) parts.push(trimBlank(slots[DEFAULT_SLOT]));
  for (const [name, text] of Object.entries(slots)) {
    if (name === DEFAULT_SLOT) continue;
    parts.push(`::${name}::\n${trimBlank(text)}`);
  }
  return parts.join("\n\n");
}

/** The default content split: the leading heading (the title) and what follows it. */
export function splitDefault(text: string | undefined): { heading: string | null; rest: string } {
  const dflt = text ?? "";
  const m = HEADING_RE.exec(dflt);
  if (!m) return { heading: null, rest: trimBlank(dflt) };
  return { heading: m[1], rest: trimBlank(dflt.slice(m[0].length)) };
}

/**
 * What a layout's slot shows for this content: an explicit `::name::` block,
 * else for `title` the leading heading of the default content, else for the
 * layout's default slot the rest of it. `undefined` when nothing fills it.
 */
export function getSlot(content: string, name: string, defaultSlot: string | undefined): string | undefined {
  const slots = slotsOf(content);
  if (slots[name] !== undefined) return slots[name];
  const { heading, rest } = splitDefault(slots[DEFAULT_SLOT]);
  if (name === "title") return heading ?? undefined;
  if (name === defaultSlot && rest) return rest;
  return undefined;
}

/**
 * The content with one slot's text replaced, kept where it was: the title
 * stays the default content's heading, the default slot its rest, anything
 * else its `::name::` block (added at the end when new). Empty text removes
 * the slot.
 */
export function setSlot(content: string, name: string, text: string, defaultSlot: string | undefined): string {
  const slots = slotsOf(content);
  const value = trimBlank(text);
  const { heading, rest } = splitDefault(slots[DEFAULT_SLOT]);
  const writeDefault = (h: string | null, r: string) => {
    const parts = [h ? `# ${h}` : "", r].filter(Boolean);
    if (parts.length) slots[DEFAULT_SLOT] = parts.join("\n\n");
    else delete slots[DEFAULT_SLOT];
  };
  if (slots[name] !== undefined) {
    if (value) slots[name] = value;
    else delete slots[name];
  } else if (name === "title") writeDefault(value ? value.replace(/\n+/g, " ") : null, rest);
  else if (name === defaultSlot) writeDefault(heading, value);
  else if (value) slots[name] = value;
  return joinSlots(slots);
}
