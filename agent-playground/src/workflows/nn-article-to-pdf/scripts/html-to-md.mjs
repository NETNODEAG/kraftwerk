// Deterministic HTML -> markdown (turndown + GFM). Reads a file, prints markdown.
// Used for Drupal paragraph bodies, which are rich HTML rather than markdown.
import { readFileSync } from "node:fs";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const file = process.argv[2];
const base = process.argv[3] || "https://netnode.ch";

let html = readFileSync(file, "utf8")
  // editor-injected assets (prism, embeds) carry no content
  .replace(/<script\b[\s\S]*?<\/script>/gi, "")
  .replace(/<style\b[\s\S]*?<\/style>/gi, "")
  .replace(/<link\b[^>]*>/gi, "");

const td = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});
td.use(gfm);

// make relative Drupal links resolvable in a standalone PDF
td.addRule("absoluteLinks", {
  filter: (node) => node.nodeName === "A" && node.getAttribute("href"),
  replacement: (content, node) => {
    const href = node.getAttribute("href");
    const abs = href.startsWith("/") ? base + href : href;
    return content.trim() ? `[${content}](${abs})` : "";
  },
});

process.stdout.write(td.turndown(html).replace(/\n{3,}/g, "\n\n").trim() + "\n");
