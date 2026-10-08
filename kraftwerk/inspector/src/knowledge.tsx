import { Fragment, Suspense, lazy, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BundleDetail, ConceptDetail, KnowledgeIndex } from "./types";
import { createChatAndOpen } from "./chat";
import { api, useApi } from "./api";
import { navigate, Icon, Link, LocalNav } from "./shared";
import { Button, cn, Dot, EmptyState, Fact, Facts, Hint, ListRow, Notice, Panel, SideHead, SideList, SideNote, Tabs, Tag, TextField, Title } from "./ui";
import { exportBundlePdf } from "./export";
// The rich-text editor (MDXEditor + CodeMirror) is heavy: loaded the first time a page is edited as a document.
const DocEditor = lazy(() => import("./editor").then((m) => ({ default: m.DocEditor })));
const editorHelpers = () => import("./editor");

/**
 * Knowledge: OKF bundles under the project's knowledge/ root.
 * Sidebar lists bundles; a bundle page lists its concepts with trust
 * tier / status / staleness; a concept page shows frontmatter (provenance,
 * sources, verification) plus the markdown body, with a human-verify
 * button and a "curate in chat" entry that opens a knowledge-scoped chat.
 */

export function KnowledgeScreen({ bundle, conceptId }: { bundle?: string; conceptId?: string }) {
  const data = useApi("knowledge.list", {});
  // Bundles just moved to the trash, hidden until the poll stops listing them (else the landing would pick one again).
  const [gone, setGone] = useState<string[]>([]);
  useEffect(() => {
    if (data) setGone((g) => g.filter((n) => data.bundles.some((b) => b.name === n)));
  }, [data]);
  const bundles = (data?.bundles ?? []).filter((b) => !gone.includes(b.name));
  // #/knowledge/new is the create form; a bare #/knowledge lands on the bundle
  // touched last (like #/channels lands on the latest channel).
  const creating = bundle === "new";
  const latest = bundles.reduce<KnowledgeIndex["bundles"][number] | undefined>(
    (a, b) => (!a || (b.updatedAt ?? "") > (a.updatedAt ?? "") ? b : a),
    undefined
  );
  useEffect(() => {
    if (!bundle && latest) navigate(`/knowledge/${encodeURIComponent(latest.name)}`, { replace: true });
  }, [bundle, latest?.name]);

  return (
    <div className="runs-screen">
      <aside className="runs-side">
        <SideHead title="bundles" action={<Button size="sm" variant="quiet" icon="add" href="/knowledge/new">new</Button>} />
        <SideList>
          {bundles.map((b) => (
            <ListRow
              key={b.name}
              href={`/knowledge/${encodeURIComponent(b.name)}`}
              active={b.name === bundle}
              size="sm"
              leading={<Dot tone="ok" />}
              title={b.name}
              meta={b.concepts}
              sub={`${b.okfVersion ? `okf ${b.okfVersion}` : "okf"}${b.updatedAt ? ` · ${b.updatedAt.slice(0, 10)}` : ""}`}
            />
          ))}
          {data && bundles.length === 0 && <SideNote>no bundles yet</SideNote>}
        </SideList>
      </aside>
      <div className="runs-main">
        {bundle && !creating ? (
          <BundleView
            key={bundle}
            name={bundle}
            conceptId={conceptId}
            onRemoved={() => {
              setGone((g) => [...g, bundle]);
              navigate("/knowledge", { replace: true });
            }}
          />
        ) : creating || (data && !latest) ? (
          <KnowledgeHome />
        ) : (
          <EmptyState>loading…</EmptyState>
        )}
      </div>
    </div>
  );
}


/* ---------- home / new bundle ---------- */

