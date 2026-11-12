import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, failure, live, useApi, withBase } from "./api";
import { fmtAgo, Icon, Link, navigate } from "./shared";
import { Button, cn, EmptyState, Field, FieldRow, FormStack, Hint, IconButton, ListRow, Notice, Page, Panel, Select, SideHead, SideList, SideNote, TextArea, TextField, Title } from "./ui";
import type { PresentationDetail, RenderWarning, SlideDef } from "./types";
import type { DeckComment } from "../../src/core/presentations/index";
import { ChatThread } from "./chat";
import { stageHeight, type SlotView, type StageTemplate } from "../../src/core/presentations/html";
import { setSlot } from "../../src/core/presentations/slots";
import { mergeDrafts, type DeckDraft } from "../../src/core/presentations/merge";
import { PPI, STAGE_W, type SlotPatch } from "../../src/core/presentations/layout";
import { defaultOf, FormatPanel, Menu, MenuItem, MenuSep, patchesOf, round, SlideCanvas, SourcePanel, Stage, Thumb, useDeckCss, useView, withPatches } from "./deck-stage";

/**
 * Presentations in the browser. The list is the side column; a deck opens
 * on the whole page as the editor: the bar (slide, text, picture, chart,
 * table, shapes, HTML, embed, the theme's pieces; zoom, grid, undo; format,
 * design, chat; present, downloads), the slides as a numbered strip, and
 * the slide itself — live HTML in the template's theme, the same that
 * present mode, the PDF and the PNGs show — edited where it stands
 * (deck-stage.tsx). An agent works beside it in a docked chat and the
 * slide follows its edits. deck.md stays the truth.
 *
 * Routes: #/presentations, #/presentations/new, #/presentations/<name>,
 * #/presentations/<name>/present[/<n>], …/presenter[/<n>] (with notes),
 * and the same under #/projects/<slug>/.
 */

export interface DeckAt {
  project?: string;
  name: string;
}

const enc = encodeURIComponent;
const queryOf = (project?: string): Record<string, string> | undefined => (project ? { project } : undefined);
export const deckHref = (at: DeckAt): string => (at.project ? `/projects/${enc(at.project)}/presentations/${enc(at.name)}` : `/presentations/${enc(at.name)}`);
const exportHref = (at: DeckAt, format: "pptx" | "pdf" | "html"): string => withBase(`/api/presentations/${enc(at.name)}/export?format=${format}${at.project ? `&project=${enc(at.project)}` : ""}`);
const assetOf = (at: DeckAt, version: string) => (src: string): string =>
  /^(https?:|data:|blob:|\/)/i.test(src) ? src : withBase(`/api/presentations/${enc(at.name)}/file?path=${enc(src.replace(/^\.\//, ""))}${at.project ? `&project=${enc(at.project)}` : ""}&v=${enc(version)}`);
const chatKey = (at: DeckAt) => `kw-deck-chat:${at.project ?? ""}/${at.name}`;

/* ---------- the list ---------- */

export function PresentationsScreen({ seg, project }: { seg: string[]; project?: string }) {
  const name = seg[0] && seg[0] !== "new" ? decodeURIComponent(seg[0]) : undefined;
  const creating = seg[0] === "new";
  const presenting = seg[1] === "present" || seg[1] === "presenter";
  const data = useApi("presentations.list", project ? { query: { project } } : {}, { interval: 10_000 });
  const decks = data?.presentations ?? [];
  const base = project ? `/projects/${enc(project)}/presentations` : "/presentations";
  const at = (n: string): DeckAt => ({ ...(project ? { project } : {}), name: n });
  // `presentation:<name>` links to #/presentations/<name>; a project's deck of that name opens where it lives.
  const lookElsewhere = !project && !!name && !!data?.enabled && !decks.some((d) => d.name === name);
  const all = useApi("presentations.list", lookElsewhere ? { query: { all: "1" } } : null, { interval: 60_000 });
  const elsewhere = lookElsewhere ? all?.presentations.find((d) => d.name === name && d.project) : undefined;
  const rest = seg.slice(1).map((x) => `/${x}`).join("");
  useEffect(() => {
    if (elsewhere?.project) navigate(`/projects/${enc(elsewhere.project)}/presentations/${enc(elsewhere.name)}${rest}`, { replace: true });
  }, [elsewhere?.project, elsewhere?.name, rest]);
  if (elsewhere) return <EmptyState icon="slideshow">opening the deck…</EmptyState>;

  if (name && presenting) return <PresentMode key={`${project ?? ""}/${name}`} {...at(name)} presenter={seg[1] === "presenter"} start={Number(seg[2]) || 1} />;
  // An open deck takes the whole page: the list of decks is one click back.
  if (name && data?.enabled && !data.error)
    return (
      <div className="runs-screen" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div className="runs-main" style={{ padding: "14px 18px 24px" }}>
          <DeckEditor key={`${project ?? ""}/${name}`} {...at(name)} />
        </div>
      </div>
    );

  let main: ReactNode;
  if (data && !data.enabled)
    main = (
      <EmptyState icon="slideshow">
        {data.error && !/are off/.test(data.error) ? (
          <span className="text-bad">{data.error}</span>
        ) : (
          <>
            Presentations are off. Turn them on in <a href="#/settings">settings</a> or add a <code>presentations:</code> block to kraftwerk.yml.
          </>
        )}
      </EmptyState>
    );
  else if (!data) main = <EmptyState>loading…</EmptyState>;
  else if (data.error)
    main = (
      <EmptyState icon="slideshow">
        <span className="text-bad">{data.error}</span>
      </EmptyState>
    );
  else if (creating) main = <NewDeck root={data.root} project={project} />;
  else
    main = (
      <EmptyState
        icon="slideshow"
        action={
          <Button variant="primary" icon="add" href={`${base}/new`}>
            new presentation
          </Button>
        }
      >
        {project ? "The project's slide decks: each a folder with a deck.md and its pictures." : "Workspace presentations: decks that belong to no project. A project's decks live with the project."}
      </EmptyState>
    );

  return (
    <div className="runs-screen">
      <aside className="runs-side">
        <SideHead
          title={project ? `${project} · presentations` : "presentations"}
          count={data?.enabled ? decks.length : undefined}
          action={
            data?.enabled && (
              <Button size="sm" variant="quiet" icon="add" href={`${base}/new`}>
                new
              </Button>
            )
          }
        />
        <SideList label="presentations">
          {decks.map((d) => (
            <ListRow
              key={d.name}
              href={deckHref(at(d.name))}
              active={d.name === name}
              size="sm"
              leading={<Icon name="slideshow" className="ms-sm" />}
              title={d.title}
              sub={d.error ? "unreadable deck.md" : `${d.slides} ${d.slides === 1 ? "slide" : "slides"} · ${d.template}`}
              subTone={d.error ? "bad" : "plain"}
              meta={d.updatedAt && <span title={d.updatedAt}>{fmtAgo(d.updatedAt)}</span>}
            />
          ))}
          {data && !data.enabled && <SideNote>{data.error}</SideNote>}
          {data?.enabled && decks.length === 0 && <SideNote>no {project ? "" : "workspace "}presentations yet</SideNote>}
          {project && (
            <SideNote>
              <Link href={`/projects/${enc(project)}`} className="text-accent">
                ← back to the project
              </Link>
            </SideNote>
          )}
        </SideList>
      </aside>
      <div className="runs-main">{main}</div>
    </div>
  );
}

