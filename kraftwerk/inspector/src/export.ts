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
  try {
    const detail = (await fetch(`/api/knowledge/${encodeURIComponent(bundle)}`).then((r) =>
      r.json()
    )) as { concepts: ConceptInfo[] };
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
      const body = DOMPurify.sanitize(marked.parse(c.body ?? "", { async: false }));
      return `<article>
        <h1>${escapeHtml(c.title || c.id)}</h1>
        <div class="meta">${escapeHtml(meta)}</div>
        ${body}
      </article>`;
    })
    .join("\n");

  const today = new Date().toISOString().slice(0, 10);
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(bundle)}</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0 auto; padding: 48px 56px; max-width: 760px;
    font: 14px/1.65 -apple-system, "Segoe UI", system-ui, sans-serif; color: #191919;
    background: #fff;
  }
  .no-print {
    position: sticky; top: 0; display: flex; gap: 12px; align-items: center;
    margin: -48px -56px 32px; padding: 12px 56px;
    background: #f4efea; border-bottom: 1px solid #ded6cb; font-size: 13px;
  }
  .no-print button {
    font: inherit; font-weight: 600; padding: 6px 16px; cursor: pointer;
    background: #191919; color: #fff; border: none; border-radius: 999px;
  }
  .cover { margin: 0 0 4px; font-size: 28px; letter-spacing: -0.01em; }
  .cover-sub { color: #5e5b56; font-size: 13px; margin-bottom: 40px; }
  article { page-break-before: always; break-before: page; }
  article:first-of-type { page-break-before: auto; break-before: auto; }
  article h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: -0.01em; }
  article .meta { color: #5e5b56; font-size: 12px; margin-bottom: 18px; }
  h2 { font-size: 16px; margin: 24px 0 8px; }
  h3 { font-size: 14px; margin: 18px 0 6px; }
  a { color: inherit; }
  code { font: 12px/1.5 ui-monospace, monospace; background: #f2ede7; padding: 1px 5px; border-radius: 4px; }
  pre { background: #f2ede7; padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th, td { border: 1px solid #ded6cb; padding: 6px 12px; text-align: left; }
  th { background: #f4efea; }
  blockquote { margin: 12px 0; padding: 2px 16px; border-left: 3px solid #ded6cb; color: #5e5b56; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="no-print">
    <span>Use “Save as PDF” in the print dialog.</span>
    <button onclick="window.print()">print / save as PDF</button>
  </div>
  <h1 class="cover">${escapeHtml(bundle)}</h1>
  <div class="cover-sub">knowledge bundle · ${parts.length} concept${parts.length === 1 ? "" : "s"} · exported ${today}</div>
  ${articles}
  <script>setTimeout(() => window.print(), 400);</script>
</body>
</html>`;

  win.location.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
