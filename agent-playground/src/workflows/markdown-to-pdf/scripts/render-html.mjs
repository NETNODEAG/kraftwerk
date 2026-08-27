// Deterministic markdown -> styled HTML renderer (marked, no LLM).
// Run from the runDir: reads inputs.json + inputs/, writes document.html.
// Multiple files become one document; each file starts on a new PDF page.
// Layout: Swiss typographic style — asymmetric book margins (wide right-hand
// white space), NETNODE wordmark as masthead, hairline rules, no decoration.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

const scriptDir = dirname(fileURLToPath(import.meta.url));

// NETNODE wordmark, inlined so the PDF has no external asset dependency.
const logo = readFileSync(join(scriptDir, "..", "assets", "netnode-logo.svg"), "utf8")
  .replace(/\sclass="[^"]*"/, "")
  .replace(/^\s*<svg /, '<svg class="mark" ');

const manifest = JSON.parse(readFileSync("inputs.json", "utf8"));

const sections = manifest.files.map((f) => {
  const md = readFileSync(`inputs/${f.name}`, "utf8");
  const title =
    md.match(/^#\s+(.+)$/m)?.[1].trim() ??
    f.name.replace(/^\d+-/, "").replace(/\.(md|markdown|mdown)$/i, "");
  return { title, html: marked.parse(md) };
});

const docTitle = sections.length === 1 ? sections[0].title : "Documents";

const masthead = `<header class="masthead">${logo}</header>`;

const toc =
  sections.length > 1
    ? `<nav class="toc">${masthead}<h2>Inhalt</h2><ol>${sections
        .map((s, i) => `<li><a href="#section-${i + 1}">${s.title}</a></li>`)
        .join("")}</ol></nav>`
    : "";

const body = sections
  .map(
    (s, i) =>
      `<section id="section-${i + 1}" class="doc">${masthead}${s.html}</section>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${docTitle}</title>
<style>
  /* Book-style asymmetric page: narrow spine-side margin, wide outer
     white space on the right — the reading measure stays around 65 characters. */
  @page { size: A4; margin: 20mm 52mm 22mm 26mm; }

  :root {
    --ink: #111315;
    --muted: #6a7075;
    --rule: #d7dade;
    --hairline: #b9bec3;
    --accent: #0284c7;   /* NETNODE blue */
    --code-bg: #f4f5f6;
  }

  * { box-sizing: border-box; }

  html { font-size: 10.5pt; }

  body {
    margin: 0;
    color: var(--ink);
    font-family: "Helvetica Neue", "Neue Haas Grotesk Display", Helvetica, Inter, Arial, sans-serif;
    font-weight: 400;
    line-height: 1.62;
    font-variant-numeric: tabular-nums;
    font-kerning: normal;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
    /* Swiss rule: flush left, ragged right. Never justified, never hyphenated. */
    text-align: left;
    hyphens: none;
  }

  /* ---- masthead ------------------------------------------------------- */
  .masthead {
    display: flex;
    align-items: flex-end;
    padding-bottom: 3.2mm;
    margin-bottom: 9mm;
    border-bottom: 0.6pt solid var(--ink);
  }
  .mark { display: block; width: 30mm; height: auto; }

  /* ---- headings ------------------------------------------------------- */
  h1, h2, h3, h4 {
    font-weight: 600;
    break-after: avoid; page-break-after: avoid;
    text-wrap: balance;
  }
  h1 {
    font-size: 25pt;
    line-height: 1.1;
    letter-spacing: -0.022em;
    margin: 0 0 6mm;
    max-width: 26em;
  }
  h2 {
    font-size: 12.5pt;
    line-height: 1.25;
    letter-spacing: -0.012em;
    margin: 9mm 0 2.6mm;
    padding-top: 2.4mm;
    border-top: 0.5pt solid var(--rule);
  }
  h3 {
    font-size: 11pt;
    line-height: 1.3;
    letter-spacing: -0.008em;
    margin: 6mm 0 1.6mm;
  }
  h4 {
    font-size: 8.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--muted);
    margin: 6mm 0 1.4mm;
  }

  /* ---- body text ------------------------------------------------------ */
  p { margin: 0 0 3.4mm; orphans: 2; widows: 2; }
  strong { font-weight: 600; }
  em { font-style: italic; }

  /* Standfirst: the italic meta line and the lead paragraph right after h1. */
  h1 + p > em:only-child {
    font-style: normal;
    font-size: 8.5pt;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--muted);
  }

  blockquote {
    margin: 0 0 6mm;
    padding: 0 0 0 5mm;
    border-left: 1.2pt solid var(--accent);
    font-size: 12pt;
    line-height: 1.45;
    letter-spacing: -0.006em;
    color: #2b2f33;
    break-inside: avoid;
  }
  blockquote p:last-child { margin-bottom: 0; }

  /* ---- lists: hanging marks, no indent drift ------------------------- */
  ul, ol { margin: 0 0 3.8mm; padding-left: 0; list-style: none; }
  li { margin: 0 0 1.5mm; padding-left: 6mm; position: relative; }
  ul > li::before {
    content: "";
    position: absolute;
    left: 0; top: 0.68em;
    width: 2.4mm; height: 0.9pt;
    background: var(--accent);
  }
  ol { counter-reset: item; }
  ol > li::before {
    content: counter(item) ".";
    counter-increment: item;
    position: absolute; left: 0; top: 0;
    font-size: 9pt; color: var(--muted);
  }
  li > ul, li > ol { margin: 1.5mm 0 0; }

  /* ---- links ---------------------------------------------------------- */
  a { color: var(--ink); text-decoration: none; border-bottom: 0.5pt solid var(--hairline); }
  /* Link lists print their target underneath — inline links in running text
     stay clean, so sentences are not torn apart by a URL. */
  li > a[href^="http"] { border-bottom: 0; font-weight: 500; }
  li > a[href^="http"]:only-child::after {
    content: attr(href);
    display: block;
    font-size: 7.5pt;
    line-height: 1.35;
    letter-spacing: 0.01em;
    color: var(--muted);
    word-break: break-all;
  }

  /* ---- rules, code, tables ------------------------------------------- */
  hr { border: 0; border-top: 0.5pt solid var(--rule); margin: 9mm 0 4mm; }

  code {
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.86em;
    background: var(--code-bg);
    padding: 0.08em 0.32em;
    border-radius: 2px;
  }
  pre {
    background: var(--code-bg);
    border-left: 1.2pt solid var(--ink);
    padding: 3.4mm 4mm;
    margin: 0 0 4mm;
    break-inside: avoid;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  pre code { background: none; padding: 0; font-size: 7.8pt; line-height: 1.5; }

  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0 0 4mm;
    font-size: 9pt;
    line-height: 1.45;
  }
  /* Swiss table: horizontal hairlines only, no cages. */
  th {
    text-align: left;
    font-size: 7.8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--muted);
    padding: 0 3mm 1.6mm 0;
    border-bottom: 0.6pt solid var(--ink);
  }
  td { padding: 1.8mm 3mm 1.8mm 0; border-bottom: 0.4pt solid var(--rule); vertical-align: top; }
  th:last-child, td:last-child { padding-right: 0; }
  tr { break-inside: avoid; }

  img { max-width: 100%; height: auto; }

  /* ---- pagination ----------------------------------------------------- */
  .toc { break-after: page; page-break-after: always; }
  .toc h2 { border: 0; padding-top: 0; margin-top: 0; }
  .toc ol > li { padding-left: 8mm; margin-bottom: 2.2mm; }
  section.doc + section.doc { break-before: page; page-break-before: always; }
</style>
</head>
<body>
${toc}
${body}
</body>
</html>
`;

writeFileSync("document.html", html);
console.log(`document.html rendered (${sections.length} section(s))`);