function NewDeck({ root, project }: { root?: string; project?: string }) {
  const templates = useApi("presentations.templates", {}, { interval: 60_000 });
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("default");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Text files (notes, a doc exported as markdown, a CSV) go into the brief as they are. */
  const addFiles = async (files: FileList | null) => {
    for (const f of [...(files ?? [])]) {
      if (f.size > 400_000 || !/^text\/|json|csv|xml|markdown/.test(f.type || "text/plain") && !/\.(md|txt|csv|json|html?|ya?ml)$/i.test(f.name)) {
        setError(`${f.name}: only text files (md, txt, csv, json, html, yaml) up to 400 KB go into the brief`);
        continue;
      }
      const text = await f.text();
      setBrief((b) => `${b.trim() ? `${b.trim()}\n\n` : ""}--- ${f.name} ---\n${text.trim()}\n`);
      if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
    }
  };
  const create = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    const r = await api.request("presentations.create", { body: { title: t, template, ...(project ? { project } : {}) } });
    setBusy(false);
    if (!r.ok) return setError(failure(r));
    const at: DeckAt = { ...(project ? { project } : {}), name: r.data.name };
    // The editor hands the brief to an agent once it has the deck open (and forgets it, so a reload does not send it twice).
    if (brief.trim())
      try {
        sessionStorage.setItem(briefKey(at), brief.trim());
      } catch {
        /* no storage: the deck starts empty */
      }
    navigate(deckHref(at), { replace: true });
  };
  return (
    <Page>
      <div className="flex items-center gap-3">
        <Icon name="slideshow" className="text-[26px] text-fg-2" />
        <Title>new presentation</Title>
      </div>
      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <FormStack className="max-w-[680px]">
            <Field label="title">
              <TextField value={title} aria-label="presentation title" autoFocus placeholder="e.g. Quarterly review" onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="template">
              <Select value={template} aria-label="template" onChange={(e) => setTemplate(e.target.value)}>
                {(templates?.templates ?? [{ slug: "default", name: "Default", layouts: [] }]).map((t) => (
                  <option key={t.slug} value={t.slug} disabled={"error" in t && !!t.error}>
                    {t.name} ({t.slug}
                    {"layouts" in t && t.layouts.length ? `, ${t.layouts.length} layouts` : ""})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="what it is about (optional)">
              <div className="flex flex-col gap-1.5">
                <TextArea value={brief} aria-label="brief" rows={6} placeholder={"Who it is for, what it should get across, the points, numbers and sources — or drop notes here.\nAn agent writes the outline and the slides in the theme while you watch."} onChange={(e) => setBrief(e.target.value)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), void addFiles(e.dataTransfer.files))} />
                <label className="flex w-fit cursor-pointer items-center gap-1 text-xs text-fg-2 hover:text-fg">
                  <Icon name="attach_file" className="ms-sm" />
                  add notes from text files
                  <input type="file" multiple accept=".md,.txt,.csv,.json,.html,.htm,.yml,.yaml,text/*" aria-label="notes files" className="hidden" onChange={(e) => void addFiles(e.target.files)} />
                </label>
              </div>
            </Field>
            <FieldRow>
              <Button variant="primary" type="submit" icon={brief.trim() ? "auto_awesome" : "add"} busy={busy} disabled={!title.trim() || busy}>
                {brief.trim() ? "create with an agent" : "create presentation"}
              </Button>
              <Button variant="quiet" href={project ? `/projects/${enc(project)}/presentations` : "/presentations"}>
                cancel
              </Button>
              {error && <span className="text-sm text-bad">{error}</span>}
            </FieldRow>
            <Hint>
              One folder {project ? <>under the project's <code>presentations/</code></> : <>under <code title={root}>{root ?? "the presentations root"}</code></>} with deck.md and an assets/ folder for pictures; it starts with a title slide and one content slide.
            </Hint>
          </FormStack>
        </form>
      </Panel>
    </Page>
  );
}

/* ---------- the editor ---------- */

type Draft = DeckDraft;

const briefKey = (at: DeckAt) => `kw-deck-brief:${at.project ?? ""}/${at.name}`;

/** What the agent gets for a new deck with a brief: outline first, then the slides. */
const buildBrief = (brief: string) =>
  `Build this presentation from my brief below. First answer with the outline (one line per slide), then write the slides into deck.md: replace the starter slides, use the theme's layouts and pieces (cards, kpis, flow, timeline, compare, charts, tables) where they fit the content, one idea per slide, and speaker notes for each. Keep the deck's title and theme.\n\nBrief:\n${brief}`;

const draftOf = (d: PresentationDetail): Draft => ({ title: d.title, template: d.template, css: d.deck.css ?? "", numbers: d.deck.numbers !== false, slides: d.deck.slides.map((s) => ({ ...s, extra: { ...s.extra } })) });
const firstLine = (s: SlideDef): string => s.content.split("\n").find((l) => l.trim() && !/^::.*::$/.test(l.trim()))?.replace(/^#+\s*/, "").replace(/[*_`]/g, "") ?? "";
const isHidden = (s: SlideDef) => s.extra?.hidden === true;
const SAMPLE_CHART = "```chart\nkind: column\ntitle: Chart title\ncategories: [A, B, C]\nseries:\n  - name: Series 1\n    values: [3, 5, 4]\n```";
const SAMPLE_TABLE = "| Item | Value |\n|---|---|\n| First | 1 |\n| Second | 2 |";
const SAMPLE_HTML = '<div class="callout"><strong>HTML:</strong> anything the browser can show — the theme\'s classes apply.</div>';
const SAMPLE_EMBED = "<!doctype html>\n<html><body style=\"margin:0;display:grid;place-items:center;height:100vh;font:40px system-ui\">\n<div id=n>0</div>\n<script>let i=0;setInterval(()=>n.textContent=++i,1000)</script>\n</body></html>";
/** Shapes are HTML boxes: they scale with their box and take the format panel's fill, border, corners and rotation. */
const SHAPES: { name: string; icon: string; html: string; w: number; h: number; patch?: SlotPatch }[] = [
  { name: "Rectangle", icon: "rectangle", html: "<div></div>", w: 3, h: 1.8, patch: { fill: "accent" } },
  { name: "Rounded", icon: "rounded_corner", html: "<div></div>", w: 3, h: 1.8, patch: { fill: "accent", radius: 12 } },
  { name: "Circle", icon: "circle", html: "<div></div>", w: 2, h: 2, patch: { fill: "accent", radius: 999 } },
  { name: "Line", icon: "horizontal_rule", html: '<svg viewBox="0 0 100 10" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible"><line x1="0" y1="5" x2="100" y2="5" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>', w: 4, h: 0.3, patch: { color: "text" } },
  { name: "Arrow", icon: "arrow_right_alt", html: '<svg viewBox="0 0 100 20" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible"><line x1="0" y1="10" x2="92" y2="10" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke"/><polygon points="88,2 100,10 88,18" fill="currentColor"/></svg>', w: 4, h: 0.5, patch: { color: "accent" } },
  { name: "Star", icon: "star", html: '<svg viewBox="0 0 100 100" style="width:100%;height:100%"><polygon points="50,4 61,38 97,38 68,59 79,94 50,73 21,94 32,59 3,38 39,38" fill="currentColor"/></svg>', w: 1.6, h: 1.6, patch: { color: "accent" } },
];

/** What ⌘C took: boxes with their settings and text, pasted onto any slide. */
let clipboard: { kind: SlotView["kind"]; patch: SlotPatch; md: string; base: string }[] = [];

function DeckEditor({ project, name }: DeckAt) {
  const at: DeckAt = { project, name };
  const query = queryOf(project);
  const detail = useApi("presentations.get", { name, query }, { interval: 4000 });
  // The tasks that link this deck (presentation:<name> in their refs): listed in the share menu.
  const links = useApi("presentations.links", { name, query }, { interval: 30_000 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [editSlot, setEditSlot] = useState<string | null>(null);
  /** The slot whose source (HTML, chart data, embed, markdown with HTML) is open beside the slide. */
  const [sourceSlot, setSourceSlot] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "format" | "design" | "chat" | "comments" | "history" | "markdown" | "source">("none");
  /** The box a new comment will be about. */
  const [commentSlot, setCommentSlot] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [dragThumb, setDragThumb] = useState<number | null>(null);
  const [menu, setMenu] = useState<"none" | "slide" | "insert" | "shapes" | "present" | "zoom" | "share">("none");
  const [thumbMenu, setThumbMenu] = useState<{ i: number; x: number; y: number } | null>(null);
  const [grid, setGrid] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [assetRev, setAssetRev] = useState(0);
  const [stageW, setStageW] = useState(0);
  const [chatId, setChatId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(chatKey(at));
    } catch {
      return null;
    }
  });
  const [ask, setAsk] = useState("");
  const [pasteTick, setPasteTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seen = useRef<string | undefined>(undefined);
  const picker = useRef<HTMLInputElement>(null);
  const pickFor = useRef<string | null>(null);
  const askInput = useRef<HTMLInputElement>(null);
  const past = useRef<{ draft: Draft; mark?: string; at: number }[]>([]);
  const future = useRef<Draft[]>([]);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  /** The deck as last read from or written to the server: what a merge compares against. */
  const baseRef = useRef<Draft | null>(null);

  // The server's deck becomes the draft while nothing is being edited here; an edit elsewhere (an agent, the CLI) shows up on the next poll.
  useEffect(() => {
    if (!detail) return;
    if (!dirty && !editSlot && detail.updatedAt !== seen.current) {
      seen.current = detail.updatedAt;
      baseRef.current = draftOf(detail);
      setDraft(draftOf(detail));
      if (source === null || panel !== "source") setSource(detail.source);
    }
  }, [detail, dirty, panel, source, editSlot]);

  const save = useCallback(
    async (next: Draft) => {
      setSaving(true);
      setError("");
      const r = await api.request("presentations.save", { name, query, body: { title: next.title, template: next.template, numbers: next.numbers !== false, slides: next.slides, ...(seen.current ? { base: seen.current } : {}) } });
      setSaving(false);
      if (!r.ok && r.status === 409) {
        // Changed elsewhere since it was read here: take theirs, put this editor's changes on top, save again.
        const fresh = await api.call("presentations.get", { name, query }).catch(() => null);
        if (!fresh || !baseRef.current) return setError("the deck changed elsewhere; reload to see it");
        const { draft: merged, lost } = mergeDrafts(baseRef.current, next, draftOf(fresh));
        seen.current = fresh.updatedAt;
        baseRef.current = draftOf(fresh);
        draftRef.current = merged;
        setDraft(merged);
        setNotice(lost.length ? `Changed elsewhere meanwhile: your edit to slide ${lost.join(", ")} gave way to theirs (⌘Z brings it back).` : "Changed elsewhere meanwhile: merged with your edits.");
        return void save(merged);
      }
      if (!r.ok) return setError(failure(r));
      baseRef.current = next;
      // The deck's CSS rides in the headmatter: written with the source when it changed.
      if ((r.data.deck.css ?? "") !== next.css) {
        const head = next.css.trim();
        const src = r.data.source.replace(/^---\n([\s\S]*?)\n---\n/, (_m, h: string) => `---\n${h.replace(/^css: [\s\S]*?(?=^\S|$(?![\s\S]))/m, "").replace(/\n+$/, "")}${head ? `\ncss: |\n${head.split("\n").map((l) => `  ${l}`).join("\n")}` : ""}\n---\n`);
        const r2 = await api.request("presentations.save", { name, query, body: { source: src } });
        if (!r2.ok) return setError(failure(r2));
        seen.current = r2.data.updatedAt;
        setSource(r2.data.source);
      } else {
        seen.current = r.data.updatedAt;
        setSource(r.data.source);
      }
      setDirty(false);
    },
    [name, project],
  );
  /** Change the draft; `mark` coalesces a run of the same edit (typing, dragging) into one undo step. */
  const update = (fn: (d: Draft) => Draft, mark?: string) => {
    const cur = draftRef.current;
    if (!cur) return;
    const next = fn(cur);
    const last = past.current[past.current.length - 1];
    if (!(mark && last?.mark === mark && Date.now() - last.at < 1500)) past.current.push({ draft: cur, mark, at: Date.now() });
    else last.at = Date.now();
    if (past.current.length > 200) past.current.shift();
    future.current = [];
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), 600);
  };
  const jump = (to: Draft) => {
    draftRef.current = to;
    setDraft(to);
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(to), 600);
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev || !draftRef.current) return;
    future.current.push(draftRef.current);
    jump(prev.draft);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next || !draftRef.current) return;
    past.current.push({ draft: draftRef.current, at: Date.now() });
    jump(next);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const themes = detail?.themes ?? [];
  const theme = (draft && themes.find((t) => t.slug === draft.template)) ?? detail?.theme;
  useDeckCss(theme ? [theme, ...themes.filter((t) => t.slug !== theme.slug)] : [], draft?.css);
  const version = `${detail?.updatedAt ?? ""}-${assetRev}`;
  const asset = useMemo(() => assetOf(at, version), [name, project, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const slides = draft?.slides ?? [];
  const idx = Math.min(selected, Math.max(0, slides.length - 1));
  const slide = slides[idx];
  const view = useView(slide, theme, asset);
  const shownCount = slides.filter((s) => !isHidden(s)).length;
  // The deck's `numbers: false` leaves the slides without numbers (a slide's own `number: false` is the view's).
  const numberOf = (i: number) => (draft?.numbers === false ? undefined : { n: slides.slice(0, i + 1).filter((s) => !isHidden(s)).length, of: shownCount });

  const setSlide = (patch: Partial<SlideDef>, mark?: string) => update((d) => ({ ...d, slides: d.slides.map((s, i) => (i === idx ? { ...s, ...patch } : s)) }), mark);
  const setSlotText = (slotName: string, md: string, mark?: string) => {
    if (!slide || !view || !theme) return;
    setSlide({ content: setSlot(slide.content, slotName, md, defaultOf(theme, view.layout)) }, mark);
  };

  // ⌘Z / ⇧⌘Z anywhere but in a text field; ⌘K (or /) focuses the ask field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        redo();
      } else if (!typing && e.key === "PageDown") setSelected((v) => Math.min(v + 1, slides.length - 1));
      else if (!typing && e.key === "PageUp") setSelected((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const others = usePresence(at, idx + 1, sel.length === 1 ? sel[0] : undefined, !!draft);

  // A deck created with a brief: hand it to the agent beside the deck, once.
  const sendRef = useRef<((text: string) => void) | null>(null);
  const loaded = !!detail && !!draft;
  useEffect(() => {
    if (!loaded) return;
    let brief: string | null = null;
    try {
      brief = sessionStorage.getItem(briefKey(at));
      if (brief) sessionStorage.removeItem(briefKey(at));
    } catch {
      /* no storage */
    }
    if (brief) sendRef.current?.(buildBrief(brief));
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!detail || !draft || !theme) return <EmptyState>loading…</EmptyState>;
  const layouts = Object.entries(theme.layouts);
  const deckWarnings = detail.warnings.filter((w) => w.slide === 0);
  const slideWarnings = (n: number) => detail.warnings.filter((w) => w.slide === n);
  const back = project ? `/projects/${enc(project)}/presentations` : "/presentations";

  const pick = (i: number) => {
    setSelected(i);
    setSel([]);
    setEditSlot(null);
    setSourceSlot(null);
  };
  const addSlide = (layout: string) => {
    update((d) => ({ ...d, slides: [...d.slides.slice(0, idx + 1), { layout, extra: {}, content: "" }, ...d.slides.slice(idx + 1)] }));
    pick(idx + 1);
    setMenu("none");
  };
  const duplicateSlide = (i: number) => {
    // A copy is a slide of its own: the comments stay with the original (its id is not copied).
    const copy = (s: SlideDef): SlideDef => {
      const extra = structuredClone(s.extra ?? {});
      delete extra.id;
      return { ...s, extra };
    };
    update((d) => ({ ...d, slides: [...d.slides.slice(0, i + 1), copy(d.slides[i]), ...d.slides.slice(i + 1)] }));
    pick(i + 1);
  };
  const removeSlide = (i: number) => {
    if (slides.length <= 1) return;
    update((d) => ({ ...d, slides: d.slides.filter((_, j) => j !== i) }));
    pick(Math.max(0, i <= idx ? idx - 1 : idx));
  };
  const toggleHidden = (i: number) =>
    update((d) => ({
      ...d,
      slides: d.slides.map((s, j) => {
        if (j !== i) return s;
        const extra = { ...s.extra };
        if (extra.hidden === true) delete extra.hidden;
        else extra.hidden = true;
        return { ...s, extra };
      }),
    }));
  const moveSlide = (from: number, to: number) => {
    if (from === to || to < 0 || to >= slides.length) return;
    update((d) => {
      const next = [...d.slides];
      const [s] = next.splice(from, 1);
      next.splice(to, 0, s);
      return { ...d, slides: next };
    });
    pick(to);
  };

  const freeName = (prefix: string, taken: Set<string>) => {
    let n = 1;
    while (taken.has(`${prefix}${n}`)) n++;
    taken.add(`${prefix}${n}`);
    return `${prefix}${n}`;
  };
  /** A new box on the slide: a slot of the slide's own, filled and selected. */
  const insert = (kind: SlotView["kind"], prefix: string, text: string, w: number, h: number, then: "edit" | "source" | "none", extra: SlotPatch = {}) => {
    if (!slide || !view) return;
    const slotName = freeName(prefix, new Set(view.slots.map((s) => s.name)));
    const canvasW = STAGE_W / PPI;
    const canvasH = stageHeight(theme.size) / PPI;
    const box = { x: round((canvasW - w) / 2), y: round((canvasH - h) / 2), w, h };
    setSlide({ ...withPatches(slide, { [slotName]: { kind, ...box, ...(kind === "markdown" || kind === "text" ? { size: 18 } : kind === "table" || kind === "chart" ? { size: 13 } : kind === "html" ? { size: 15 } : {}), ...extra } }), content: setSlot(slide.content, slotName, text, defaultOf(theme, view.layout)) });
    setSel([slotName]);
    setEditSlot(then === "edit" ? slotName : null);
    setSourceSlot(then === "source" ? slotName : null);
    setMenu("none");
  };
  const upload = async (file: File): Promise<string | null> => {
    setError("");
    const r = await api.request("presentations.upload", { name, query, headers: { "x-file-name": encodeURIComponent(file.name), "content-type": file.type || "application/octet-stream" }, body: file }).catch(() => null);
    if (!r?.ok) {
      setError(r ? failure(r) : `could not upload ${file.name}`);
      return null;
    }
    setAssetRev((v) => v + 1);
    return r.data.path;
  };
  const insertPicture = async (file: File, into?: string | null) => {
    if (!slide || !view) return;
    const path = await upload(file);
    if (!path) return;
    const md = `![${file.name.replace(/\.[^.]+$/, "")}](${path})`;
    // The given slot, else the layout's own picture slot while it is empty, else a free picture box.
    const target = (into && view.slots.find((s) => s.name === into)) || view.slots.find((s) => s.kind === "image" && !s.md);
    if (target) {
      setSlotText(target.name, md);
      setSel([target.name]);
    } else insert("image", "image", md, 4, 3, "none");
  };

  /* Boxes: remove, duplicate, copy, paste. */
  const removeBoxes = (names: string[]) => {
    if (!slide || !view) return;
    const dflt = defaultOf(theme, view.layout);
    let content = slide.content;
    const changes: Record<string, SlotPatch | null> = {};
    for (const n of names) {
      const s = view.slots.find((x) => x.name === n);
      if (!s) continue;
      content = setSlot(content, n, "", dflt);
      if (s.own) changes[n] = null;
    }
    setSlide({ ...withPatches(slide, changes), content });
    setSel([]);
    if (sourceSlot && names.includes(sourceSlot)) setSourceSlot(null);
  };
  const copyBoxes = (names: string[]) => {
    if (!slide || !view) return;
    clipboard = view.slots
      .filter((s) => names.includes(s.name))
      .map((s) => {
        const own = patchesOf(slide)[s.name] ?? {};
        return { kind: s.kind, base: s.name.replace(/\d+$/, "") || "box", md: s.md ?? "", patch: { ...own, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h, ...(s.size ? { size: s.size } : {}), ...(s.color ? { color: s.color } : {}), ...(s.bold ? { bold: true } : {}), ...(s.italic ? { italic: true } : {}), ...(s.align ? { align: s.align } : {}), ...(s.valign ? { valign: s.valign } : {}), ...(s.font ? { font: s.font } : {}), ...(s.class ? { class: s.class } : {}) } };
      });
    setPasteTick((v) => v + 1);
  };
  const pasteBoxes = (offset = 0.2) => {
    if (!slide || !view || !clipboard.length) return;
    const taken = new Set(view.slots.map((s) => s.name));
    const changes: Record<string, SlotPatch> = {};
    let content = slide.content;
    const names: string[] = [];
    for (const c of clipboard) {
      const n = freeName(c.base, taken);
      changes[n] = { ...c.patch, x: round((c.patch.x ?? 0) + offset), y: round((c.patch.y ?? 0) + offset) };
      content = setSlot(content, n, c.md, defaultOf(theme, view.layout));
      names.push(n);
    }
    setSlide({ ...withPatches(slide, changes), content });
    setSel(names);
  };
  const duplicateBoxes = (names: string[]) => {
    copyBoxes(names);
    pasteBoxes();
  };
  const askAbout = (slotName: string, quick?: string) => {
    if (quick) return void sendToAgent(`In the box "${slotName}" on slide ${idx + 1}: ${quick}`);
    setAsk(`In the box "${slotName}" on slide ${idx + 1}: `);
    requestAnimationFrame(() => askInput.current?.focus());
  };

  /* Comments: on this slide by box, and how many are open per slide. */
  const comments: DeckComment[] = detail.comments ?? [];
  const open = comments.filter((c) => !c.resolved);
  const openOn = (n: number) => open.filter((c) => c.n === n).length;
  const pins: Record<string, number> = {};
  for (const c of open) if (c.n === idx + 1) pins[c.slot ?? ""] = (pins[c.slot ?? ""] ?? 0) + 1;
  const openComments = (slot?: string) => {
    setSourceSlot(null);
    setCommentSlot(slot);
    setPanel("comments");
  };
  const copyRef = async () => {
    const token = `presentation:${name}`;
    try {
      await navigator.clipboard.writeText(token);
      setNotice(`Copied ${token}: paste it into a chat, a task or a note, and it links here.`);
    } catch {
      setNotice(token);
    }
    setMenu("none");
  };
  const share = async (what: "edit" | "present") => {
    const href = `${location.origin}${location.pathname}#${deckHref(at)}${what === "present" ? "/present" : ""}`;
    try {
      await navigator.clipboard.writeText(href);
      setNotice(`Link copied: ${href}`);
    } catch {
      setNotice(href);
    }
    setMenu("none");
  };

  /* The agent beside the deck: one chat per deck, kept across visits. */
  const sendToAgent = async (given?: string) => {
    const text = (given ?? ask).trim();
    if (!text) return;
    setError("");
    const flag = project ? ` --project ${project}` : "";
    let id = chatId;
    let first = false;
    if (!id) {
      const scope = project ? { kind: "project", slug: project } : { kind: "general" };
      const r = await api.request("chats.create", { body: { agent: "claude", scope } });
      if (!r.ok) return setError(failure(r));
      id = r.data.id;
      first = true;
      setChatId(id);
      try {
        localStorage.setItem(chatKey(at), id);
      } catch {
        /* a private window: the chat lives as long as the page */
      }
    }
    const message = first
      ? `You are working on the presentation "${draft.title}" (presentation:${name}, file ${detail.path}/deck.md) beside me; I see every change you save at once. I am on slide ${idx + 1}. ${text}\n\n` +
        `Edit deck.md directly (slots hold markdown or HTML; \`npx kraftwerk presentations show ${name}${flag}\` lists the layouts, slots and the theme's pieces), then run \`npx kraftwerk presentations check ${name}${flag}\` and look at the PNGs \`npx kraftwerk presentations render ${name} --png${flag}\` writes before you answer. Keep your answer short.`
      : `(slide ${idx + 1}) ${text}`;
    const m = await api.request("chats.message", { id, body: { text: message } });
    if (!m.ok) return setError(failure(m));
    if (given === undefined) setAsk("");
    setPanel("chat");
    setSourceSlot(null);
  };

  sendRef.current = (text) => void sendToAgent(text);

  const openPanel = (p: typeof panel) => {
    setSourceSlot(null);
    setPanel((cur) => (cur === p ? "none" : p));
  };

  const sourceView = view?.slots.find((s) => s.name === sourceSlot) ?? null;
  const tool = "inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg";
  const group = "relative flex items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-1";
  const side = sourceView || panel !== "none";

  return (
    <div className="flex flex-col gap-3">
      {/* The bar: the deck, what goes on a slide, how it shows, how to show it and take it away. */}
      <header className="flex flex-wrap items-center gap-2" aria-label="presentation toolbar">
        <div className={group}>
          <IconButton icon="arrow_back" label="all presentations" size="sm" href={back} />
          <input value={draft.title} aria-label="presentation title" className="h-8 w-[200px] border-0 bg-transparent px-1 text-sm font-semibold text-fg outline-none" onChange={(e) => update((d) => ({ ...d, title: e.target.value }), "title")} />
        </div>
        <div className={group}>
          <button type="button" className={tool} aria-haspopup="menu" aria-expanded={menu === "slide"} onClick={() => setMenu((m) => (m === "slide" ? "none" : "slide"))}>
            <Icon name="add_to_photos" className="ms-sm" />
            slide
          </button>
          <button type="button" className={tool} title="a text box on this slide" onClick={() => insert("markdown", "text", "Text", 4, 0.9, "edit")}>
            <Icon name="title" className="ms-sm" />
            text
          </button>
          <button
            type="button"
            className={tool}
            title="a picture on this slide (png, jpg, gif) — or drop one onto the slide"
            onClick={() => {
              pickFor.current = null;
              picker.current?.click();
            }}
          >
            <Icon name="image" className="ms-sm" />
            picture
          </button>
          <button type="button" className={tool} title="a chart on this slide" onClick={() => insert("chart", "chart", SAMPLE_CHART, 6, 3.2, "source")}>
            <Icon name="bar_chart" className="ms-sm" />
            chart
          </button>
          <button type="button" className={tool} title="a table on this slide" onClick={() => insert("table", "table", SAMPLE_TABLE, 6, 1.6, "none")}>
            <Icon name="table" className="ms-sm" />
            table
          </button>
          <button type="button" className={tool} aria-haspopup="menu" aria-expanded={menu === "shapes"} title="rectangles, circles, lines, arrows" onClick={() => setMenu((m) => (m === "shapes" ? "none" : "shapes"))}>
            <Icon name="category" className="ms-sm" />
            shapes
          </button>
          <button type="button" className={tool} aria-haspopup="menu" aria-expanded={menu === "insert"} title="HTML, embeds and the theme's pieces" onClick={() => setMenu((m) => (m === "insert" ? "none" : "insert"))}>
            <Icon name="widgets" className="ms-sm" />
            more
          </button>
          {menu === "slide" && (
            <Menu label="new slide" onClose={() => setMenu("none")} className="absolute left-0 top-[calc(100%+6px)] w-[520px]">
              <div className="grid grid-cols-3 gap-2 p-1">
                {layouts.map(([lname, l]) => (
                  <button key={lname} type="button" role="menuitem" className="flex flex-col items-start gap-1 rounded-md p-1 text-left hover:bg-surface-2" title={l.description} onClick={() => addSlide(lname)}>
                    <Thumb slide={{ layout: lname, extra: {}, content: "" }} theme={theme} asset={asset} width={152} />
                    <span className="text-xs text-fg">{lname}</span>
                  </button>
                ))}
              </div>
            </Menu>
          )}
          {menu === "shapes" && (
            <Menu label="shapes" onClose={() => setMenu("none")} className="absolute left-0 top-[calc(100%+6px)] w-[240px]">
              {SHAPES.map((sh) => (
                <MenuItem key={sh.name} icon={sh.icon} title={sh.name} onClick={() => insert("html", sh.name.toLowerCase(), sh.html, sh.w, sh.h, "none", sh.patch)} />
              ))}
            </Menu>
          )}
          {menu === "insert" && (
            <Menu label="insert" onClose={() => setMenu("none")} className="absolute left-0 top-[calc(100%+6px)] w-[340px]">
              <MenuItem icon="code" title="HTML" sub="any markup; the theme's classes apply" onClick={() => insert("html", "html", SAMPLE_HTML, 6, 1.2, "source")} />
              <MenuItem icon="public" title="Embed" sub="a web page by URL, or a page of your own with scripts" onClick={() => insert("embed", "embed", SAMPLE_EMBED, 4, 2.4, "source")} />
              {theme.snippets.length > 0 && <div className="mt-1 border-t border-line px-2 pb-1 pt-2 text-[11px] uppercase tracking-wider text-fg-2">from the theme</div>}
              {theme.snippets.map((sn) => (
                <MenuItem key={sn.name} icon="dashboard_customize" title={sn.name} sub={sn.description} onClick={() => insert(sn.kind === "markdown" ? "markdown" : "html", sn.name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "piece", sn.content, Math.min(sn.w, STAGE_W / PPI), sn.h, "none")} />
              ))}
            </Menu>
          )}
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/gif"
            aria-label="picture file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void insertPicture(f, pickFor.current);
            }}
          />
        </div>
        {slide && !grid && (
          <div className={group}>
            <span className="pl-1.5 text-xs text-fg-2">layout</span>
            <select value={view?.layout ?? slide.layout ?? ""} aria-label="layout" className="h-8 cursor-pointer border-0 bg-transparent pr-1 text-sm text-fg outline-none" onChange={(e) => setSlide({ layout: e.target.value })}>
              {layouts.map(([lname, l]) => (
                <option key={lname} value={lname} title={l.description}>
                  {lname}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={group}>
          <button type="button" className={tool} disabled={!past.current.length} title="undo (⌘Z)" aria-label="undo" onClick={undo}>
            <Icon name="undo" className="ms-sm" />
          </button>
          <button type="button" className={tool} disabled={!future.current.length} title="redo (⇧⌘Z)" aria-label="redo" onClick={redo}>
            <Icon name="redo" className="ms-sm" />
          </button>
          <button type="button" className={tool} aria-haspopup="menu" aria-expanded={menu === "zoom"} aria-label="zoom" title="zoom" onClick={() => setMenu((m) => (m === "zoom" ? "none" : "zoom"))}>
            {zoom ? `${Math.round(zoom * 100)}%` : "fit"}
            <Icon name="expand_more" className="ms-sm" />
          </button>
          <button type="button" className={cn(tool, grid && "bg-surface-2 text-fg")} aria-pressed={grid} aria-label="grid view" title="all slides at once" onClick={() => setGrid((v) => !v)}>
            <Icon name="grid_view" className="ms-sm" />
          </button>
          {menu === "zoom" && (
            <Menu label="zoom" onClose={() => setMenu("none")} className="absolute right-0 top-[calc(100%+6px)] w-[140px]">
              {[null, 0.5, 0.75, 1, 1.5].map((z) => (
                <MenuItem
                  key={String(z)}
                  title={z ? `${z * 100}%` : "fit"}
                  onClick={() => {
                    setZoom(z);
                    setMenu("none");
                  }}
                />
              ))}
            </Menu>
          )}
        </div>
        <span className="flex-1" />
        {others.length > 0 && (
          <div className="flex items-center -space-x-1.5" role="group" aria-label="also here">
            {others.map((o) => (
              <button key={o.client} type="button" title={`${o.who} · slide ${o.slide}${o.slot ? ` · ${o.slot}` : ""}`} aria-label={`${o.who} on slide ${o.slide}`} className="grid h-7 w-7 place-items-center rounded-full border-2 border-bg text-[11px] font-semibold uppercase text-white" style={{ background: o.color }} onClick={() => pick(o.slide - 1)}>
                {o.who.replace(/[^a-z0-9]/gi, "").slice(0, 2) || "?"}
              </button>
            ))}
          </div>
        )}
        <span className="text-xs text-fg-2" aria-live="polite">
          {saving ? "saving…" : dirty ? "unsaved" : detail.updatedAt ? `saved ${fmtAgo(detail.updatedAt)}` : ""}
        </span>
        <div className={group}>
          <button type="button" className={cn(tool, panel === "format" && "bg-surface-2 text-fg")} aria-pressed={panel === "format"} onClick={() => openPanel("format")}>
            <Icon name="tune" className="ms-sm" />
            format
          </button>
          <button type="button" className={cn(tool, panel === "design" && "bg-surface-2 text-fg")} aria-pressed={panel === "design"} onClick={() => openPanel("design")}>
            <Icon name="palette" className="ms-sm" />
            design
          </button>
          <button type="button" className={cn(tool, panel === "chat" && "bg-surface-2 text-fg")} aria-pressed={panel === "chat"} onClick={() => openPanel("chat")}>
            <Icon name="forum" className="ms-sm" />
            chat
          </button>
          <button type="button" className={cn(tool, panel === "comments" && "bg-surface-2 text-fg")} aria-pressed={panel === "comments"} aria-label="comments" onClick={() => (panel === "comments" ? setPanel("none") : openComments(sel.length === 1 ? sel[0] : undefined))}>
            <Icon name="comment" className="ms-sm" />
            {open.length > 0 && <span className="rounded-full bg-[#f59e0b] px-1.5 text-[11px] font-semibold text-black">{open.length}</span>}
          </button>
          <button type="button" className={cn(tool, panel === "history" && "bg-surface-2 text-fg")} aria-pressed={panel === "history"} aria-label="version history" title="version history" onClick={() => openPanel("history")}>
            <Icon name="history" className="ms-sm" />
          </button>
          <button type="button" className={tool} aria-haspopup="menu" aria-expanded={menu === "share"} aria-label="share" onClick={() => setMenu((m) => (m === "share" ? "none" : "share"))}>
            <Icon name="share" className="ms-sm" />
          </button>
          {menu === "share" && (
            <Menu label="share" onClose={() => setMenu("none")} className="absolute right-0 top-[calc(100%+6px)] w-[280px]">
              <MenuItem icon="link" title="Copy link to the editor" sub="for anyone with this workspace (paired devices, members)" onClick={() => void share("edit")} />
              <MenuItem icon="slideshow" title="Copy link to present mode" onClick={() => void share("present")} />
              <MenuItem icon="html" title="Download as one HTML file" sub="opens anywhere, no kraftwerk needed" onClick={() => (setMenu("none"), (window.location.href = exportHref(at, "html")))} />
              <MenuItem icon="alternate_email" title="Copy reference" sub={`presentation:${name} — paste into a chat, a task or a note`} onClick={() => void copyRef()} />
              <MenuSep />
              <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-2">linked from tasks</div>
              {links?.tasks.length ? (
                links.tasks.map((t) => <MenuItem key={t.ref} icon="task_alt" title={`${t.number} ${t.title}`} sub={`${t.project ? `${t.project} · ` : ""}${t.board} · ${t.status}${t.assignee ? ` · ${t.assignee}` : ""}`} onClick={() => (setMenu("none"), navigate(t.href))} />)
              ) : (
                <div className="px-2 pb-1.5 text-xs text-fg-2">none yet — link the deck from a task's links</div>
              )}
            </Menu>
          )}
        </div>
        <div className={group}>
          <Link href={`${deckHref(at)}/present`} className={cn(tool, "font-semibold text-fg no-underline")} aria-label="present">
            <Icon name="play_arrow" className="ms-sm" />
            present
          </Link>
          <button type="button" className={cn(tool, "px-1")} aria-haspopup="menu" aria-expanded={menu === "present"} aria-label="present options" onClick={() => setMenu((m) => (m === "present" ? "none" : "present"))}>
            <Icon name="expand_more" className="ms-sm" />
          </button>
          <a className={cn(tool, "no-underline")} href={exportHref(at, "pptx")} download title="download as PowerPoint" aria-label="pptx">
            <Icon name="download" className="ms-sm" />
            pptx
          </a>
          <a className={cn(tool, "no-underline")} href={exportHref(at, "pdf")} download title="download as PDF" aria-label="pdf">
            <Icon name="picture_as_pdf" className="ms-sm" />
          </a>
          <a className={cn(tool, "no-underline")} href={exportHref(at, "html")} download title="download as one HTML file" aria-label="html">
            <Icon name="html" className="ms-sm" />
          </a>
          {menu === "present" && (
            <Menu label="present" onClose={() => setMenu("none")} className="absolute left-0 top-[calc(100%+6px)] w-[230px]">
              <MenuItem icon="play_arrow" title="From the start" onClick={() => navigate(`${deckHref(at)}/present`)} />
              <MenuItem icon="slideshow" title={`From slide ${idx + 1}`} onClick={() => navigate(`${deckHref(at)}/present/${idx + 1}`)} />
              <MenuItem icon="co_present" title="With notes (presenter view)" sub="current and next slide, notes, a clock" onClick={() => navigate(`${deckHref(at)}/presenter/${idx + 1}`)} />
            </Menu>
          )}
        </div>
        <div className={group}>
          <button type="button" className={cn(tool, panel === "markdown" && "bg-surface-2 text-fg")} aria-pressed={panel === "markdown"} title="this slide's markdown" onClick={() => openPanel("markdown")}>
            <Icon name="notes" className="ms-sm" />
            <span className="sr-only">markdown</span>
          </button>
          <button type="button" className={cn(tool, panel === "source" && "bg-surface-2 text-fg")} aria-pressed={panel === "source"} title="the whole deck.md" onClick={() => openPanel("source")}>
            <Icon name="code" className="ms-sm" />
            <span className="sr-only">source</span>
          </button>
          {confirmRemove ? (
            <span className="flex items-center gap-1 pl-1">
              <Button size="sm" variant="danger" onClick={() => void remove()}>
                move to trash
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(false)}>
                keep
              </Button>
            </span>
          ) : (
            <IconButton icon="delete" label="remove presentation" size="sm" onClick={() => setConfirmRemove(true)} />
          )}
        </div>
      </header>
      {error && <Notice tone="bad">{error}</Notice>}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" role="status">
          <Icon name="info" className="ms-sm text-fg-2" />
          <span className="min-w-0 flex-1 truncate">{notice}</span>
          <IconButton icon="close" label="dismiss" size="sm" onClick={() => setNotice("")} />
        </div>
      )}
      {deckWarnings.length > 0 && <Warnings items={deckWarnings} />}

      {panel === "source" ? (
        <Panel title="deck.md">
          <FormStack>
            <TextArea
              value={source ?? ""}
              aria-label="deck source"
              spellCheck={false}
              className="min-h-[60vh] font-mono text-[13px] leading-5"
              onChange={(e) => {
                setSource(e.target.value);
                setDirty(true);
              }}
            />
            <FieldRow>
              <Button variant="primary" icon="save" busy={saving} disabled={!dirty || saving} onClick={() => void saveSource()}>
                save deck.md
              </Button>
              <Hint>
                <code>{detail.path}/deck.md</code> — slides are separated by <code>---</code> lines; a YAML block right after one sets <code>layout:</code> and <code>slots:</code>; <code>::slot::</code> marks a slot, <code>::notes::</code> the speaker notes.
              </Hint>
            </FieldRow>
          </FormStack>
        </Panel>
      ) : (
        <div className={cn("grid items-start gap-4", side ? "grid-cols-[172px_minmax(0,1fr)_minmax(300px,380px)]" : "grid-cols-[172px_minmax(0,1fr)]")}>
          {/* The slides, numbered; drag to reorder, right click for more. */}
          <div className="sticky top-3 flex max-h-[calc(100vh-130px)] flex-col gap-2 overflow-auto rounded-xl border border-line bg-surface p-2">
            <div className="flex items-center px-1 text-xs text-fg-2">
              <span>
                {slides.length} {slides.length === 1 ? "slide" : "slides"}
              </span>
              <span className="flex-1" />
              <IconButton icon="add" label="add slide" size="sm" onClick={() => addSlide(view?.layout && view.layout !== "title" ? view.layout : (theme.default ?? "content"))} />
            </div>
            <div className="flex flex-col gap-2" role="list" aria-label="slides">
              {slides.map((s, i) => (
                <div
                  key={i}
                  role="listitem"
                  aria-current={i === idx}
                  draggable
                  className={cn("group relative flex items-start gap-1.5", dragThumb === i && "opacity-40")}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragThumb(i);
                  }}
                  onDragOver={(e) => {
                    if (dragThumb !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragThumb !== null) moveSlide(dragThumb, i);
                    setDragThumb(null);
                  }}
                  onDragEnd={() => setDragThumb(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    pick(i);
                    setThumbMenu({ i, x: e.clientX, y: e.clientY });
                  }}
                >
                  <span className={cn("w-4 pt-1 text-right text-[11px]", i === idx ? "font-semibold text-fg" : "text-fg-2")}>{i + 1}</span>
                  <button
                    type="button"
                    aria-label={`slide ${i + 1}${isHidden(s) ? " (hidden)" : ""}`}
                    className={cn("min-w-0 flex-1 overflow-hidden rounded-md border-2", i === idx ? "border-accent" : "border-transparent hover:border-line-strong", isHidden(s) && "opacity-45")}
                    title={firstLine(s)}
                    onClick={() => pick(i)}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" || e.key === "Delete") {
                        e.preventDefault();
                        removeSlide(i);
                      } else if (e.key === "ArrowDown" && e.altKey) moveSlide(i, i + 1);
                      else if (e.key === "ArrowUp" && e.altKey) moveSlide(i, i - 1);
                    }}
                  >
                    <Thumb slide={s} theme={theme} asset={asset} width={136} number={numberOf(i)} />
                  </button>
                  {others.some((o) => o.slide === i + 1) && (
                    <span className="pointer-events-none absolute left-6 top-1 flex gap-0.5" aria-label={`${others.filter((o) => o.slide === i + 1).map((o) => o.who).join(", ")} here`}>
                      {others.filter((o) => o.slide === i + 1).map((o) => <span key={o.client} className="h-2.5 w-2.5 rounded-full border border-white" style={{ background: o.color }} />)}
                    </span>
                  )}
                  {openOn(i + 1) > 0 && <span className="pointer-events-none absolute right-1 bottom-1 rounded-full bg-[#f59e0b] px-1.5 text-[10px] font-semibold text-black" aria-label={`${openOn(i + 1)} open comments`}>{openOn(i + 1)}</span>}
                  {isHidden(s) && <Icon name="visibility_off" className="ms-sm pointer-events-none absolute left-[calc(50%+4px)] top-[calc(50%-10px)] text-fg-2" />}
                  {slideWarnings(i + 1).length > 0 && <Icon name={slideWarnings(i + 1).some((w) => w.level === "error") ? "error" : "warning"} className={cn("ms-sm absolute left-6 top-1", slideWarnings(i + 1).some((w) => w.level === "error") ? "text-bad" : "text-ask")} />}
                  <span className="absolute right-1 top-1 hidden gap-0.5 rounded-md bg-surface/90 group-hover:flex">
                    <IconButton icon="content_copy" label={`duplicate slide ${i + 1}`} size="sm" onClick={() => duplicateSlide(i)} />
                    <IconButton icon="delete" label={`remove slide ${i + 1}`} size="sm" disabled={slides.length <= 1} onClick={() => removeSlide(i)} />
                  </span>
                </div>
              ))}
            </div>
          </div>
          {thumbMenu && (
            <Menu label="slide actions" onClose={() => setThumbMenu(null)} className="fixed w-[220px]" style={{ left: thumbMenu.x, top: thumbMenu.y }}>
              <MenuItem icon="library_add" title="Duplicate" onClick={() => (duplicateSlide(thumbMenu.i), setThumbMenu(null))} />
              <MenuItem icon={isHidden(slides[thumbMenu.i]) ? "visibility" : "visibility_off"} title={isHidden(slides[thumbMenu.i]) ? "Show" : "Hide"} sub="hidden slides stay out of present mode and the exports" onClick={() => (toggleHidden(thumbMenu.i), setThumbMenu(null))} />
              <MenuItem icon="arrow_upward" title="Move up" keys="⌥↑" disabled={thumbMenu.i === 0} onClick={() => (moveSlide(thumbMenu.i, thumbMenu.i - 1), setThumbMenu(null))} />
              <MenuItem icon="arrow_downward" title="Move down" keys="⌥↓" disabled={thumbMenu.i >= slides.length - 1} onClick={() => (moveSlide(thumbMenu.i, thumbMenu.i + 1), setThumbMenu(null))} />
              <MenuSep />
              <MenuItem icon="delete" title="Delete" keys="⌫" danger disabled={slides.length <= 1} onClick={() => (removeSlide(thumbMenu.i), setThumbMenu(null))} />
            </Menu>
          )}

          {/* The slide itself — or all of them. */}
          {grid ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4" role="list" aria-label="all slides">
              {slides.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  role="listitem"
                  className={cn("flex flex-col gap-1 rounded-md p-1 text-left hover:bg-surface-2", i === idx && "ring-2 ring-accent", isHidden(s) && "opacity-45")}
                  onClick={() => {
                    pick(i);
                    setGrid(false);
                  }}
                >
                  <Thumb slide={s} theme={theme} asset={asset} width={280} number={numberOf(i)} />
                  <span className="text-xs text-fg-2">
                    {i + 1} · {firstLine(s) || s.layout}
                    {isHidden(s) ? " · hidden" : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            slide &&
            view && (
              <div className="flex min-w-0 flex-col items-center gap-2">
                <Stage
                  view={view}
                  theme={theme}
                  slide={slide}
                  number={numberOf(idx)}
                  zoom={zoom}
                  selected={sel}
                  editing={editSlot}
                  onSelect={(names) => {
                    setSel(names);
                    if (sourceSlot && !names.includes(sourceSlot)) setSourceSlot(null);
                  }}
                  onEditing={setEditSlot}
                  onSource={(n) => {
                    const s = view.slots.find((x) => x.name === n);
                    if (s?.kind === "image") {
                      pickFor.current = n;
                      picker.current?.click();
                    } else {
                      setSourceSlot(n);
                    }
                  }}
                  onPatches={(changes, mark) => setSlide(withPatches(slide, changes), mark)}
                  onText={(n, md) => setSlotText(n, md)}
                  onRemove={removeBoxes}
                  onDuplicate={duplicateBoxes}
                  onCopy={copyBoxes}
                  onPaste={() => pasteBoxes()}
                  canPaste={pasteTick >= 0 && clipboard.length > 0}
                  onAsk={askAbout}
                  onFormat={() => {
                    setSourceSlot(null);
                    setPanel("format");
                  }}
                  onDropFile={(f) => void insertPicture(f)}
                  onWidth={setStageW}
                  pins={pins}
                  others={others.filter((o) => o.slide === idx + 1 && o.slot).map((o) => ({ slot: o.slot!, who: o.who, color: o.color }))}
                  onComments={openComments}
                />
                <div className="flex w-full items-start gap-3" style={{ maxWidth: stageW || undefined }}>
                  <div className="min-w-0 flex-1">{slideWarnings(idx + 1).length > 0 ? <Warnings items={slideWarnings(idx + 1)} /> : <span className="text-xs text-fg-2">no warnings on this slide · double click a box to edit it · ⇧ or a frame for several · right click for more</span>}</div>
                  <button type="button" className="flex items-center gap-1 text-xs text-fg-2 hover:text-fg" aria-expanded={notesOpen} onClick={() => setNotesOpen((v) => !v)}>
                    <Icon name={notesOpen ? "expand_less" : "expand_more"} className="ms-sm" />
                    speaker notes{slide.notes?.trim() ? " ·" : ""}
                  </button>
                </div>
                <div className="flex w-full flex-col gap-2" style={{ maxWidth: stageW || undefined }}>
                  {notesOpen && <TextArea value={slide.notes ?? ""} aria-label="speaker notes" rows={3} placeholder="what you say on this slide" onChange={(e) => setSlide({ notes: e.target.value }, "notes")} />}
                  <form
                    className="mt-1 flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void sendToAgent();
                    }}
                  >
                    <Icon name="auto_awesome" className="ms-sm text-fg-2" />
                    <input ref={askInput} value={ask} aria-label="ask an agent" placeholder={`ask an agent to change slide ${idx + 1} or the deck…`} className="h-8 min-w-0 flex-1 border-0 bg-transparent text-sm text-fg outline-none placeholder:text-fg-2" onChange={(e) => setAsk(e.target.value)} />
                    <IconButton icon="arrow_upward" label="send to an agent" size="sm" disabled={!ask.trim()} onClick={() => void sendToAgent()} />
                  </form>
                </div>
              </div>
            )
          )}

          {/* Beside the slide: a box's source, the format, the design, the chat, the slide's markdown. */}
          {sourceView && slide ? (
            <SourcePanel key={`${idx}:${sourceView.name}`} s={sourceView} onChange={(md) => setSlotText(sourceView.name, md, `src:${sourceView.name}`)} onClose={() => setSourceSlot(null)} />
          ) : panel === "format" && slide && view ? (
            <FormatPanel theme={theme} slide={slide} view={view} selected={sel} assets={detail.assets} onPatches={(changes, mark) => setSlide(withPatches(slide, changes), mark)} onSlide={(patch) => setSlide(patch)} numbers={draft.numbers !== false} onNumbers={(on) => update((d) => ({ ...d, numbers: on }))} onUpload={upload} onClose={() => setPanel("none")} />
          ) : panel === "design" ? (
            <DesignPanel themes={themes} current={draft.template} css={draft.css} slide={slide} asset={asset} onTemplate={(t) => update((d) => ({ ...d, template: t }))} onCss={(css) => update((d) => ({ ...d, css }), "css")} />
          ) : panel === "history" ? (
            <HistoryPanel
              at={at}
              theme={theme}
              asset={asset}
              onRestore={(v) => {
                update((d) => ({ ...d, title: v.deck.title || d.title, template: v.deck.template || d.template, css: v.deck.css ?? "", numbers: v.deck.numbers !== false, slides: v.deck.slides.map((x) => ({ ...x, extra: { ...x.extra } })) }));
                setSelected(0);
                setNotice(`Restored the version from ${new Date(v.at).toLocaleString()}. ⌘Z takes it back; the version before it is in the history too.`);
              }}
              onClose={() => setPanel("none")}
            />
          ) : panel === "comments" ? (
            <CommentsPanel at={at} comments={comments} slide={idx + 1} slot={commentSlot} onSlot={setCommentSlot} onGo={(n, slot) => (pick(n - 1), slot && setSel([slot]))} onClose={() => setPanel("none")} />
          ) : panel === "chat" ? (
            <div className="sticky top-3 flex h-[calc(100vh-130px)] flex-col overflow-hidden rounded-xl border border-line bg-surface" role="region" aria-label="agent chat">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
                <Icon name="forum" className="ms-sm text-fg-2" />
                <span className="font-semibold">Agent</span>
                <span className="text-xs text-fg-2">edits deck.md; the slide follows</span>
                <span className="flex-1" />
                {chatId && (
                  <IconButton
                    icon="add_comment"
                    label="new chat"
                    size="sm"
                    onClick={() => {
                      setChatId(null);
                      try {
                        localStorage.removeItem(chatKey(at));
                      } catch {
                        /* ignore */
                      }
                    }}
                  />
                )}
                <IconButton icon="close" label="close chat" size="sm" onClick={() => setPanel("none")} />
              </div>
              {chatId ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <ChatThread key={chatId} id={chatId} />
                </div>
              ) : (
                <EmptyState icon="auto_awesome">Ask below the slide: “make slide 3 a comparison”, “add a chart of these numbers”, “tighten every title”. The agent edits the deck and you watch it change.</EmptyState>
              )}
            </div>
          ) : panel === "markdown" && slide ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1 text-xs text-fg-2">
                slots:
                {view?.slots.map((s) => (
                  <code key={s.name} className="rounded bg-surface-2 px-1" title={`${s.kind}${s.required ? ", required" : ""}`}>
                    {s.name === "title" ? "# title" : `::${s.name}::`}
                  </code>
                ))}
              </div>
              <TextArea value={slide.content} aria-label="slide content" spellCheck={false} className="min-h-[380px] font-mono text-[13px] leading-5" onChange={(e) => setSlide({ content: e.target.value }, "md")} />
              {detail.assets.length > 0 && <span className="text-xs text-fg-2">pictures: {detail.assets.join(", ")}</span>}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  async function saveSource() {
    if (source === null) return;
    setSaving(true);
    setError("");
    const r = await api.request("presentations.save", { name, query, body: { source } });
    setSaving(false);
    if (!r.ok) return setError(failure(r));
    seen.current = r.data.updatedAt;
    past.current.push({ draft: draftRef.current!, at: Date.now() });
    setDraft(draftOf(r.data));
    setSource(r.data.source);
    setDirty(false);
  }
  async function remove() {
    const r = await api.request("presentations.delete", { name, query });
    if (!r.ok) return setError(failure(r));
    navigate(back, { replace: true });
  }
}

