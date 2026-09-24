import { useEffect, useMemo, useState } from "react";
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  markdownShortcutPlugin,
  diffSourcePlugin,
  toolbarPlugin,
  DiffSourceToggleWrapper,
  UndoRedo,
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  ListsToggle,
  CreateLink,
  InsertTable,
  InsertThematicBreak,
  InsertCodeBlock,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

/**
 * The rich-text editor for a knowledge page, loaded lazily by knowledge.tsx
 * into the page's own content box ("edit document"). Only the markdown body
 * is edited; the caller keeps the frontmatter and saves both.
 */

/** Follows the app theme (dark unless <html data-theme="light">), live. */
export function useIsDark(): boolean {
  const read = () => document.documentElement.dataset.theme !== "light";
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

/**
 * Join hard-wrapped lines inside paragraphs and list items. Agents write
 * markdown wrapped at ~80 columns; the rich-text editor would show every
 * one of those newlines as a line break. Code fences, tables, headings,
 * quotes and blank-line structure are left alone.
 */
export function unwrapParagraphs(md: string): string {
  const out: string[] = [];
  let inFence = false;
  const structural = /^(\s*([-*+]|\d+[.)])\s|#{1,6}\s|\||>|\s*```|---\s*$|\s*[-*_]{3,}\s*$|\s*\\?\[\^[^\]]+\]:)/;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    const prev = out[out.length - 1];
    const joinable =
      !inFence &&
      prev !== undefined &&
      prev.trim() !== "" &&
      line.trim() !== "" &&
      !/^(#{1,6}\s|\||>|\s*```)/.test(prev) &&
      !/ {2}$|\\$/.test(prev) &&
      !structural.test(line) &&
      !/^\s*<|^\s*!\[/.test(line);
    if (joinable) out[out.length - 1] = `${prev.replace(/\s+$/, "")} ${line.trim()}`;
    else out.push(line);
  }
  return out.join("\n");
}

/**
 * The editor's markdown serializer escapes brackets it doesn't know as
 * syntax — footnotes ([^id]) and [[wikilinks]] would come back as
 * "\[^id]" / "\[\[page]]" and stop working. Undo just those escapes.
 */
export function unescapeExtensions(md: string): string {
  return md
    .replace(/\\\[\\\[([^\]]*?)\\\]\\\]/g, "[[$1]]")
    .replace(/\\\[\\\[([^\]]*?)\]\]/g, "[[$1]]")
    .replace(/\\\[\^/g, "[^");
}

/** Split a concept file into its frontmatter block (incl. fences) and body. */
export function splitFrontmatter(raw: string): { head: string; body: string } {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? { head: m[0], body: raw.slice(m[0].length) } : { head: "", body: raw };
}

/** The rich-text setup both editors share: headings, lists, links, tables, code, a source toggle. */
function makePlugins() {
  return [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
    codeMirrorPlugin({
      codeBlockLanguages: { "": "text", txt: "text", js: "JavaScript", ts: "TypeScript", json: "JSON", yaml: "YAML", bash: "Shell", md: "Markdown" },
    }),
    markdownShortcutPlugin(),
    diffSourcePlugin({ viewMode: "rich-text" }),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper>
          <UndoRedo />
          <BlockTypeSelect />
          <BoldItalicUnderlineToggles />
          <CodeToggle />
          <ListsToggle />
          <CreateLink />
          <InsertTable />
          <InsertThematicBreak />
          <InsertCodeBlock />
        </DiffSourceToggleWrapper>
      ),
    }),
  ];
}

/**
 * The rich-text editor on its own, for a box that edits a page in place
 * (knowledge.tsx): hand it the markdown body, get every change back as
 * markdown with the extensions unescaped. `onError` fires when the body
 * cannot be parsed as rich text — the caller then falls back to the source.
 */
export function DocEditor({ markdown, onChange, onError, autoFocus = true }: {
  markdown: string;
  onChange: (md: string) => void;
  onError: () => void;
  autoFocus?: boolean;
}) {
  const dark = useIsDark();
  const plugins = useMemo(() => makePlugins(), []);
  return (
    <MDXEditor
      className={`editor-mdx ${dark ? "dark-theme" : ""}`}
      contentEditableClassName="editor-content md-body"
      markdown={markdown}
      plugins={plugins}
      autoFocus={autoFocus ? { defaultSelection: "rootStart", preventScroll: true } : undefined}
      onChange={(md, initialNormalize) => {
        if (initialNormalize) return;
        onChange(unescapeExtensions(md));
      }}
      onError={onError}
    />
  );
}
