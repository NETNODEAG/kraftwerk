import { lexer, type Token, type Tokens } from "marked";

/**
 * The markdown a slot holds, read into blocks the renderer can place on a
 * slide: paragraphs and headings as runs, lists as items with a level, an
 * image, a table, a fenced `chart` block. The subset is what a slide can
 * show — anything else (blockquotes, html, horizontal rules) becomes a
 * paragraph of its text, so nothing silently disappears.
 */

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
}

export interface ListItem {
  level: number;
  ordered: boolean;
  runs: Run[];
}

export type Block =
  | { kind: "heading"; level: number; runs: Run[] }
  | { kind: "paragraph"; runs: Run[] }
  | { kind: "list"; items: ListItem[] }
  | { kind: "image"; src: string; alt: string }
  | { kind: "table"; rows: Run[][][] }
  | { kind: "chart"; source: string }
  | { kind: "code"; lang: string; text: string };

export function parseMarkdown(md: string): Block[] {
  const out: Block[] = [];
  for (const t of lexer(md, { gfm: true })) out.push(...blockOf(t));
  return out;
}

/** The runs of a one-line slot (a title): the first block's runs, headings included. */
export function inlineRuns(md: string): Run[] {
  const runs: Run[] = [];
  for (const b of parseMarkdown(md)) {
    if (b.kind === "heading" || b.kind === "paragraph") {
      if (runs.length) runs.push({ text: " " });
      runs.push(...b.runs);
    } else if (b.kind === "list") {
      for (const item of b.items) {
        if (runs.length) runs.push({ text: " " });
        runs.push(...item.runs);
      }
    }
  }
  return runs;
}

/** The plain text of runs. */
export const plain = (runs: Run[]): string => runs.map((r) => r.text).join("");

function blockOf(t: Token): Block[] {
  switch (t.type) {
    case "heading":
      return [{ kind: "heading", level: (t as Tokens.Heading).depth, runs: inline((t as Tokens.Heading).tokens) }];
    case "paragraph": {
      const p = t as Tokens.Paragraph;
      const only = p.tokens.filter((x) => !(x.type === "text" && !(x as Tokens.Text).text.trim()));
      if (only.length === 1 && only[0].type === "image") {
        const img = only[0] as Tokens.Image;
        return [{ kind: "image", src: img.href, alt: img.text ?? "" }];
      }
      return [{ kind: "paragraph", runs: inline(p.tokens) }];
    }
    case "list":
      return [{ kind: "list", items: listItems(t as Tokens.List, 0) }];
    case "table": {
      const tb = t as Tokens.Table;
      const rows: Run[][][] = [tb.header.map((c) => inline(c.tokens)), ...tb.rows.map((r) => r.map((c) => inline(c.tokens)))];
      return [{ kind: "table", rows }];
    }
    case "code": {
      const c = t as Tokens.Code;
      if ((c.lang ?? "").trim().toLowerCase() === "chart") return [{ kind: "chart", source: c.text }];
      return [{ kind: "code", lang: (c.lang ?? "").trim(), text: c.text }];
    }
    case "blockquote":
      return (t as Tokens.Blockquote).tokens.flatMap(blockOf);
    case "html":
    case "text": {
      const text = ((t as Tokens.HTML | Tokens.Text).text ?? "").trim();
      return text ? [{ kind: "paragraph", runs: [{ text }] }] : [];
    }
    case "space":
    case "hr":
    case "def":
      return [];
    default: {
      const text = ("raw" in t ? String(t.raw) : "").trim();
      return text ? [{ kind: "paragraph", runs: [{ text }] }] : [];
    }
  }
}

function listItems(list: Tokens.List, level: number): ListItem[] {
  const out: ListItem[] = [];
  for (const item of list.items) {
    const runs: Run[] = [];
    const nested: ListItem[] = [];
    for (const t of item.tokens) {
      if (t.type === "list") nested.push(...listItems(t as Tokens.List, level + 1));
      else if (t.type === "text" || t.type === "paragraph") {
        if (runs.length) runs.push({ text: " " });
        runs.push(...inline((t as Tokens.Text).tokens ?? [{ type: "text", raw: (t as Tokens.Text).text, text: (t as Tokens.Text).text } as Tokens.Text]));
      } else {
        for (const b of blockOf(t)) {
          if (b.kind === "paragraph" || b.kind === "heading") {
            if (runs.length) runs.push({ text: " " });
            runs.push(...b.runs);
          }
        }
      }
    }
    out.push({ level, ordered: !!list.ordered, runs });
    out.push(...nested);
  }
  return out;
}

function inline(tokens: Token[] | undefined, base: Omit<Run, "text"> = {}): Run[] {
  const runs: Run[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text":
      case "escape": {
        const text = unescapeHtml((t as Tokens.Text).text);
        if ((t as Tokens.Text).tokens?.length) runs.push(...inline((t as Tokens.Text).tokens, base));
        else if (text) runs.push({ ...base, text });
        break;
      }
      case "strong":
        runs.push(...inline((t as Tokens.Strong).tokens, { ...base, bold: true }));
        break;
      case "em":
        runs.push(...inline((t as Tokens.Em).tokens, { ...base, italic: true }));
        break;
      case "del":
        runs.push(...inline((t as Tokens.Del).tokens, base));
        break;
      case "codespan":
        runs.push({ ...base, code: true, text: unescapeHtml((t as Tokens.Codespan).text) });
        break;
      case "link": {
        const l = t as Tokens.Link;
        runs.push(...inline(l.tokens, { ...base, href: l.href }));
        break;
      }
      case "image":
        runs.push({ ...base, text: (t as Tokens.Image).text || (t as Tokens.Image).href });
        break;
      case "br":
        runs.push({ ...base, text: "\n" });
        break;
      case "html":
        runs.push({ ...base, text: (t as Tokens.HTML).text });
        break;
      default:
        if ("raw" in t && t.raw) runs.push({ ...base, text: String(t.raw) });
    }
  }
  return mergeRuns(runs);
}

/** Adjacent runs with the same format become one, so a sentence is one run, not a run per word. */
function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !!last.bold === !!r.bold && !!last.italic === !!r.italic && !!last.code === !!r.code && last.href === r.href) last.text += r.text;
    else out.push({ ...r });
  }
  return out.filter((r) => r.text !== "");
}

const unescapeHtml = (s: string): string => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