/** The deck's look: the templates as previews of this slide, and CSS of the deck's own over the theme. */
function DesignPanel({ themes, current, css, slide, asset, onTemplate, onCss }: { themes: StageTemplate[]; current: string; css: string; slide?: SlideDef; asset: (s: string) => string; onTemplate: (t: string) => void; onCss: (css: string) => void }) {
  const [text, setText] = useState(css);
  return (
    <div className="sticky top-3 flex max-h-[calc(100vh-130px)] flex-col gap-3 overflow-auto rounded-xl border border-line bg-surface p-3" role="region" aria-label="design">
      <div className="text-sm font-semibold">Theme</div>
      <div className="grid grid-cols-2 gap-2">
        {themes.map((t) => (
          <button key={t.slug} type="button" aria-pressed={t.slug === current} aria-label={`theme ${t.name}`} className={cn("flex flex-col gap-1 rounded-md border-2 p-1 text-left", t.slug === current ? "border-accent" : "border-transparent hover:border-line-strong")} onClick={() => onTemplate(t.slug)}>
            {slide && <Thumb slide={slide} theme={t} asset={asset} width={150} />}
            <span className="text-xs text-fg">{t.name}</span>
          </button>
        ))}
      </div>
      <Hint>
        A theme is a folder: <code>templates/&lt;name&gt;/template.yml</code> (layouts, colors, fonts, pieces) and <code>theme.css</code> with its fonts and pictures beside it. <code>kraftwerk presentations templates init &lt;name&gt;</code> starts one from the default; agents can write them too.
      </Hint>
      <div className="text-sm font-semibold">This deck's CSS</div>
      <textarea
        value={text}
        aria-label="deck css"
        spellCheck={false}
        placeholder={".layout-title { background: linear-gradient(135deg, #0284c7, #312e81); }\n.slot-title { letter-spacing: -0.03em; }"}
        className="min-h-[180px] resize-y rounded-md border border-line bg-bg p-2 font-mono text-[12px] leading-5 text-fg outline-none focus:border-accent"
        onChange={(e) => {
          setText(e.target.value);
          onCss(e.target.value);
        }}
      />
      <Hint>
        Over the theme, for this deck only: <code>.layout-&lt;name&gt;</code> a layout, <code>.slot-&lt;name&gt;</code> a box, <code>--c-accent</code> and the other colors as variables, <code>attr(data-nn)</code> the slide number.
      </Hint>
    </div>
  );
}