/** Create a bundle: one field, one button. Also the whole screen while there are no bundles. */
function KnowledgeHome() {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    setError("");
    const res = await api.request("knowledge.create", { body: { name: n } });
    const body = res.data as { error?: string } | undefined;
    setCreating(false);
    if (body?.error) setError(body.error);
    else navigate(`/knowledge/${encodeURIComponent(n)}`);
  }

  return (
    // empty-action: the hook the landing test looks for.
    <div className="empty-action flex flex-col items-center gap-3 px-4 py-16">
      <div className="flex w-full max-w-[520px] gap-2.5">
        <TextField
          className="flex-1 font-mono text-sm"
          value={name}
          placeholder="bundle name, e.g. customer-support"
          aria-label="bundle name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
          autoFocus
        />
        <Button variant="primary" icon="add" busy={creating} disabled={!name.trim()} onClick={create}>
          {creating ? "creating…" : "new bundle"}
        </Button>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}

/* ---------- bundle ---------- */

function TrustBadge({ tier }: { tier: string }) {
  return <Tag tone={tier === "human-reviewed" ? "ok" : tier === "machine-confirmed" ? "accent" : "neutral"}>{tier}</Tag>;
}

/** A concept's lifecycle status as a tag: deprecated and stale read as trouble, a draft as work in progress. */
const statusTone = (status: string) => (status === "deprecated" || status === "stale" ? "bad" : status === "draft" ? "accent" : "neutral");

/**
 * Embedded in the context column (its links stay in the column): the page
 * goes compact — smaller heads, one column, the page-level actions left to
 * the full screen.
 */
const useEmbedded = (): boolean => useContext(LocalNav) !== null;

/** A small note under a panel's content: what the view is, where it saves. */
/** Raw text (a log, a source file) in a panel. */
const PRE = "m-0 max-h-[560px] overflow-auto px-[18px] py-3.5 font-mono text-xs leading-[1.55] break-words whitespace-pre-wrap text-fg-2";

/** Route segment that selects the activity tab (#/knowledge/<bundle>/@activity). */
const ACTIVITY_ID = "@activity";

/**
 * Bundle = small wiki: "pages" tab with a page sidebar + the selected
 * concept in the main area (first page by default), "activity" tab with
 * the OKF update log. The selected page lives in the URL so links stay
 * shareable.
 */
