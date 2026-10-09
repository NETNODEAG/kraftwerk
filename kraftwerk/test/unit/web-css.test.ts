import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The inspector's few stylesheets stay small and true: everything a
 * component looks like is in its Tailwind utilities, so a rule in
 * shell.css, prose.css, editor.css or styles.css whose class no source file
 * mentions any more is dead weight, and a `var(--…)` nobody defines is a
 * colour that silently falls back to nothing (the old Material roles).
 */
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/src");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const all = files(src);
const read = (f: string): string => readFileSync(f, "utf8");
const sheets = all.filter((f) => f.endsWith(".css"));
const code = all.filter((f) => /\.(tsx?|html)$/.test(f)).map(read).join("\n") + read(path.join(src, "../index.html"));

/** Classes the editor library and CodeMirror put on their own markup. */
const THIRD_PARTY = /^(cm-|mdxeditor|_codeMirror|codeMirror)/;
/** Custom properties set at runtime (inline styles), by Tailwind, or by the editor. */
const RUNTIME = /^--(wsp-|ws-c$|ctx-w$|kside-w$|aid$|tw-|base|accent(Text|Bg|Border|Solid|Line)|color-|text-|font-(sans|mono|reading)$|radius-|shadow-|animate-|spacing)/;

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("inspector stylesheets", () => {
  it("style only classes the source still uses", () => {
    const unused: string[] = [];
    for (const sheet of sheets) {
      const css = stripComments(read(sheet));
      // Selectors are what precedes a "{" (at-rule preludes included; they hold no classes).
      const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]);
      const classes = new Set(selectors.flatMap((s) => [...s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])));
      for (const c of classes) {
        if (THIRD_PARTY.test(c)) continue;
        if (!new RegExp(`(^|[^\\w-])${c.replace(/[-_]/g, "\\$&")}(?![\\w-])`).test(code)) unused.push(`${path.basename(sheet)}: .${c}`);
      }
    }
    assert.deepEqual(unused, [], "remove these rules, or the markup lost a class it still needs");
  });

  it("read only custom properties that are defined", () => {
    const text = sheets.map(read).join("\n") + code;
    const defined = new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...text.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((v) => !defined.has(v) && !RUNTIME.test(v)).sort();
    assert.deepEqual(missing, [], "define these in tokens.css (or use a token that exists)");
  });
});
