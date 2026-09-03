import { useEffect, useMemo, useRef, useState } from "react";
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
import type { ConceptDetail } from "./types";
import { Icon, navigate, setPageTitle } from "./shared";

/**
 * Document editor mode for one concept (#/edit/<bundle>/<id>): the page is
 * only the editor — no chrome, one close button. Google-Docs-style
 * autosave: every change is written ~1s after you stop typing, and once
 * more on close. Only the markdown body is edited; the frontmatter block
 * is carried over untouched (the server re-stamps provenance).
 */

type SaveState = "saved" | "unsaved" | "saving" | "error";
const AUTOSAVE_MS = 1000;

/** Follows the app theme (dark unless <html data-theme="light">), live. */
function useIsDark(): boolean {
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
function unwrapParagraphs(md: string): string {
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
function unescapeExtensions(md: string): string {
  return md
    .replace(/\\\[\\\[([^\]]*?)\\\]\\\]/g, "[[$1]]")
    .replace(/\\\[\\\[([^\]]*?)\]\]/g, "[[$1]]")
    .replace(/\\\[\^/g, "[^");
}

/** Split a concept file into its frontmatter block (incl. fences) and body. */
function splitFrontmatter(raw: string): { head: string; body: string } {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? { head: m[0], body: raw.slice(m[0].length) } : { head: "", body: raw };
}

export function EditorScreen({ bundle, conceptId }: { bundle: string; conceptId: string }) {
  const [concept, setConcept] = useState<ConceptDetail | null | undefined>(undefined);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [parseFailed, setParseFailed] = useState(false);
  const editorRef = useRef<MDXEditorMethods>(null);
  const headRef = useRef("");
  const latestRef = useRef<string | null>(null); // body waiting to be saved
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const conceptUrl = `/api/knowledge/${encodeURIComponent(bundle)}/concept?id=${encodeURIComponent(conceptId)}`;

  useEffect(() => {
    let alive = true;
    fetch(conceptUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: ConceptDetail | null) => {
        if (!alive) return;
        if (c) headRef.current = splitFrontmatter(c.raw).head;
        setConcept(c);
      })
      .catch(() => alive && setConcept(null));
    return () => {
      alive = false;
    };
  }, [conceptUrl]);

  const title = concept?.title || conceptId;
  useEffect(() => {
    setPageTitle(`${title} · editor`);
    return () => setPageTitle("");
  }, [title]);

  const initialBody = useMemo(
    () => (concept ? unwrapParagraphs(splitFrontmatter(concept.raw).body) : ""),
    [concept]
  );
  const dark = useIsDark();

  async function flush(): Promise<void> {
    if (savingRef.current) await savingRef.current;
    const body = latestRef.current;
    if (body === null) return;
    latestRef.current = null;
    setState("saving");
    const run = (async () => {
      try {
        const head = headRef.current;
        const content = head ? `${head}${head.endsWith("\n") ? "" : "\n"}${body.replace(/^\n+/, "\n")}` : body;
        const r = await fetch(`/api/knowledge/${encodeURIComponent(bundle)}/concept`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: conceptId, content }),
          keepalive: true,
        });
        const res = (await r.json()) as ConceptDetail & { error?: string };
        if (res.error) throw new Error(res.error);
        // Keep the (re-stamped) frontmatter so the next save carries it forward.
        headRef.current = splitFrontmatter(res.raw).head;
        setError("");
        setState(latestRef.current === null ? "saved" : "unsaved");
      } catch (err) {
        setError((err as Error).message);
        setState("error");
        // Retry with the newest content on the next change or close.
        if (latestRef.current === null) latestRef.current = body;
      }
    })();
    savingRef.current = run;
    await run;
    savingRef.current = null;
  }

  function schedule(body: string): void {
    latestRef.current = unescapeExtensions(body);
    setState("unsaved");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  // Save on tab close / navigation away as well.
  useEffect(() => {
    const onUnload = () => {
      if (latestRef.current !== null) void flush();
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function close(): Promise<void> {
    if (timerRef.current) clearTimeout(timerRef.current);
    await flush();
    if (window.history.length > 1) window.history.back();
    else navigate(`/knowledge/${encodeURIComponent(bundle)}/${conceptId}`);
  }

  const plugins = useMemo(
    () => [
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
    ],
    []
  );

  const status =
    state === "saving" ? "saving…" : state === "unsaved" ? "unsaved changes" : state === "error" ? `not saved — ${error}` : "all changes saved";

  return (
    <div className="editor-screen">
      <div className="editor-bar">
        <span className="editor-crumb">
          <Icon name="menu_book" className="ms-sm" /> {bundle}
        </span>
        <span className="editor-title">{title}</span>
        <span className={`editor-status ${state}`}>{status}</span>
        <span className="spacer" />
        <button className="editor-close" onClick={() => void close()} title="Save and close">
          <Icon name="close" /> close
        </button>
      </div>
      {concept === undefined ? (
        <div className="empty">loading…</div>
      ) : concept === null ? (
        <div className="empty">concept not found</div>
      ) : parseFailed ? (
        <div className="editor-doc">
          <div className="viewer-note">
            This document could not be opened in rich-text mode — editing the markdown source instead.
          </div>
          <textarea
            className="editor-plain"
            defaultValue={initialBody}
            spellCheck={false}
            onChange={(e) => schedule(e.target.value)}
          />
        </div>
      ) : (
        <div className="editor-doc">
          <MDXEditor
            ref={editorRef}
            className={`editor-mdx ${dark ? "dark-theme" : ""}`}
            contentEditableClassName="editor-content md-body"
            markdown={initialBody}
            plugins={plugins}
            autoFocus={{ defaultSelection: "rootStart", preventScroll: true }}
            onChange={(md, initialNormalize) => {
              if (initialNormalize) return;
              schedule(md);
            }}
            onError={() => setParseFailed(true)}
          />
        </div>
      )}
    </div>
  );
}
