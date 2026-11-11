import DOMPurify from "dompurify";

/**
 * Between what a slide shows and what deck.md keeps: the HTML a slot was
 * typed into (contentEditable on the slide) back to markdown, and the
 * sanitizing every slot's HTML goes through before it is shown.
 */

/** Slot HTML as the editor may show it: markup, inline styles, SVG; no scripts, no frames, no handlers. */
export function clean(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true, svgFilters: true }, ADD_ATTR: ["target", "data-src"], FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base", "meta", "link"] });
}

/** Can this markdown be typed on the slide and written back without loss? Raw HTML, fences and pictures go to the source editor instead. */
export const richEditable = (md: string | undefined): boolean => !md || !/```|~~~|<[a-z!][^>]*>|!\[/i.test(md);

const esc = (s: string): string => s.replace(/\|/g, "\\|");

/** The inline markdown of a node's children: bold, italic, code, links, line breaks. */
function inlineMd(node: Node): string {
  let out = "";
  for (const n of Array.from(node.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) {
      out += (n.textContent ?? "").replace(/ /g, " ");
      continue;
    }
    if (!(n instanceof HTMLElement)) continue;
    const tag = n.tagName;
    if (tag === "UL" || tag === "OL") continue; // nested lists are blocks of their own
    const inner = inlineMd(n);
    const wrap = (mark: string) => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
      return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
    };
    if (tag === "BR") out += "\n";
    else if (tag === "B" || tag === "STRONG" || (tag === "SPAN" && /bold|[6-9]00/.test(n.style.fontWeight))) out += wrap("**");
    else if (tag === "I" || tag === "EM" || (tag === "SPAN" && n.style.fontStyle === "italic")) out += wrap("*");
    else if (tag === "CODE") out += wrap("`");
    else if (tag === "A" && n.getAttribute("href")) out += `[${inner}](${n.getAttribute("href")})`;
    else if (tag === "IMG") out += `![${n.getAttribute("alt") ?? ""}](${n.getAttribute("data-src") ?? n.getAttribute("src") ?? ""})`;
    else out += inner;
  }
  return out;
}

function listMd(el: HTMLElement, depth: number): string[] {
  const lines: string[] = [];
  let n = 0;
  for (const li of Array.from(el.children)) {
    if (li.tagName !== "LI") continue;
    n++;
    const text = inlineMd(li).replace(/\s*\n\s*/g, " ").trim();
    lines.push(`${"  ".repeat(depth)}${el.tagName === "OL" ? `${n}.` : "-"} ${text}`);
    for (const sub of Array.from(li.children)) if (sub.tagName === "UL" || sub.tagName === "OL") lines.push(...listMd(sub as HTMLElement, depth + 1));
  }
  return lines;
}

function tableMd(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map((c) => esc(inlineMd(c).replace(/\s*\n\s*/g, " ").trim())));
  if (!rows.length) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(cols - r.length).fill("")];
  const [head, ...body] = rows.map(pad);
  return [`| ${head.join(" | ")} |`, `|${Array(cols).fill("---").join("|")}|`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

/** What was typed, as markdown again: paragraphs, headings, lists with their nesting, tables. */
export function htmlToMd(root: HTMLElement, inline: boolean): string {
  if (inline) return inlineMd(root).replace(/\s*\n\s*/g, " ").trim();
  const blocks: string[] = [];
  let loose = "";
  const flush = () => {
    if (loose.trim()) blocks.push(loose.trim());
    loose = "";
  };
  for (const n of Array.from(root.childNodes)) {
    if (n instanceof HTMLElement && /^(P|DIV|H[1-6]|UL|OL|TABLE|BLOCKQUOTE)$/.test(n.tagName)) {
      flush();
      if (n.tagName === "UL" || n.tagName === "OL") blocks.push(listMd(n, 0).join("\n"));
      else if (n.tagName === "TABLE") blocks.push(tableMd(n));
      else if (n.tagName === "BLOCKQUOTE") blocks.push(`> ${inlineMd(n).trim().replace(/\n/g, "\n> ")}`);
      else {
        const nested = Array.from(n.children).filter((c) => c.tagName === "UL" || c.tagName === "OL" || c.tagName === "TABLE");
        const text = inlineMd(n).trim();
        if (text) blocks.push(/^H[1-6]$/.test(n.tagName) ? `${"#".repeat(Number(n.tagName[1]))} ${text.replace(/\n/g, " ")}` : text);
        for (const sub of nested) blocks.push(sub.tagName === "TABLE" ? tableMd(sub as HTMLElement) : listMd(sub as HTMLElement, 0).join("\n"));
      }
    } else if (n.nodeType === Node.TEXT_NODE) loose += (n.textContent ?? "").replace(/ /g, " ");
    else if (n instanceof HTMLElement) loose += n.tagName === "BR" ? "\n" : inlineMd(Object.assign(document.createElement("span"), { innerHTML: n.outerHTML }));
  }
  flush();
  return blocks.filter(Boolean).join("\n\n");
}
