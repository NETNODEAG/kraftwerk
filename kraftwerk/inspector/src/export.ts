import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ConceptDetail, ConceptInfo } from "./types";

/**
 * Export a knowledge bundle as PDF: open a print-styled document in a new
 * tab and hand off to the browser's print dialog ("Save as PDF"). No
 * server-side PDF machinery — the browser is the renderer.
 */
export async function exportBundlePdf(bundle: string, conceptId?: string): Promise<void> {
  // Open synchronously inside the click so popup blockers stay quiet; the
  // finished document lands as a blob URL once it's built.
  const win = window.open("", "_blank");
  if (!win) return;
  const label = conceptId ? `${bundle}/${conceptId}` : bundle;
  win.document.write(
    `<title>${escapeHtml(label)}</title><body style="font-family:system-ui;padding:40px;color:#555">preparing ${escapeHtml(label)}…</body>`
  );

  const conceptUrl = (id: string) =>
    `/api/knowledge/${encodeURIComponent(bundle)}/concept?id=${encodeURIComponent(id)}`;
  let parts: ConceptDetail[];
  let workspace = "";
  try {
    const [ids, meta] = await Promise.all([
      conceptId
        ? Promise.resolve([conceptId])
        : (fetch(`/api/knowledge/${encodeURIComponent(bundle)}`).then((r) => r.json()) as Promise<{
            concepts: ConceptInfo[];
          }>).then((d) => d.concepts.map((c) => c.id)),
      fetch("/api/meta")
        .then((r) => r.json() as Promise<{ projectName?: string }>)
        .catch(() => ({}) as { projectName?: string }),
    ]);
    workspace = meta.projectName ?? "";
    parts = await Promise.all(
      ids.map((id) => fetch(conceptUrl(id)).then((r) => r.json()) as Promise<ConceptDetail>)
    );
    if (parts.some((c) => typeof c?.id !== "string")) throw new Error("missing concept");
  } catch {
    win.document.body.textContent = `could not load "${label}"`;
    return;
  }

  const titles: string[] = [];
  const articles = parts
    .map((c) => {
      const meta = [
        c.type,
        c.generated?.at ? `updated ${c.generated.at.slice(0, 10)}` : "",
        c.trustTier === "human-reviewed" ? "human-reviewed" : "",
        (c.tags ?? []).map((t) => `#${t}`).join(" "),
      ]
        .filter(Boolean)
        .join(" · ");
      const { md, notes } = extractFootnotes(wikilinks(c.body ?? "", null));
      // Concepts without a real title fall back to their id/slug — if the
      // body opens with a level-one heading, that is the actual title.
      const titleIsFallback = !c.title || c.title === c.id || c.title === c.id.split("/").pop();
      const { html: body, title } = tidyForPrint(
        DOMPurify.sanitize(marked.parse(md, { async: false })),
        { title: c.title || c.id, meta, titleIsFallback }
      );
      titles.push(title);
      const sources = notes.length
        ? `<ol class="notes">${notes
            .map((n) => `<li id="fn-${escapeHtml(n.id)}">${DOMPurify.sanitize(marked.parseInline(n.text, { async: false }))}</li>`)
            .join("")}</ol>`
        : "";
      return `<article>
        ${body}
        ${sources}
      </article>`;
    })
    .join("\n");

  const today = new Date().toISOString().slice(0, 10);
  const headLeft = workspace ? `${escapeHtml(workspace)} · ${escapeHtml(bundle)}` : escapeHtml(bundle);
  const docTitle = conceptId ? titles[0] || label : bundle;
  // A single concept prints without the bundle cover — its own header is
  // the title; the running header still names workspace + bundle.
  const cover = conceptId
    ? ""
    : `<h1 class="cover">${escapeHtml(bundle)}</h1>
      <div class="cover-sub">${workspace ? `${escapeHtml(workspace)} · ` : ""}knowledge bundle · ${parts.length} concept${parts.length === 1 ? "" : "s"} · exported ${today}</div>`;
  // Print layout: A4, generous margins with a wide right gutter for
  // handwritten notes. The running header lives in a table <thead> — the
  // one construct Chrome/Firefox repeat on every printed page.
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(docTitle)}</title>
<style>
  :root { color-scheme: light; }
  /* Page margins live in the sheet itself (repeating thead/tfoot cells +
     cell padding), not in @page — print dialogs that override or drop CSS
     page margins (macOS system dialog, "Margins: None") then still print
     the intended layout. Top 14mm, right 48mm (notes), bottom 16mm, left 20mm. */
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #e9e5df;
    font: 10pt/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1c1b19;
    font-feature-settings: "kern", "liga", "tnum";
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .no-print {
    position: sticky; top: 0; z-index: 1; display: flex; gap: 12px; align-items: center;
    padding: 10px 24px; background: #f4efea; border-bottom: 1px solid #ded6cb; font-size: 13px;
  }
  .no-print button {
    font: inherit; font-weight: 600; padding: 6px 16px; cursor: pointer;
    background: #191919; color: #fff; border: none; border-radius: 999px;
  }
  /* Screen preview mimics the printed page incl. the note gutter. */
  .sheet {
    width: 210mm; margin: 24px auto; background: #fff;
    border-collapse: separate; border-spacing: 0; box-shadow: 0 2px 12px rgba(0,0,0,.12);
  }
  .sheet > thead > tr > td { padding: 14mm 48mm 0 20mm; vertical-align: top; }
  .sheet > tbody > tr > td { padding: 0 48mm 0 20mm; vertical-align: top; }
  .sheet > tfoot > tr > td { padding: 16mm 0 0; }

  /* Running header */
  .runhead {
    display: flex; justify-content: space-between; gap: 16px;
    font-size: 7.5pt; line-height: 1; color: #6b6660; letter-spacing: 0.08em; text-transform: uppercase;
    padding-bottom: 6px; border-bottom: 0.5pt solid #1c1b19; margin-bottom: 30px;
  }

  /* Cover */
  .cover { margin: 0 0 3px; font-size: 22pt; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; }
  .cover-sub { color: #6b6660; font-size: 8.5pt; margin-bottom: 26px; }

  /* Concept */
  article { margin-top: 36px; }
  article:first-of-type { margin-top: 0; }
  article header { break-inside: avoid; break-after: avoid; margin-bottom: 12px; }
  article h1 { font-size: 16pt; font-weight: 700; margin: 0 0 3px; letter-spacing: -0.015em; line-height: 1.2; }
  article .meta { color: #6b6660; font-size: 8pt; letter-spacing: 0.01em; }

  /* Type scale for body headings (concept body starts at h2 after demotion) */
  h2 { font-size: 13pt; font-weight: 700; letter-spacing: -0.01em; line-height: 1.25; margin: 22px 0 6px; break-after: avoid; }
  h3 { font-size: 11pt; font-weight: 650; line-height: 1.3; margin: 18px 0 4px; break-after: avoid; }
  h4 { font-size: 9.5pt; font-weight: 650; color: #3d3a36; margin: 14px 0 2px; break-after: avoid; }
  h5, h6 { font-size: 10pt; font-weight: 650; margin: 12px 0 2px; }
  h2 + h3, h3 + h4 { margin-top: 6px; }
  .keep { break-inside: avoid; }

  /* Copy */
  p, ul, ol { margin: 0 0 8px; orphans: 3; widows: 3; }
  ul, ol { padding-left: 16px; }
  li { margin: 0 0 3px; padding-left: 2px; }
  li > p { margin: 0; }
  li::marker { color: #8a857e; }
  ul ul, ol ol, ul ol, ol ul { margin: 2px 0 0; }
  strong { font-weight: 650; }
  em { font-style: italic; }
  a { color: inherit; text-decoration-color: #b8b2aa; text-decoration-thickness: 0.5pt; text-underline-offset: 2px; }
  hr { border: 0; border-top: 0.5pt solid #ded6cb; margin: 14px 0; }
  code { font: 8.5pt/1.4 ui-monospace, "SF Mono", Menlo, monospace; background: #f2ede7; padding: 0 3px; border-radius: 3px; }
  pre { background: #f2ede7; padding: 8px 10px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; margin: 4px 0 10px; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 6px 0 10px; padding: 1px 0 1px 12px; border-left: 2px solid #c9c2b8; color: #4d4944; }
  img { max-width: 100%; }
  li:has(> input[type="checkbox"]) { list-style: none; margin-left: -16px; }
  input[type="checkbox"] { width: 9px; height: 9px; margin: 0 6px 0 0; vertical-align: -0.5px; }
  pre, blockquote, table, img { break-inside: avoid; }

  /* Tables: hairline rules, tabular figures, tight leading */
  table.md { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 8.75pt; line-height: 1.35; }
  table.md th, table.md td { padding: 4px 10px 4px 0; text-align: left; vertical-align: top; border-bottom: 0.5pt solid #ded6cb; }
  table.md th:last-child, table.md td:last-child { padding-right: 0; }
  table.md th { font-weight: 650; padding-bottom: 5px; border-top: 0.5pt solid #1c1b19; border-bottom: 0.5pt solid #1c1b19; color: #1c1b19; }
  table.md tr:last-child td { border-bottom: 0.5pt solid #1c1b19; }
  table.md .nw { white-space: nowrap; }

  /* Footnotes */
  .fnref { font-size: 6.5pt; line-height: 0; margin-left: 1px; color: #6b6660; }
  .fnref + .fnref::before { content: ","; }
  .notes { margin: 14px 0 0; padding: 8px 0 0 14px; border-top: 0.5pt solid #ded6cb; font-size: 8pt; line-height: 1.4; color: #6b6660; }
  .notes li { margin: 0 0 2px; }
  @media print {
    body { background: #fff; }
    .no-print { display: none; }
    .sheet { width: 100%; margin: 0; box-shadow: none; }
    .runhead { margin-bottom: 24px; }
  }
</style>
</head>
<body>
  <div class="no-print">
    <span>Use “Save as PDF” in the print dialog.</span>
    <button onclick="window.print()">print / save as PDF</button>
  </div>
  <table class="sheet">
    <thead><tr><td>
      <div class="runhead"><span>${headLeft}</span><span>${today}</span></div>
    </td></tr></thead>
    <tbody><tr><td>
      ${cover}
      ${articles}
    </td></tr></tbody>
    <tfoot><tr><td></td></tr></tfoot>
  </table>
  <script>setTimeout(() => window.print(), 400);</script>
</body>
</html>`;

  win.location.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
}

/**
 * [[page]] / [[page|label]] wikilinks. With a bundle: markdown links to the
 * page within that bundle (ids are paths, "log/2026-09-02" works). With
 * null (print): just the label. Code spans are left alone.
 */
export function wikilinks(md: string, bundle: string | null): string {
  return md
    .split(/(```[\s\S]*?```|`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, id: string, label?: string) => {
            const target = id.trim().replace(/\.md$/, "");
            const text = (label ?? target).trim();
            return bundle === null
              ? text
              : `[${text}](#/knowledge/${encodeURIComponent(bundle)}/${target})`;
          })
    )
    .join("");
}

/**
 * Markdown footnotes ([^id] refs + "[^id]: text" definitions) — marked has no
 * built-in support, so lift them out: refs become numbered superscripts,
 * definitions a "notes" list at the end of the concept.
 */
function extractFootnotes(src: string): { md: string; notes: { id: string; text: string }[] } {
  const notes: { id: string; text: string }[] = [];
  const md = src
    .replace(/^\[\^([^\]]+)\]:[ \t]*(.+)$/gm, (_m, id: string, text: string) => {
      notes.push({ id, text: text.trim() });
      return "";
    })
    .replace(/\[\^([^\]]+)\]/g, (_m, id: string) => {
      const i = notes.findIndex((n) => n.id === id);
      return i >= 0 ? `<sup class="fnref">${i + 1}</sup>` : "";
    });
  return { md, notes };
}

/**
 * Print post-processing of rendered markdown:
 * - tables get the print style and short cells ("CHF 250", "Mon–Fri 9–17")
 *   stay on one line so auto layout doesn't shred them;
 * - every heading is wrapped with the block that follows it, because
 *   Chrome treats `break-after: avoid` as advisory and still strands
 *   headings at the bottom of a page.
 */
function tidyForPrint(
  html: string,
  opts: { title: string; meta: string; titleIsFallback: boolean }
): { html: string; title: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let title = opts.title;
  const first = doc.body.firstElementChild;
  if (opts.titleIsFallback && first?.tagName === "H1") {
    title = first.textContent?.trim() || title;
    first.remove();
  }
  const header = doc.createElement("header");
  header.innerHTML = `<h1>${escapeHtml(title)}</h1><div class="meta">${escapeHtml(opts.meta)}</div>`;
  doc.body.prepend(header);
  for (const t of doc.querySelectorAll("table")) {
    t.classList.add("md");
    for (const cell of t.querySelectorAll("th, td")) {
      if ((cell.textContent ?? "").trim().length <= 14) cell.classList.add("nw");
    }
  }
  // Concept bodies start at "#": demote so the concept title stays the only h1.
  for (const level of [5, 4, 3, 2, 1]) {
    for (const h of Array.from(doc.body.querySelectorAll(`:scope > h${level}`))) {
      const d = doc.createElement(`h${level + 1}`);
      d.innerHTML = h.innerHTML;
      h.replaceWith(d);
    }
  }
  for (const h of Array.from(doc.body.querySelectorAll(":scope > header, :scope > h2, :scope > h3, :scope > h4"))) {
    const next = h.nextElementSibling;
    if (!next || /^H[1-6]$/.test(next.tagName)) continue;
    const keep = doc.createElement("div");
    keep.className = "keep";
    h.replaceWith(keep);
    keep.append(h, next);
  }
  return { html: doc.body.innerHTML, title };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
