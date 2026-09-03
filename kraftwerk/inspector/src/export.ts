import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ConceptDetail, ConceptInfo } from "./types";

/**
 * Export a knowledge bundle as PDF: open a print-styled document in a new
 * tab and hand off to the browser's print dialog ("Save as PDF"). No
 * server-side PDF machinery — the browser is the renderer.
 */
export async function exportBundlePdf(bundle: string): Promise<void> {
  // Open synchronously inside the click so popup blockers stay quiet; the
  // finished document lands as a blob URL once it's built.
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(
    `<title>${escapeHtml(bundle)}</title><body style="font-family:system-ui;padding:40px;color:#555">preparing ${escapeHtml(bundle)}…</body>`
  );

  let parts: ConceptDetail[];
  let workspace = "";
  try {
    const [detail, meta] = await Promise.all([
      fetch(`/api/knowledge/${encodeURIComponent(bundle)}`).then((r) => r.json()) as Promise<{
        concepts: ConceptInfo[];
      }>,
      fetch("/api/meta")
        .then((r) => r.json() as Promise<{ projectName?: string }>)
        .catch(() => ({}) as { projectName?: string }),
    ]);
    workspace = meta.projectName ?? "";
    parts = await Promise.all(
      detail.concepts.map(
        (c) =>
          fetch(
            `/api/knowledge/${encodeURIComponent(bundle)}/concept?id=${encodeURIComponent(c.id)}`
          ).then((r) => r.json()) as Promise<ConceptDetail>
      )
    );
  } catch {
    win.document.body.textContent = `could not load bundle "${bundle}"`;
    return;
  }

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
      const { md, notes } = extractFootnotes(c.body ?? "");
      const header = `<header>
          <h1>${escapeHtml(c.title || c.id)}</h1>
          <div class="meta">${escapeHtml(meta)}</div>
        </header>`;
      const body = tidyForPrint(
        header + DOMPurify.sanitize(marked.parse(md, { async: false }))
      );
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
  // Print layout: A4, generous margins with a wide right gutter for
  // handwritten notes. The running header lives in a table <thead> — the
  // one construct Chrome/Firefox repeat on every printed page.
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(bundle)}</title>
<style>
  :root { color-scheme: light; }
  @page { size: A4; margin: 16mm 48mm 18mm 20mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #e9e5df;
    font: 10.5pt/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; color: #191919;
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
    width: 210mm; margin: 24px auto; padding: 16mm 48mm 18mm 20mm; background: #fff;
    border-collapse: separate; border-spacing: 0; box-shadow: 0 2px 12px rgba(0,0,0,.12);
  }
  .sheet > thead > tr > td, .sheet > tbody > tr > td { padding: 0; vertical-align: top; }
  .runhead {
    display: flex; justify-content: space-between; gap: 16px;
    font-size: 8.5pt; color: #5e5b56; letter-spacing: 0.02em; text-transform: uppercase;
    padding-bottom: 4px; border-bottom: 1px solid #191919; margin-bottom: 14px;
  }
  .cover { margin: 0 0 2px; font-size: 20pt; letter-spacing: -0.01em; line-height: 1.2; }
  .cover-sub { color: #5e5b56; font-size: 9pt; margin-bottom: 18px; }
  article { margin-top: 30px; }
  article:first-of-type { margin-top: 0; }
  article header { break-inside: avoid; break-after: avoid; }
  article h1 { font-size: 15pt; margin: 0 0 1px; letter-spacing: -0.01em; line-height: 1.25; }
  article .meta { color: #5e5b56; font-size: 8.5pt; margin-bottom: 10px; }
  .keep { break-inside: avoid; }
  h2 { font-size: 12pt; margin: 14px 0 4px; break-after: avoid; }
  h3 { font-size: 10.5pt; margin: 10px 0 3px; break-after: avoid; }
  h4 { font-size: 10.5pt; font-weight: 600; font-style: italic; margin: 8px 0 2px; }
  p, ul, ol { margin: 0 0 7px; }
  li { margin: 0 0 2px; }
  a { color: inherit; text-decoration-color: #b8b2aa; text-underline-offset: 2px; }
  ul, ol { padding-left: 18px; }
  hr { border: 0; border-top: 1px solid #ded6cb; margin: 10px 0; }
  code { font: 9pt/1.4 ui-monospace, monospace; background: #f2ede7; padding: 0 4px; border-radius: 3px; }
  pre { background: #f2ede7; padding: 8px 10px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; margin: 0 0 8px; }
  pre code { background: none; padding: 0; }
  table.md { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 9pt; line-height: 1.35; }
  table.md th, table.md td { padding: 4px 10px 4px 0; text-align: left; vertical-align: top; border-bottom: 1px solid #e6e0d8; }
  table.md th { font-weight: 600; border-bottom: 1px solid #191919; }
  table.md .nw { white-space: nowrap; }
  table.md tr:last-child td { border-bottom: 1px solid #191919; }
  .fnref { font-size: 7pt; line-height: 0; margin-left: 1px; }
  .fnref + .fnref::before { content: ","; }
  .notes { margin: 12px 0 0; padding: 8px 0 0 16px; border-top: 1px solid #ded6cb; font-size: 8.5pt; color: #5e5b56; }
  .notes li { margin: 0 0 1px; }
  blockquote { margin: 8px 0; padding: 1px 12px; border-left: 3px solid #ded6cb; color: #5e5b56; }
  img { max-width: 100%; }
  pre, blockquote, table, img { break-inside: avoid; }
  @media print {
    body { background: #fff; }
    .no-print { display: none; }
    .sheet { width: 100%; margin: 0; padding: 0; box-shadow: none; }
    .runhead { margin-bottom: 10px; }
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
      <h1 class="cover">${escapeHtml(bundle)}</h1>
      <div class="cover-sub">${workspace ? `${escapeHtml(workspace)} · ` : ""}knowledge bundle · ${parts.length} concept${parts.length === 1 ? "" : "s"} · exported ${today}</div>
      ${articles}
    </td></tr></tbody>
  </table>
  <script>setTimeout(() => window.print(), 400);</script>
</body>
</html>`;

  win.location.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
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
function tidyForPrint(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
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
  return doc.body.innerHTML;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