export function BundleView({ name, conceptId, onRemoved }: { name: string; conceptId?: string; onRemoved?: () => void }) {
  const data = useApi("knowledge.get", { bundle: name });
  const embedded = useEmbedded();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState("");
  async function remove() {
    const r = await api.request("knowledge.delete", { bundle: name }).catch(() => null);
    const body = r?.data as { error?: string } | undefined;
    if (!r?.ok) {
      setRemoveError(body?.error ?? "delete failed");
      setConfirmRemove(false);
      return;
    }
    if (onRemoved) onRemoved();
    else navigate("/knowledge", { replace: true });
  }
  if (!data) return <EmptyState>loading…</EmptyState>;
  if ("error" in data) return <EmptyState icon="menu_book">bundle not found</EmptyState>;

  const tab = conceptId === ACTIVITY_ID ? "activity" : "pages";
  const concepts = data.concepts;
  const selected =
    tab === "pages"
      ? (conceptId && concepts.some((c) => c.id === conceptId) ? conceptId : concepts[0]?.id)
      : undefined;
  const base = `/knowledge/${encodeURIComponent(name)}`;

  return (
    <div className={cn("agent-view @container flex flex-col", embedded ? "gap-2.5" : "gap-4")}>
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", embedded ? "mb-0.5" : "mx-0.5 mt-1 mb-2")}>
        <Title size={embedded ? "md" : "lg"}>{name}</Title>
        <span className={cn("text-fg-2", embedded ? "text-[12.5px]" : "text-base")}>{concepts.length} pages</span>
        <Tabs
          bare
          className="self-end"
          label="bundle views"
          value={tab}
          items={[
            { id: "pages", href: base, label: "pages" },
            { id: "activity", href: `${base}/${ACTIVITY_ID}`, label: "activity" },
          ]}
        />
        <span className="flex-1" />
        {!embedded && (
          <>
            <Button size="sm" variant="quiet" icon="picture_as_pdf" onClick={() => void exportBundlePdf(name)}>
              export PDF
            </Button>
            {!confirmRemove ? (
              <Button size="sm" variant="quiet" icon="delete" onClick={() => setConfirmRemove(true)} title="Move the bundle to the trash">
                delete
              </Button>
            ) : (
              <>
                <Button size="sm" variant="danger" icon="delete" onClick={() => void remove()}>
                  move to trash
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(false)}>cancel</Button>
              </>
            )}
            <Button variant="primary" onClick={() => void createChatAndOpen("claude", { kind: "knowledge", bundle: name })}>
              curate in chat
            </Button>
          </>
        )}
      </div>
      {removeError && <Notice tone="bad">{removeError}</Notice>}

      {tab === "activity" ? (
        data.log ? (
          <ActivityPanel name={name} log={data.log} />
        ) : (
          <Panel>
            <p className="m-0 px-[18px] py-3 text-sm text-fg-2">no activity yet</p>
          </Panel>
        )
      ) : concepts.length === 0 ? (
        <Panel>
          <p className="m-0 px-[18px] py-3 text-sm text-fg-2">
            No pages yet — start a chat to author some, or write one with{" "}
            <code>kraftwerk knowledge put {name}/&lt;path&gt;</code>.
          </p>
        </Panel>
      ) : (
        <div
          className={cn(
            "grid items-start",
            embedded ? "grid-cols-[170px_minmax(0,1fr)] gap-3.5 @max-[560px]:grid-cols-1" : "grid-cols-[260px_minmax(0,1fr)] gap-6 max-[1100px]:grid-cols-1"
          )}
        >
          <aside
            className={cn(
              "flex flex-col gap-0.5 overflow-y-auto border-r border-line",
              embedded
                ? "sticky top-0 max-h-[calc(100vh-var(--topbar-h)-160px)] pr-2 pb-1.5 @max-[560px]:static @max-[560px]:max-h-[200px] @max-[560px]:border-r-0 @max-[560px]:pr-0"
                : "sticky top-[calc(var(--topbar-h)+18px)] max-h-[calc(100vh-var(--topbar-h)-36px)] py-1.5 pr-3 max-[1100px]:static max-[1100px]:max-h-none max-[1100px]:border-r-0 max-[1100px]:pr-0"
            )}
          >
            <PageTree concepts={concepts} base={base} selected={selected} />
          </aside>
          <div className="min-w-0">
            {selected && <ConceptView key={selected} bundle={name} conceptId={selected} />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- activity log ---------- */

interface LogEntry {
  kind: string;
  text: string;
}

/** Parse the OKF update log ("## YYYY-MM-DD" + "* **Kind**: ..." lines) into days. */
function parseLog(log: string): Array<{ date: string; entries: LogEntry[] }> {
  const days: Array<{ date: string; entries: LogEntry[] }> = [];
  for (const line of log.split("\n")) {
    const day = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (day) {
      days.push({ date: day[1], entries: [] });
      continue;
    }
    const entry = line.match(/^[*-]\s+\*\*([^*]+)\*\*:\s*(.*)$/);
    if (entry && days.length > 0) {
      days[days.length - 1].entries.push({ kind: entry[1].toLowerCase(), text: entry[2] });
    }
  }
  return days.filter((d) => d.entries.length > 0);
}

/** Render one log line, turning "[title](/path.md)" into concept links. */
function logText(name: string, text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(\/?([^)]+?)\.md\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <Link key={m.index} href={`/knowledge/${encodeURIComponent(name)}/${m[2].replace(/^\//, "")}`}>
        {m[1]}
      </Link>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function ActivityPanel({ name, log }: { name: string; log: string }) {
  const days = parseLog(log);
  const [raw, setRaw] = useState(false);

  return (
    <Panel
      title="activity"
      actions={
        <Button size="sm" variant="quiet" onClick={() => setRaw(!raw)}>
          {raw ? "timeline" : "raw log"}
        </Button>
      }
    >
      {raw || days.length === 0 ? (
        <pre className={PRE}>{log}</pre>
      ) : (
        <div className="pt-0.5 pb-2.5">
          {days.map((d, n) => (
            <Fragment key={d.date}>
              <div className={cn("px-[18px] pt-3.5 pb-1 font-mono text-2xs tracking-[0.05em] text-fg-2 tabular-nums", n > 0 && "mt-1 border-t border-line")}>{d.date}</div>
              {d.entries.map((e, i) => (
                <div key={i} className="flex items-baseline gap-2.5 px-[18px] py-1">
                  <Tag tone={e.kind === "verification" ? "ok" : e.kind === "creation" || e.kind === "initialization" ? "accent" : "neutral"}>{e.kind}</Tag>
                  <span className="min-w-0 text-[12.5px] leading-[1.55] break-words text-fg-2 [&_a]:text-accent">{logText(name, e.text)}</span>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------- page tree ---------- */

type Concept = BundleDetail["concepts"][number];
interface Folder {
  name: string;
  path: string;
  folders: Folder[];
  pages: Concept[];
  /** Pages in this folder and every folder below it. */
  total: number;
}

/** Nest concepts by their directory within the bundle; root pages first, folders sorted by name. */
function buildTree(concepts: Concept[]): Folder {
  const root: Folder = { name: "", path: "", folders: [], pages: [], total: 0 };
  for (const c of concepts) {
    const parts = c.id.split("/");
    let node = root;
    node.total++;
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, path: node.path ? `${node.path}/${part}` : part, folders: [], pages: [], total: 0 };
        node.folders.push(next);
      }
      node = next;
      node.total++;
    }
    node.pages.push(c);
  }
  const sort = (f: Folder) => {
    f.folders.sort((a, b) => a.name.localeCompare(b.name));
    f.pages.sort((a, b) => a.title.localeCompare(b.title));
    f.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function PageTree({ concepts, base, selected }: { concepts: Concept[]; base: string; selected?: string }) {
  const tree = useMemo(() => buildTree(concepts), [concepts]);
  // Folders the user closed by hand; everything is open by default and the
  // folder holding the selected page is forced open when the selection moves.
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!selected || !selected.includes("/")) return;
    setClosed((prev) => {
      const next = new Set(prev);
      const parts = selected.split("/").slice(0, -1);
      for (let i = 1; i <= parts.length; i++) next.delete(parts.slice(0, i).join("/"));
      return next.size === prev.size ? prev : next;
    });
  }, [selected]);
  const toggle = (path: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const embedded = useEmbedded();
  return <TreeLevel folder={tree} base={base} selected={selected} closed={closed} toggle={toggle} embedded={embedded} />;
}

function TreeLevel({
  folder, base, selected, closed, toggle, embedded,
}: {
  folder: Folder; base: string; selected?: string;
  closed: Set<string>; toggle: (path: string) => void; embedded: boolean;
}) {
  return (
    <>
      {folder.pages.map((c) => {
        const on = c.id === selected;
        return (
          // wiki-page / active / wiki-folder / open / holds / wiki-branch: what the page-tree test reads.
          <Link
            key={c.id}
            href={`${base}/${c.id}`}
            aria-current={on ? "page" : undefined}
            className={cn(
              "wiki-page flex items-center gap-2 rounded-control px-2.5 py-1.5 leading-[1.35] no-underline transition-colors",
              embedded ? "text-[12.5px]" : "text-sm",
              on ? "active bg-accent-soft font-medium text-on-accent-soft" : "text-fg hover:bg-surface-2"
            )}
            title={`${c.id}.md`}
          >
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            {(c.stale || c.error) && <span className="size-1.5 flex-none rounded-full bg-bad" title={c.error ?? "stale"} />}
          </Link>
        );
      })}
      {folder.folders.map((f) => {
        const open = !closed.has(f.path);
        const holdsSelected = !!selected && selected.startsWith(`${f.path}/`);
        const holds = holdsSelected && !open;
        return (
          <Fragment key={f.path}>
            <button
              type="button"
              className={cn(
                "wiki-folder mt-2.5 mb-0.5 flex w-full cursor-pointer items-center gap-1 rounded-control border-0 bg-transparent py-1 pr-2 pl-0.5 text-left",
                "font-[inherit] text-2xs leading-[1.3] font-semibold tracking-[0.06em] uppercase transition-colors",
                open && "open",
                holds ? "holds text-accent" : "text-fg-2 hover:text-fg"
              )}
              onClick={() => toggle(f.path)}
              aria-expanded={open}
              title={`${f.path}/`}
            >
              <Icon name="chevron_right" className={cn("ms-sm flex-none text-[16px] transition-transform", open && "rotate-90", !holds && "text-fg-2")} />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-[10.5px] font-medium tracking-normal text-fg-2 tabular-nums opacity-70">{f.total}</span>
            </button>
            {open && (
              <div className="wiki-branch ml-[9px] flex flex-col gap-0.5 border-l border-line pl-1">
                <TreeLevel folder={f} base={base} selected={selected} closed={closed} toggle={toggle} embedded={embedded} />
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/* ---------- concept ---------- */

function ConceptView({ bundle, conceptId }: { bundle: string; conceptId: string }) {
  const [concept, setConcept] = useState<ConceptDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const embedded = useEmbedded();
  /** The page is its editor: "document" (rich text, autosaved) is the view; "markdown" edits the whole file as text with an explicit save. */
  const [mode, setMode] = useState<"document" | "markdown">("document");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  /** What the editor started from; a new key restarts it (the file changed underneath, or was saved as markdown). */
  const [doc, setDoc] = useState<{ key: number; body: string } | null>(null);
  const [state, setState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [error, setError] = useState("");
  const headRef = useRef(""); // the frontmatter, carried over untouched (the server re-stamps provenance)
  const lastRawRef = useRef<string | null>(null); // the file the editor currently shows
  // The editor reports its own normalisation of the file as a change (tables,
  // escapes) — only what a person did in it may be saved, so nothing is
  // scheduled before the editor was touched.
  const touchedRef = useRef(false);
  const latestRef = useRef<string | null>(null); // a body waiting to be saved
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const load = () => {
    api.call("knowledge.concept", { bundle, query: { id: conceptId } }).then(setConcept, () => setGone(true));
  };

  // Poll so agent-written updates appear without a manual refresh; paused while
  // the markdown is edited, and state identity is kept when nothing changed.
  useEffect(() => {
    if (mode === "markdown") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api.request("knowledge.concept", { bundle, query: { id: conceptId } });
        if (r.ok) {
          const c = r.data;
          if (alive) {
            setGone(false);
            setConcept((prev) => (JSON.stringify(prev) === JSON.stringify(c) ? prev : c));
          }
        } else if (r.status === 404 && alive) {
          setGone(true);
        }
      } catch {}
      if (alive) timer = setTimeout(tick, 6000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [bundle, conceptId, mode]);

  // The editor starts from the file on disk, and restarts when the file
  // changed underneath while nothing here is unsaved (an agent wrote it).
  useEffect(() => {
    if (!concept || concept.raw === lastRawRef.current || latestRef.current !== null || savingRef.current) return;
    let alive = true;
    void editorHelpers().then(({ splitFrontmatter, unwrapParagraphs }) => {
      if (!alive) return;
      const { head, body } = splitFrontmatter(concept.raw);
      headRef.current = head;
      lastRawRef.current = concept.raw;
      touchedRef.current = false;
      setDoc((d) => ({ key: (d?.key ?? 0) + 1, body: unwrapParagraphs(body) }));
    });
    return () => {
      alive = false;
    };
  }, [concept]);

  /** Write the pending body (frontmatter kept) — Google-Docs style, ~1s after the last change. */
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
        // keepalive: this save also runs on tab close.
        const r = await api.request("knowledge.putConcept", { bundle, body: { id: conceptId, content }, keepalive: true });
        const res = r.data as ConceptDetail & { error?: string };
        if (res.error) throw new Error(res.error);
        headRef.current = (await editorHelpers()).splitFrontmatter(res.raw).head;
        lastRawRef.current = res.raw; // what we saved is what the editor shows: no restart
        setConcept(res);
        setError("");
        setState(latestRef.current === null ? "saved" : "unsaved");
      } catch (err) {
        setError((err as Error).message);
        setState("error");
        if (latestRef.current === null) latestRef.current = body; // retry with the next change
      }
    })();
    savingRef.current = run;
    await run;
    savingRef.current = null;
  }

  function schedule(body: string): void {
    if (!touchedRef.current) return;
    latestRef.current = body;
    setState("unsaved");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), 1000);
  }

  // Unsaved changes go out on tab close, and when the page is left.
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
      if (latestRef.current !== null) void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify() {
    setVerifying(true);
    await api.request("knowledge.verify", { bundle, body: { id: conceptId } }).catch(() => {});
    setVerifying(false);
    load();
  }

  /** The whole file as text — the way to touch the frontmatter. */
  function editMarkdown() {
    if (!concept) return;
    setDraft(concept.raw);
    setSaveError("");
    setMode("markdown");
  }

  async function saveMarkdown() {
    setSaving(true);
    setSaveError("");
    const body = (await api
      .request("knowledge.putConcept", { bundle, body: { id: conceptId, content: draft } })
      .then((r) => (r.data && typeof r.data === "object" ? r.data : { error: "save failed" }))
      .catch(() => ({ error: "save failed" }))) as ConceptDetail & { error?: string };
    setSaving(false);
    if (body.error) setSaveError(body.error);
    else {
      lastRawRef.current = null; // the editor restarts from the saved file
      setConcept(body);
      setMode("document");
    }
  }

  if (gone) return <EmptyState icon="description">concept not found</EmptyState>;
  if (!concept) return <EmptyState>loading…</EmptyState>;

  const status =
    state === "saving" ? "saving…" : state === "unsaved" ? "unsaved changes" : state === "error" ? `not saved — ${error}` : "all changes saved";

  return (
    <div className={cn("agent-view flex flex-col", embedded ? "gap-2.5" : "gap-4")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Title size={embedded ? "md" : "lg"}>{concept.title}</Title>
        {concept.type && <Tag>{concept.type}</Tag>}
        <TrustBadge tier={concept.trustTier} />
        {concept.status !== "stable" && <Tag tone={statusTone(concept.status)}>{concept.status}</Tag>}
        {concept.stale && <Tag tone="bad">stale since {concept.staleAfter?.slice(0, 10)}</Tag>}
        <span className="flex-1" />
        {!embedded && (
          <Button size="sm" variant="quiet" icon="picture_as_pdf" onClick={() => void exportBundlePdf(bundle, concept.id)}>
            export PDF
          </Button>
        )}
        <Button variant="primary" size={embedded ? "sm" : "md"} icon="check" busy={verifying} onClick={verify}>
          {verifying ? "verifying…" : "verify (human)"}
        </Button>
      </div>
      {concept.error && <Notice tone="bad">{concept.error}</Notice>}

      <div className={cn("grid items-start", embedded ? "grid-cols-1 gap-3" : "grid-cols-[minmax(0,1fr)_320px] gap-4 max-[1020px]:grid-cols-1")}>
        <Panel
          className="min-w-0"
          title="content"
          actions={
            <>
              <span className="min-w-0 truncate font-mono text-[10.5px] text-fg-2">
                {bundle}/{concept.id}.md
              </span>
              {mode === "markdown" ? (
                <>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      setMode("document");
                      setSaveError("");
                    }}
                  >
                    cancel
                  </Button>
                  <Button size="sm" icon="check" busy={saving} onClick={() => void saveMarkdown()}>
                    {saving ? "saving…" : "save"}
                  </Button>
                </>
              ) : (
                <>
                  <span className={cn("text-xs whitespace-nowrap", state === "error" ? "text-bad" : state === "unsaved" || state === "saving" ? "text-ask" : "text-fg-2")}>
                    {status}
                  </span>
                  <Button size="sm" variant="quiet" icon="code" title="The whole file as text, frontmatter included" onClick={editMarkdown}>
                    edit markdown
                  </Button>
                </>
              )}
            </>
          }
        >
          {mode === "markdown" ? (
            <>
              <textarea
                // concept-edit: the hook the editor test reads.
                className="concept-edit block w-full resize-y border-0 border-b border-line bg-surface px-[18px] py-3.5 font-mono text-[12.5px] leading-[1.65] text-fg outline-none"
                value={draft}
                rows={Math.min(40, Math.max(18, draft.split("\n").length + 2))}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
              <Hint className="border-b border-line px-[18px] py-1.5">
                full file (frontmatter + markdown body) — saving stamps provenance as <code>human:user</code> and logs an update.
              </Hint>
            </>
          ) : (
            <div
              // concept-doc: the hook the editor test reads; the editor's own box takes the height.
              className={cn("concept-doc", embedded ? "[&_.editor-content]:min-h-[220px]" : "[&_.editor-content]:min-h-[280px]")}
              onPointerDownCapture={() => (touchedRef.current = true)}
              onKeyDownCapture={() => (touchedRef.current = true)}
              onPasteCapture={() => (touchedRef.current = true)}
              onDropCapture={() => (touchedRef.current = true)}
            >
              {doc ? (
                <Suspense fallback={<Hint className="border-b border-line px-[18px] py-1.5">loading the editor…</Hint>}>
                  <DocEditor key={doc.key} markdown={doc.body} autoFocus={false} onChange={schedule} onError={editMarkdown} />
                </Suspense>
              ) : (
                <Hint className="border-b border-line px-[18px] py-1.5">loading…</Hint>
              )}
              <Hint className="border-b border-line px-[18px] py-1.5">
                the page as a document, saved as you type; every save stamps provenance as <code>human:user</code> and logs an update.
              </Hint>
            </div>
          )}
          {saveError && (
            <div className="px-3 py-1">
              <Notice tone="bad">{saveError}</Notice>
            </div>
          )}
        </Panel>

        <aside className={cn("flex min-w-0 flex-col", embedded ? "gap-2.5" : "gap-4")}>
          <Panel title="about">
            <Facts compact={embedded}>
              <Fact label="trust">
                <TrustBadge tier={concept.trustTier} />
              </Fact>
              <Fact label="generated" dim={!concept.generated}>
                {concept.generated ? `${concept.generated.by ?? "?"} · ${(concept.generated.at ?? "?").slice(0, 10)}` : "not stamped"}
              </Fact>
              <Fact label="verified" dim={concept.verified.length === 0}>
                {concept.verified.length === 0
                  ? "never"
                  : concept.verified.map((v, i) => (
                      <span key={i} className="block">
                        {v.by ?? "?"} · {(v.at ?? "?").slice(0, 10)}
                      </span>
                    ))}
              </Fact>
              {concept.staleAfter && (
                <Fact label="stale after" dim={!concept.stale}>
                  {concept.staleAfter.slice(0, 10)}
                  {concept.stale && <Tag tone="bad">stale</Tag>}
                </Fact>
              )}
              {concept.tags.length > 0 && (
                <Fact label="tags">
                  {concept.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </Fact>
              )}
            </Facts>
          </Panel>

          {concept.sources.length > 0 && (
            <Panel title="sources">
              <Facts compact={embedded}>
                {concept.sources.map((s, i) => (
                  <div key={i} className={cn("flex flex-col gap-[3px] break-words", embedded ? "px-3.5 py-1.5 text-xs" : "px-[18px] py-2.5 text-[12.5px]")}>
                    <span className="text-fg [&_a]:text-accent">
                      {s.resource?.startsWith("http") ? (
                        <a href={s.resource} target="_blank" rel="noreferrer">
                          {s.title ?? s.resource}
                        </a>
                      ) : (
                        (s.title ?? s.resource ?? "?")
                      )}
                      {s.id && <span className="ml-2 font-mono text-2xs text-fg-2">[^{s.id}]</span>}
                    </span>
                    <span className="text-fg-2">
                      {[s.author, s.usage_count != null ? `${s.usage_count} uses` : null, s.last_modified ? `mod ${s.last_modified.slice(0, 10)}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                ))}
              </Facts>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ---------- facts: label and value, one per line ---------- */