const PRESENCE_COLORS = ["#e11d48", "#7c3aed", "#059669", "#d97706", "#0891b2", "#db2777", "#4f46e5", "#65a30d"];
const colorOf = (client: string) => PRESENCE_COLORS[[...client].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PRESENCE_COLORS.length];

/**
 * The other editors of this deck (other people, other tabs, apps), live:
 * this tab reports its slide and selected box when they change and every
 * few seconds, and follows `deck.<project>/<name>` on the live connection.
 */
function usePresence(at: DeckAt, slide: number, slot: string | undefined, ready: boolean): { client: string; who: string; slide: number; slot?: string; color: string }[] {
  const client = useMemo(() => `t${Math.random().toString(36).slice(2, 10)}`, []);
  const [all, setAll] = useState<{ client: string; who: string; slide: number; slot?: string }[]>([]);
  const query = queryOf(at.project);
  const key = at.project ? `${at.project}/${at.name}` : at.name;
  // Following with this tab's id: the server lets it leave the deck when the tab's connection ends.
  useEffect(() => live.subscribe(`deck.${key}@${client}`, {}, (data) => setAll((data as { viewers?: typeof all }).viewers ?? [])), [key, client]);
  useEffect(() => {
    if (!ready) return;
    const beat = () => void api.request("presentations.presence", { name: at.name, query, body: { client, slide, ...(slot ? { slot } : {}) } }).catch(() => {});
    beat();
    const t = setInterval(beat, 8_000);
    return () => clearInterval(t);
  }, [key, client, slide, slot, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const leave = () => void api.request("presentations.presence", { name: at.name, query, body: { client, slide: 1, leave: true } }).catch(() => {});
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [key, client]); // eslint-disable-line react-hooks/exhaustive-deps
  return all.filter((v) => v.client !== client).map((v) => ({ ...v, color: colorOf(v.client) }));
}

/**
 * Earlier versions of the deck (`.history/` beside deck.md: before saves,
 * and whenever deck.md changed on disk): pick one to see its slides,
 * restore it — an ordinary edit, so ⌘Z undoes it and the version it
 * replaced lands in the history as well.
 */
function HistoryPanel({ at, theme, asset, onRestore, onClose }: { at: DeckAt; theme: StageTemplate; asset: (s: string) => string; onRestore: (v: { at: string; deck: { title: string; template?: string; css?: string; numbers?: false; slides: SlideDef[] } }) => void; onClose: () => void }) {
  const query = queryOf(at.project);
  const list = useApi("presentations.history", { name: at.name, query }, { interval: 8000 });
  const [open, setOpen] = useState<string | null>(null);
  const version = useApi("presentations.version", open ? { name: at.name, id: open, query } : null, { interval: 600_000 });
  const shown = version && version.id === open ? version : null;
  return (
    <div className="sticky top-3 flex max-h-[calc(100vh-130px)] flex-col gap-2 overflow-auto rounded-xl border border-line bg-surface p-3 text-sm" role="region" aria-label="version history">
      <div className="flex items-center gap-2">
        <Icon name="history" className="ms-sm text-fg-2" />
        <span className="font-semibold">Version history</span>
        <span className="flex-1" />
        <IconButton icon="close" label="close history" size="sm" onClick={onClose} />
      </div>
      <span className="text-xs text-fg-2">Kept before saves (once a minute while you edit) and whenever an agent or a tool changes deck.md. The newest 50 stay.</span>
      {list && list.versions.length === 0 && <span className="text-xs text-fg-2">No earlier versions yet.</span>}
      <ul className="flex flex-col gap-1" aria-label="versions">
        {(list?.versions ?? []).map((v) => (
          <li key={v.id}>
            <button type="button" aria-current={open === v.id} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2", open === v.id && "bg-surface-2")} onClick={() => setOpen(open === v.id ? null : v.id)}>
              <span className="flex-1">
                <span className="block text-fg">{new Date(v.at).toLocaleString()}</span>
                <span className="block text-xs text-fg-2">
                  {fmtAgo(v.at)} · {v.title} · {v.slides} slide{v.slides === 1 ? "" : "s"}
                </span>
              </span>
              <Icon name={open === v.id ? "expand_less" : "expand_more"} className="ms-sm text-fg-2" />
            </button>
            {open === v.id && shown && (
              <div className="mt-1 flex flex-col gap-2 rounded-md border border-line p-2">
                <div className="grid grid-cols-2 gap-1.5" aria-label="slides of this version">
                  {shown.deck.slides.map((s, i) => (
                    <div key={i} className="overflow-hidden rounded border border-line">
                      <Thumb slide={s} theme={theme} asset={asset} width={128} number={shown.deck.numbers === false ? undefined : { n: i + 1, of: shown.deck.slides.length }} />
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="primary" icon="restore" onClick={() => onRestore(shown)}>
                  restore this version
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Comments on the deck, like a review: the ones on the slide in view first,
 * each with who wrote it and when, its answers, resolve or reopen, a reply;
 * a new one on this slide or the selected box. Agents read and resolve them
 * with `kraftwerk presentations comments|resolve`.
 */
function CommentsPanel({ at, comments, slide, slot, onSlot, onGo, onClose }: { at: DeckAt; comments: DeckComment[]; slide: number; slot?: string; onSlot: (s?: string) => void; onGo: (n: number, slot?: string) => void; onClose: () => void }) {
  const query = queryOf(at.project);
  const [text, setText] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const add = async () => {
    if (!text.trim()) return;
    const r = await api.request("presentations.comment", { name: at.name, query, body: { slide, text, ...(slot ? { slot } : {}) } });
    if (!r.ok) return setError(failure(r));
    setText("");
    setError("");
  };
  const act = async (id: string, body: { resolved?: boolean; reply?: string }) => {
    const r = await api.request("presentations.commentSave", { name: at.name, id, query, body });
    if (!r.ok) return setError(failure(r));
    setReply((m) => ({ ...m, [id]: "" }));
  };
  const remove = async (id: string) => {
    const r = await api.request("presentations.commentDelete", { name: at.name, id, query });
    if (!r.ok) setError(failure(r));
  };
  const shown = comments.filter((c) => showResolved || !c.resolved).sort((a, b) => (a.n === slide ? -1 : 0) - (b.n === slide ? -1 : 0) || (a.n ?? 999) - (b.n ?? 999) || a.at.localeCompare(b.at));
  return (
    <div className="sticky top-3 flex max-h-[calc(100vh-130px)] flex-col gap-2 overflow-auto rounded-xl border border-line bg-surface p-3 text-sm" role="region" aria-label="comments">
      <div className="flex items-center gap-2">
        <Icon name="comment" className="ms-sm text-fg-2" />
        <span className="font-semibold">Comments</span>
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-xs text-fg-2">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} aria-label="show resolved" />
          resolved
        </label>
        <IconButton icon="close" label="close comments" size="sm" onClick={onClose} />
      </div>
      <form
        className="flex flex-col gap-1.5 rounded-lg border border-line bg-bg p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <span className="text-xs text-fg-2">
          on slide {slide}
          {slot ? (
            <>
              {" "}· box <b>{slot}</b>{" "}
              <button type="button" className="text-accent" onClick={() => onSlot(undefined)}>
                (the whole slide)
              </button>
            </>
          ) : (
            " (select a box to comment on it)"
          )}
        </span>
        <textarea value={text} aria-label="new comment" rows={2} placeholder="What should change here?" className="resize-y rounded-md border border-line bg-surface p-1.5 text-sm text-fg outline-none focus:border-accent" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), void add())} />
        <div className="flex justify-end">
          <Button size="sm" variant="primary" type="submit" disabled={!text.trim()}>
            comment
          </Button>
        </div>
      </form>
      {error && <span className="text-xs text-bad">{error}</span>}
      {shown.length === 0 && <span className="text-xs text-fg-2">No {showResolved ? "" : "open "}comments. Agents see them too: `kraftwerk presentations comments`.</span>}
      <ul className="flex flex-col gap-2" aria-label="comment list">
        {shown.map((c) => (
          <li key={c.id} className={cn("flex flex-col gap-1 rounded-lg border p-2", c.n === slide ? "border-accent/50" : "border-line", c.resolved && "opacity-60")} aria-label={`comment by ${c.author}`}>
            <div className="flex items-center gap-1.5 text-xs text-fg-2">
              <button type="button" className="font-semibold text-fg hover:text-accent" onClick={() => c.n && onGo(c.n, c.slot)}>
                slide {c.n ?? "?"}
                {c.slot ? ` · ${c.slot}` : ""}
              </button>
              <span>· {c.author}</span>
              <span>· {fmtAgo(c.at)}</span>
              <span className="flex-1" />
              <IconButton icon={c.resolved ? "replay" : "check_circle"} label={c.resolved ? "reopen" : "resolve"} size="sm" onClick={() => void act(c.id, { resolved: !c.resolved })} />
              <IconButton icon="delete" label="delete comment" size="sm" onClick={() => void remove(c.id)} />
            </div>
            <p className="whitespace-pre-wrap">{c.text}</p>
            {c.replies.map((r, i) => (
              <p key={i} className="ml-3 border-l-2 border-line pl-2 text-xs">
                <b>{r.author}</b> · {fmtAgo(r.at)}
                <br />
                {r.text}
              </p>
            ))}
            {!c.resolved && (
              <form
                className="flex gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reply[c.id]?.trim()) void act(c.id, { reply: reply[c.id] });
                }}
              >
                <input value={reply[c.id] ?? ""} aria-label={`reply to ${c.id}`} placeholder="reply…" className="h-7 min-w-0 flex-1 rounded-md border border-line bg-bg px-1.5 text-xs text-fg outline-none focus:border-accent" onChange={(e) => setReply((m) => ({ ...m, [c.id]: e.target.value }))} />
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Warnings({ items }: { items: RenderWarning[] }) {
  return (
    <ul className="flex flex-col gap-1 text-xs" aria-label="warnings">
      {items.map((w, i) => (
        <li key={i} className={cn("flex items-start gap-1.5", w.level === "error" ? "text-bad" : "text-fg-2")}>
          <Icon name={w.level === "error" ? "error" : "warning"} className="ms-sm mt-px" />
          <span>
            {w.slide ? `slide ${w.slide}` : "deck"}
            {w.slot ? ` · ${w.slot}` : ""}: {w.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- present mode ---------- */

function PresentMode({ project, name, presenter, start }: DeckAt & { presenter: boolean; start: number }) {
  const at: DeckAt = { project, name };
  const query = queryOf(project);
  const detail = useApi("presentations.get", { name, query }, { interval: 10_000 });
  const all = detail?.deck.slides ?? [];
  // Hidden slides are not shown; `start` counts the deck's slides as the editor numbers them.
  const shown = all.map((s, i) => ({ s, i })).filter((x) => !isHidden(x.s));
  const firstShown = Math.max(1, shown.findIndex((x) => x.i >= start - 1) + 1);
  const [n, setN] = useState(firstShown);
  const [notes, setNotes] = useState(false);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [t0] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const count = shown.length;
  const numberAt = (k: number) => (detail?.deck.numbers === false ? undefined : { n: k, of: count });
  const back = deckHref(at);
  const go = (to: number) => setN(Math.min(Math.max(1, to), Math.max(1, count)));
  const theme = detail?.theme;
  useDeckCss(theme ? [theme] : [], detail?.deck.css);
  const asset = useMemo(() => assetOf(at, detail?.updatedAt ?? ""), [name, project, detail?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const slide = shown[n - 1]?.s;
  const next = shown[n]?.s;
  const view = useView(slide, theme, asset);
  const nextView = useView(next, theme, asset);
  useEffect(() => setN(firstShown), [firstShown]);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown" || e.key === "Enter") {
        e.preventDefault();
        setN((v) => Math.min(v + 1, Math.max(1, count)));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "Backspace") {
        e.preventDefault();
        setN((v) => Math.max(1, v - 1));
      } else if (e.key === "Home") setN(1);
      else if (e.key === "End") setN(Math.max(1, count));
      else if (e.key === "Escape") navigate(back);
      else if (e.key === "n" || e.key === "N") setNotes((v) => !v);
      else if (e.key === "f" || e.key === "F") void document.documentElement.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      clearInterval(tick);
    };
  }, [count, back]);

  const h = theme ? stageHeight(theme.size) : 900;
  const elapsed = Math.floor((now - t0) / 1000);
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  if (presenter) {
    const mainW = Math.min(size.w * 0.62, ((size.h - 120) * STAGE_W) / h);
    return (
      <div className="fixed inset-0 z-[1000] flex select-none flex-col gap-4 bg-[#111] p-6 text-white" role="region" aria-label="presenter view">
        <div className="flex items-center gap-4 text-sm text-white/70">
          <button type="button" className="hover:text-white" onClick={() => navigate(back)}>
            ← back to the editor (Esc)
          </button>
          <span className="flex-1" />
          <span>{detail?.title}</span>
          <span className="tabular-nums" aria-label="slide counter">
            {n} / {count}
          </span>
          <span className="text-2xl font-semibold tabular-nums text-white" aria-label="elapsed time">
            {clock}
          </span>
        </div>
        <div className="flex min-h-0 flex-1 gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wider text-white/50">now</span>
            {view && theme && (
              <div role="img" aria-label={`slide ${n} of ${count}`}>
                <SlideCanvas view={view} theme={theme} width={mainW} number={numberAt(n)} />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <span className="text-xs uppercase tracking-wider text-white/50">next</span>
            {nextView && theme ? <SlideCanvas view={nextView} theme={theme} width={Math.min(360, size.w * 0.3)} thumb number={numberAt(n + 1)} /> : <span className="text-sm text-white/40">the end</span>}
            <span className="mt-2 text-xs uppercase tracking-wider text-white/50">notes</span>
            <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap text-xl leading-8 text-white/90" aria-label="speaker notes">
              {slide?.notes || <span className="text-white/40">no notes on this slide</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const availH = size.h - 36 - (notes ? Math.min(size.h * 0.3, 180) : 0);
  const width = Math.min(size.w, (availH * STAGE_W) / h);
  return (
    <div className="fixed inset-0 z-[1000] flex select-none flex-col bg-black text-white" role="region" aria-label="presentation">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {view && theme ? (
          <div key={n} className={view.transition === "slide" ? "animate-[deckslide_420ms_cubic-bezier(.2,.7,.2,1)] motion-reduce:animate-none" : view.transition === "zoom" ? "animate-[deckzoom_380ms_cubic-bezier(.2,.7,.2,1)] motion-reduce:animate-none" : view.transition === "none" ? "" : "animate-[deckfade_300ms_ease-out] motion-reduce:animate-none"} data-transition={view.transition} role="img" aria-label={`slide ${n} of ${count}`}>
            <SlideCanvas view={view} theme={theme} width={width} number={numberAt(n)} />
          </div>
        ) : (
          <span className="text-white/60">{detail ? "this deck has no slides" : "loading…"}</span>
        )}
        <button type="button" className="absolute inset-y-0 left-0 w-1/4 cursor-w-resize opacity-0" aria-label="previous slide" onClick={() => go(n - 1)} />
        <button type="button" className="absolute inset-y-0 right-0 w-1/4 cursor-e-resize opacity-0" aria-label="next slide" onClick={() => go(n + 1)} />
      </div>
      {notes && (
        <div className="max-h-[30vh] overflow-auto border-t border-white/20 bg-black/90 px-6 py-3 text-base leading-6 text-white/90" aria-label="speaker notes">
          {slide?.notes || <span className="text-white/50">no notes on this slide</span>}
        </div>
      )}
      <div className="flex h-9 items-center gap-3 px-4 text-xs text-white/60">
        <button type="button" className="hover:text-white" onClick={() => navigate(back)}>
          ← back to the editor (Esc)
        </button>
        <span className="flex-1" />
        <span>{detail?.title}</span>
        <span>
          {n} / {count}
        </span>
        <span className="tabular-nums">{clock}</span>
        <button type="button" className={cn("hover:text-white", notes && "text-white")} onClick={() => setNotes((v) => !v)} aria-pressed={notes}>
          notes (N)
        </button>
        <span>fullscreen (F)</span>
      </div>
    </div>
  );
}

/* ---------- glance ---------- */

/**
 * A deck at a glance, for a side column (the artifacts page's preview): its
 * slides one under the other at the column's width, hidden ones faint, each
 * opening the editor on that slide.
 */
export function DeckGlance({ project, name }: DeckAt) {
  const at: DeckAt = { project, name };
  const detail = useApi("presentations.get", { name, query: queryOf(project) }, { interval: 10_000 });
  const theme = detail?.theme;
  useDeckCss(theme ? [theme] : [], detail?.deck.css);
  const asset = useMemo(() => assetOf(at, detail?.updatedAt ?? ""), [name, project, detail?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const slides = detail?.deck.slides ?? [];
  const numbers = detail?.deck.numbers !== false;
  return (
    <div ref={box} className="deck-glance flex flex-col gap-3" aria-label="slides">
      {!detail && <EmptyState>loading…</EmptyState>}
      {detail && slides.length === 0 && <EmptyState icon="slideshow">No slides yet.</EmptyState>}
      {theme &&
        w > 0 &&
        slides.map((s, i) => (
          <Link
            key={i}
            href={deckHref(at)}
            className={cn("block overflow-hidden rounded-lg border border-line no-underline shadow-sm transition-shadow hover:shadow-md", isHidden(s) && "opacity-40")}
            title={`slide ${i + 1}`}
            data-slide={i + 1}
          >
            <Thumb slide={s} theme={theme} asset={asset} width={w - 2} number={numbers ? { n: i + 1, of: slides.length } : undefined} />
          </Link>
        ))}
    </div>
  );
}
