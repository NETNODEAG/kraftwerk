import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { BundleDetail, ConceptDetail, ConceptInfo } from "../types";
import { api, failure } from "../api";
import { Icon, fmtWhen } from "../shared";
import { exportBundlePdf } from "../export";
import { Button, cn, Eyebrow, Hint, IconButton, Notice, Tag, TextArea } from "../ui";
import { CODE_AREA } from "./shared";

/**
 * The right-hand knowledge sidebar: the selected agent's linked bundles,
 * with concepts readable and editable in place.
 */

export function KnowledgeSide({
  bundles,
  onHide,
  onResize,
}: {
  bundles: string[];
  onHide: () => void;
  onResize: (w: number) => void;
}) {
  const [details, setDetails] = useState<Record<string, BundleDetail | null>>({});
  const [openId, setOpenId] = useState<string | null>(null); // "<bundle>::<concept id>"
  // key -> full concept (null = failed to load); rendered html derives from it.
  const [concepts, setConcepts] = useState<Record<string, ConceptDetail | null>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Poll bundle details so agent-written knowledge shows up without a manual
  // refresh; per-bundle state identity is kept when nothing changed.
  useEffect(() => {
    setDetails({});
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await Promise.all(
        bundles.map(async (b) => {
          try {
            const r = await api.request("knowledge.get", { bundle: b });
            const d = r.ok ? r.data : null;
            if (alive)
              setDetails((prev) =>
                JSON.stringify(prev[b]) === JSON.stringify(d) ? prev : { ...prev, [b]: d }
              );
          } catch {
            if (alive) setDetails((prev) => (b in prev ? prev : { ...prev, [b]: null }));
          }
        })
      );
      if (alive) timer = setTimeout(tick, 6000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [bundles.join(",")]);

  // Load + keep the expanded concept card current; paused while it's being edited.
  useEffect(() => {
    if (!openId || editKey === openId) return;
    const sep = openId.indexOf("::");
    const bundle = openId.slice(0, sep);
    const id = openId.slice(sep + 2);
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api.request("knowledge.concept", { bundle, query: { id } });
        const concept = r.ok ? r.data : null;
        if (alive)
          setConcepts((prev) =>
            JSON.stringify(prev[openId]) === JSON.stringify(concept)
              ? prev
              : { ...prev, [openId]: concept }
          );
      } catch {
        // Keep whatever we last loaded; only mark failed if we never loaded it.
        if (alive) setConcepts((prev) => (openId in prev ? prev : { ...prev, [openId]: null }));
      }
      if (alive) timer = setTimeout(tick, 6000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [openId, editKey]);

  function toggle(bundle: string, id: string): void {
    const key = `${bundle}::${id}`;
    setOpenId(openId === key ? null : key);
  }

  // Saves the full raw file (frontmatter + body) — the server stamps
  // provenance as human:user, same as the knowledge screen's editor.
  async function save(bundle: string, id: string): Promise<void> {
    const key = `${bundle}::${id}`;
    setSaving(true);
    setSaveError("");
    try {
      const r = await api.request("knowledge.putConcept", { bundle, body: { id, content: draft } });
      if (!r.ok) setSaveError(failure(r));
      else if (r.data.error) setSaveError(r.data.error);
      else {
        const body = r.data;
        setConcepts((prev) => ({ ...prev, [key]: body }));
        setEditKey(null);
      }
    } catch (err) {
      setSaveError((err as Error).message);
    }
    setSaving(false);
  }

  return (
    <aside className="runs-side knowledge-side">
      <div
        className="absolute inset-y-0 -left-[3px] z-4 w-[7px] cursor-col-resize hover:bg-accent/25"
        title="Drag to resize"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = (e.currentTarget.parentElement as HTMLElement).offsetWidth;
          const move = (ev: MouseEvent) =>
            onResize(Math.min(900, Math.max(280, startW + (startX - ev.clientX))));
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
      />
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <span className="flex min-w-0 flex-col gap-px">
          <Eyebrow>knowledge</Eyebrow>
          <span className="truncate text-[10.5px] text-fg-2">read &amp; kept current by this agent</span>
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="quiet" onClick={onHide} title="Hide knowledge sidebar">
          hide <Icon name="close" className="ms-sm" />
        </Button>
      </div>
      <div className="flex-1 divide-y divide-line overflow-y-auto p-1.5">
        {bundles.map((b) => {
          const detail = details[b];
          const shut = collapsed[b] === true;
          return (
            <div key={b} className="px-2 pt-1.5 pb-2.5">
              <div className="flex items-center gap-0.5 py-0.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-[7px] rounded-xl border-0 bg-transparent px-2 py-1.5 text-left hover:bg-surface-2"
                  aria-expanded={!shut}
                  onClick={() => setCollapsed({ ...collapsed, [b]: !shut })}
                >
                  <Chevron open={!shut} />
                  <span className="truncate text-xs font-semibold text-fg">{b}</span>
                  {detail && <span className="flex-none rounded-full bg-surface-2 px-[7px] text-[10.5px] leading-[17px] tabular-nums text-fg-2">{detail.concepts.length}</span>}
                </button>
                <IconButton icon="picture_as_pdf" label="Export this bundle as PDF" size="sm" onClick={() => void exportBundlePdf(b)} />
                <IconButton icon="arrow_outward" label="Open this bundle on the knowledge screen" size="sm" href={`/knowledge/${encodeURIComponent(b)}`} />
              </div>
              {!shut && detail === null && <Hint className="px-[18px] py-1.5">bundle not found</Hint>}
              {!shut &&
                detail?.concepts.map((c) => {
                  const key = `${b}::${c.id}`;
                  const open = openId === key;
                  const conceptHref = `/knowledge/${encodeURIComponent(b)}/${c.id
                    .split("/")
                    .map(encodeURIComponent)
                    .join("/")}`;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-[7px] rounded-xl border-0 py-1.5 pr-2 pl-[18px] text-left text-xs",
                          open ? "bg-accent-soft font-medium text-on-accent-soft" : "bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg"
                        )}
                        aria-expanded={open}
                        title={c.description || undefined}
                        onClick={() => toggle(b, c.id)}
                      >
                        <Chevron open={open} />
                        <span className="min-w-0 flex-1 truncate">{c.title || c.id}</span>
                        {c.stale && (
                          <span className="cursor-help" title="Past its stale-after date — ask the agent to re-verify it">
                            <Tag tone="bad">stale</Tag>
                          </span>
                        )}
                      </button>
                      {open && (
                        <div
                          className="mt-1 mb-2.5 ml-[18px] overflow-hidden rounded-xl border border-line bg-surface-2"
                          ref={(el) => el?.scrollIntoView({ block: "nearest" })}
                        >
                          {concepts[key] === undefined ? (
                            <Hint className="px-[18px] py-3">loading…</Hint>
                          ) : concepts[key] === null ? (
                            <Hint className="px-[18px] py-3">could not load concept</Hint>
                          ) : editKey === key ? (
                            <div className="flex flex-col gap-2 px-3 py-2.5">
                              <TextArea
                                className={CODE_AREA}
                                aria-label="concept"
                                value={draft}
                                rows={Math.min(28, Math.max(10, draft.split("\n").length + 2))}
                                onChange={(e) => setDraft(e.target.value)}
                                spellCheck={false}
                              />
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="quiet" disabled={saving} onClick={() => setEditKey(null)}>
                                  cancel
                                </Button>
                                <Button size="sm" variant="primary" icon="check" busy={saving} onClick={() => save(b, c.id)}>
                                  {saving ? "saving…" : "save"}
                                </Button>
                              </div>
                              {saveError && <Notice tone="bad">{saveError}</Notice>}
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-[7px]">
                                {c.type && <Tag>{c.type}</Tag>}
                                {conceptUpdatedAt(c) && (
                                  <span className="text-[10.5px] tabular-nums text-fg-2">
                                    updated {fmtWhen(conceptUpdatedAt(c)!)}
                                  </span>
                                )}
                                <span className="flex-1" />
                                <Button
                                  size="sm"
                                  variant="quiet"
                                  icon="edit"
                                  onClick={() => {
                                    setDraft(concepts[key]!.raw);
                                    setEditKey(key);
                                    setSaveError("");
                                  }}
                                >
                                  edit
                                </Button>
                                <Button size="sm" variant="quiet" icon="open_in_new" href={`/knowledge/${encodeURIComponent(b)}/${c.id}`} title="The page in the knowledge section">
                                  page
                                </Button>
                                <Button size="sm" variant="quiet" href={conceptHref}>
                                  open ↗
                                </Button>
                              </div>
                              <div
                                className="md-body h-auto overflow-visible px-3.5 pt-3 pb-3.5 text-xs"
                                dangerouslySetInnerHTML={{
                                  __html: DOMPurify.sanitize(
                                    marked.parse(concepts[key]!.body ?? "", { async: false })
                                  ),
                                }}
                              />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              {!shut && detail && detail.concepts.length === 0 && <Hint className="px-[18px] py-1.5">no concepts yet</Hint>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** The chevron of a fold: points right, turns down when open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <span className={cn("inline-grid w-[15px] flex-none text-fg-2 transition-transform", open && "rotate-90")} aria-hidden>
      <Icon name="chevron_right" className="text-[15px]" />
    </span>
  );
}

/** Latest of a concept's generated/verified timestamps, for the card meta. */
function conceptUpdatedAt(c: ConceptInfo): string | undefined {
  const times = [c.generated?.at, ...c.verified.map((v) => v.at)].filter(
    (t): t is string => typeof t === "string" && t.length > 0
  );
  return times.sort().pop();
}
