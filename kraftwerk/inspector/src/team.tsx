import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type {
  BundleDetail,
  ChatMeta,
  ConceptDetail,
  ConceptInfo,
  KnowledgeIndex,
  RoutineStatus,
  SkillInfo,
  TeamMember,
  TeamMemberDetail,
  WorkflowSummary,
} from "./types";
import { ChatThread, NewChat, createChatAndOpen } from "./chat";
import { Icon, Link, navigate, usePoll, fmtWhen, useExpertMode } from "./shared";
import { exportBundlePdf } from "./export";

/**
 * Team: persistent agent teammates ("employees"), each defined in
 * agents/<slug>/ (agent.yml + system.md). The screen is a double sidebar:
 * members on the left, the selected member's sessions next to it, and the
 * main pane shows the member profile, a session thread, or the editor.
 * Sessions are ordinary chats with scope { kind: "team", member } — the
 * thread view is reused from the chat screen.
 */

const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
const EMOJI_PRESETS = ["🤖", "🧑‍💻", "🎧", "🛠️", "📊", "✍️", "🔍", "🧹", "📦", "🚀"];

export function TeamScreen({ seg }: { seg: string[] }) {
  // seg (after /agents): [] | [new] | [chats] | [chats, chatId] | [slug] |
  // [slug, info] | [slug, edit] | [slug, chat, chatId]. A bare slug lands on
  // the agent's most recent session; the profile lives at /info.
  const slug =
    seg[0] && seg[0] !== "new" && seg[0] !== "chats" ? decodeURIComponent(seg[0]) : undefined;
  const mode =
    seg[0] === "new"
      ? "new"
      : seg[0] === "chats"
        ? "chats"
        : seg[1] === "edit"
          ? "edit"
          : seg[1] === "info"
            ? "info"
            : seg[1] === "chat"
              ? "chat"
              : slug
                ? "member"
                : "home";
  const chatId = mode === "chat" ? seg[2] : mode === "chats" ? seg[1] : undefined;

  const data = usePoll<{ root: string; members: TeamMember[] }>("/api/team", false);
  const expert = useExpertMode();

  // Agent groups: persisted per agent (agent.yml `group:`); a freshly created,
  // still-empty group lives in localStorage until an agent is dropped into it.
  const [extraGroups, setExtraGroups] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("kw-agent-groups") ?? "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  });
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [dragSlug, setDragSlug] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null); // "" = ungrouped
  // Optimistic moves, applied over poll data until the server confirms them.
  const [moved, setMoved] = useState<Record<string, string>>({});

  const members = (data?.members ?? []).map((m) =>
    moved[m.slug] !== undefined ? { ...m, group: moved[m.slug] || undefined } : m
  );
  useEffect(() => {
    setMoved((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const m of data?.members ?? []) {
        if (next[m.slug] !== undefined && (m.group ?? "") === next[m.slug]) {
          delete next[m.slug];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data]);

  // Archived members leave the roster (and its groups) for a collapsed
  // section at the bottom; unarchiving puts them right back.
  const active = members.filter((m) => !m.archived);
  const archivedMembers = members.filter((m) => m.archived);
  const [showArchived, setShowArchived] = useState(false);

  const groups = [
    ...new Set([...active.map((m) => m.group ?? "").filter(Boolean), ...extraGroups]),
  ].sort((a, b) => a.localeCompare(b));
  const ungrouped = active.filter((m) => !m.group);

  function saveExtraGroups(gs: string[]): void {
    setExtraGroups(gs);
    try {
      localStorage.setItem("kw-agent-groups", JSON.stringify(gs));
    } catch {}
  }

  function addGroup(): void {
    const g = groupDraft.trim();
    setAddingGroup(false);
    setGroupDraft("");
    if (g && !groups.includes(g)) saveExtraGroups([...extraGroups, g]);
  }

  // Rename = move every member of the group; renaming onto an existing group
  // merges into it. Empty created groups just rename in localStorage.
  function renameGroup(from: string, to: string): void {
    setRenaming(null);
    const next = to.trim();
    if (!next || next === from) return;
    for (const m of members.filter((x) => x.group === from)) void moveToGroup(m.slug, next);
    if (extraGroups.includes(from)) {
      saveExtraGroups([...new Set(extraGroups.map((g) => (g === from ? next : g)))]);
    }
  }

  // saveMember rewrites agent.yml + system.md wholesale, so a group move must
  // carry the complete member: fetch the detail first, then PUT it back.
  async function moveToGroup(memberSlug: string, group: string): Promise<void> {
    const current = members.find((m) => m.slug === memberSlug);
    if ((current?.group ?? "") === group) return;
    setMoved((prev) => ({ ...prev, [memberSlug]: group }));
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(memberSlug)}`);
      if (!r.ok) throw new Error();
      const full = (await r.json()) as TeamMemberDetail;
      const res = await fetch(`/api/team/${encodeURIComponent(memberSlug)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...full, group: group || undefined }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setMoved((prev) => {
        const next = { ...prev };
        delete next[memberSlug];
        return next;
      });
    }
  }

  // Drop-target props for one group section ("" = ungrouped); expert only.
  const dropProps = (g: string) =>
    expert
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (dragSlug == null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dropGroup !== g) setDropGroup(g);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const s = e.dataTransfer.getData("text/plain") || dragSlug;
            if (s) void moveToGroup(s, g);
            setDragSlug(null);
            setDropGroup(null);
          },
        }
      : {};

  const memberRow = (m: TeamMember) => (
    <Link
      key={m.slug}
      href={`/agents/${encodeURIComponent(m.slug)}`}
      className={`side-row ${m.slug === slug ? "active" : ""} ${dragSlug === m.slug ? "dragging" : ""}`}
      draggable={expert}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", m.slug);
        e.dataTransfer.effectAllowed = "move";
        setDragSlug(m.slug);
      }}
      onDragEnd={() => {
        setDragSlug(null);
        setDropGroup(null);
      }}
    >
      <span className="agent-avatar sm">
        <span aria-hidden>{m.emoji}</span>
      </span>
      <div className="side-row-body">
        <div className="side-row-top">
          <span className="side-wf">{m.name}</span>
        </div>
        <div className="side-row-sub">
          <span className="side-req">{m.description || m.harness}</span>
        </div>
      </div>
    </Link>
  );

  // Archived rows: no dragging, land on the profile (where unarchive lives).
  const archivedRow = (m: TeamMember) => (
    <Link
      key={m.slug}
      href={`/agents/${encodeURIComponent(m.slug)}/info`}
      className={`side-row archived-row ${m.slug === slug ? "active" : ""}`}
    >
      <span className="agent-avatar sm">
        <span aria-hidden>{m.emoji}</span>
      </span>
      <div className="side-row-body">
        <div className="side-row-top">
          <span className="side-wf">{m.name}</span>
        </div>
        <div className="side-row-sub">
          <span className="side-req">{m.description || m.harness}</span>
        </div>
      </div>
    </Link>
  );

  let main: React.ReactNode;
  if (mode === "new") main = <MemberEditor key="new" />;
  else if (mode === "edit" && slug) main = <MemberEditor key={slug} slug={slug} />;
  else if (mode === "chat" && slug && chatId)
    main = (
      <div className="chat-main">
        <ChatThread
          key={chatId}
          id={chatId}
          agentName={members.find((m) => m.slug === slug)?.name ?? slug}
        />
      </div>
    );
  else if (mode === "chats")
    main = chatId ? (
      <div className="chat-main">
        <ChatThread key={chatId} id={chatId} />
      </div>
    ) : (
      <NewChat />
    );
  else if (mode === "info" && slug) main = <MemberView key={slug} slug={slug} />;
  else if (slug) main = <MemberLanding key={slug} slug={slug} />;
  else main = <TeamHome hasMembers={active.length > 0} root={data?.root} />;

  // Linked knowledge bundles of the selected agent → right sidebar on the
  // profile and chat views (not while editing). Hidden state persists.
  const kBundles =
    (mode === "member" || mode === "info" || mode === "chat") && slug
      ? (members.find((m) => m.slug === slug)?.knowledge ?? [])
      : [];
  const [kOpen, setKOpen] = useState(() => localStorage.getItem("kw-kside") !== "hidden");
  const [kWidth, setKWidth] = useState(() => Number(localStorage.getItem("kw-kside-w")) || 460);
  const showKnowledge = kBundles.length > 0 && kOpen;
  function toggleKnowledge(open: boolean): void {
    setKOpen(open);
    localStorage.setItem("kw-kside", open ? "open" : "hidden");
  }
  function resizeKnowledge(w: number): void {
    setKWidth(w);
    localStorage.setItem("kw-kside-w", String(w));
  }

  return (
    <div
      className={`runs-screen team-screen ${slug || mode === "chats" ? "has-sessions" : ""} ${showKnowledge ? "has-knowledge" : ""}`}
      style={showKnowledge ? ({ "--kside-w": `${kWidth}px` } as React.CSSProperties) : undefined}
    >
      <aside className="runs-side">
        <div className="side-head">
          <span className="microlabel">agents</span>
          <span className="spacer" />
          {expert && (
            <Link href="/agents/new" className="open-raw">
              <Icon name="add" className="ms-sm" /> new
            </Link>
          )}
        </div>
        <div className="side-list">
          <Link
            href="/agents/chats"
            className={`side-row side-general ${mode === "chats" ? "active" : ""}`}
          >
            <span className="agent-avatar sm">
              <span aria-hidden>💬</span>
            </span>
            <div className="side-row-body">
              <div className="side-row-top">
                <span className="side-wf">General Chats</span>
              </div>
              <div className="side-row-sub">
                <span className="side-req">chats without an agent</span>
              </div>
            </div>
          </Link>
          <div
            className={`side-group ${dragSlug && dropGroup === "" ? "drop-over" : ""}`}
            {...dropProps("")}
          >
            {ungrouped.map(memberRow)}
            {dragSlug != null && ungrouped.length === 0 && (
              <div className="side-group-empty">no group — drop here</div>
            )}
          </div>
          {groups.map((g) => {
            const its = active.filter((m) => m.group === g);
            return (
              <div
                key={g}
                className={`side-group ${dragSlug && dropGroup === g ? "drop-over" : ""}`}
                {...dropProps(g)}
              >
                <div className="side-group-head">
                  {renaming === g ? (
                    <input
                      className="side-group-rename"
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameGroup(g, renameDraft);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={() => renameGroup(g, renameDraft)}
                    />
                  ) : (
                    <span className="microlabel">{g}</span>
                  )}
                  <span className="side-group-count num">{its.length}</span>
                  <span className="spacer" />
                  {expert && renaming !== g && (
                    <button
                      className="side-group-x"
                      title="Rename group"
                      onClick={() => {
                        setRenaming(g);
                        setRenameDraft(g);
                      }}
                    >
                      <Icon name="edit" className="ms-sm" />
                    </button>
                  )}
                  {expert && its.length === 0 && extraGroups.includes(g) && (
                    <button
                      className="side-group-x"
                      title="Remove empty group"
                      onClick={() => saveExtraGroups(extraGroups.filter((x) => x !== g))}
                    >
                      <Icon name="close" className="ms-sm" />
                    </button>
                  )}
                </div>
                {its.map(memberRow)}
                {its.length === 0 && (
                  <div className="side-group-empty">
                    {expert ? "drag agents here" : "no agents"}
                  </div>
                )}
              </div>
            );
          })}
          {archivedMembers.length > 0 && (
            <div className="side-group side-archived">
              <button
                className="side-archived-toggle"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((v) => !v)}
              >
                <span className="microlabel">archived</span>
                <span className="side-group-count num">{archivedMembers.length}</span>
                <span className="spacer" />
                <Icon name={showArchived ? "expand_less" : "expand_more"} className="ms-sm" />
              </button>
              {showArchived && archivedMembers.map(archivedRow)}
            </div>
          )}
          {data && members.length === 0 && <div className="viewer-note">no agents yet</div>}
          {expert &&
            (addingGroup ? (
              <div className="side-group-new">
                <input
                  autoFocus
                  value={groupDraft}
                  placeholder="group name, e.g. Team Content"
                  onChange={(e) => setGroupDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addGroup();
                    if (e.key === "Escape") {
                      setAddingGroup(false);
                      setGroupDraft("");
                    }
                  }}
                  onBlur={addGroup}
                />
              </div>
            ) : (
              <button className="side-group-add" onClick={() => setAddingGroup(true)}>
                <Icon name="add" className="ms-sm" /> group
              </button>
            ))}
        </div>
      </aside>
      {slug && <SessionsSide slug={slug} chatId={chatId} />}
      {mode === "chats" && <GeneralChatsSide chatId={chatId} />}
      <div className="runs-main">{main}</div>
      {showKnowledge && (
        <KnowledgeSide bundles={kBundles} onHide={() => toggleKnowledge(false)} onResize={resizeKnowledge} />
      )}
      {kBundles.length > 0 && !kOpen && (
        <button className="kside-reopen" onClick={() => toggleKnowledge(true)} title="Show knowledge sidebar">
          <Icon name="menu_book" className="ms-sm" /> knowledge
        </button>
      )}
    </div>
  );
}

/* ---------- knowledge sidebar ---------- */

function KnowledgeSide({
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
            const r = await fetch(`/api/knowledge/${encodeURIComponent(b)}`, { cache: "no-store" });
            const d = r.ok ? ((await r.json()) as BundleDetail) : null;
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
        const r = await fetch(
          `/api/knowledge/${encodeURIComponent(bundle)}/concept?id=${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );
        const concept = r.ok ? ((await r.json()) as ConceptDetail) : null;
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
      const r = await fetch(`/api/knowledge/${encodeURIComponent(bundle)}/concept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, content: draft }),
      });
      const body = (await r.json()) as ConceptDetail & { error?: string };
      if (body.error) {
        setSaveError(body.error);
      } else {
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
        className="kside-resizer"
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
      <div className="side-head">
        <span className="kside-headline">
          <span className="microlabel">knowledge</span>
          <span className="kside-hint">read &amp; kept current by this agent</span>
        </span>
        <span className="spacer" />
        <button className="open-raw" onClick={onHide} title="Hide knowledge sidebar">
          hide <Icon name="close" className="ms-sm" />
        </button>
      </div>
      <div className="side-list">
        {bundles.map((b) => {
          const detail = details[b];
          const shut = collapsed[b] === true;
          return (
            <div key={b} className="kside-bundle">
              <div className="kside-bundle-head">
                <button
                  className="kside-bundle-toggle"
                  aria-expanded={!shut}
                  onClick={() => setCollapsed({ ...collapsed, [b]: !shut })}
                >
                  <span className={`kside-chev ${shut ? "" : "open"}`} aria-hidden>
                    <Icon name="chevron_right" className="ms-sm" />
                  </span>
                  <span className="kside-bundle-name">{b}</span>
                  {detail && <span className="kside-count num">{detail.concepts.length}</span>}
                </button>
                <button
                  className="kside-open"
                  title="Export this bundle as PDF"
                  onClick={() => void exportBundlePdf(b)}
                >
                  <Icon name="picture_as_pdf" className="ms-sm" />
                </button>
                <Link
                  href={`/knowledge/${encodeURIComponent(b)}`}
                  className="kside-open"
                  title="Open this bundle on the knowledge screen"
                >
                  ↗
                </Link>
              </div>
              {!shut && detail === null && <div className="viewer-note">bundle not found</div>}
              {!shut &&
                detail?.concepts.map((c) => {
                  const key = `${b}::${c.id}`;
                  const open = openId === key;
                  const conceptHref = `/knowledge/${encodeURIComponent(b)}/${c.id
                    .split("/")
                    .map(encodeURIComponent)
                    .join("/")}`;
                  return (
                    <div key={c.id} className={`kside-concept ${open ? "open" : ""}`}>
                      <button
                        className="kside-row"
                        aria-expanded={open}
                        title={c.description || undefined}
                        onClick={() => toggle(b, c.id)}
                      >
                        <span className={`kside-chev ${open ? "open" : ""}`} aria-hidden>
                          <Icon name="chevron_right" className="ms-sm" />
                        </span>
                        <span className="kside-title">{c.title || c.id}</span>
                        {c.stale && (
                          <span
                            className="kside-stale"
                            title="Past its stale-after date — ask the agent to re-verify it"
                          >
                            stale
                          </span>
                        )}
                      </button>
                      {open && (
                        <div
                          className="kside-card"
                          ref={(el) => el?.scrollIntoView({ block: "nearest" })}
                        >
                          {concepts[key] === undefined ? (
                            <div className="viewer-note">loading…</div>
                          ) : concepts[key] === null ? (
                            <div className="viewer-note">could not load concept</div>
                          ) : editKey === key ? (
                            <div className="kside-edit">
                              <textarea
                                className="concept-edit"
                                value={draft}
                                rows={Math.min(28, Math.max(10, draft.split("\n").length + 2))}
                                onChange={(e) => setDraft(e.target.value)}
                                spellCheck={false}
                              />
                              <div className="kside-actions">
                                <button
                                  className="open-raw"
                                  disabled={saving}
                                  onClick={() => setEditKey(null)}
                                >
                                  cancel
                                </button>
                                <button
                                  className="open-raw"
                                  disabled={saving}
                                  onClick={() => save(b, c.id)}
                                >
                                  {saving ? "saving…" : <><Icon name="check" className="ms-sm" /> save</>}
                                </button>
                              </div>
                              {saveError && <div className="msg error"><Icon name="error" className="ms-sm" /> {saveError}</div>}
                            </div>
                          ) : (
                            <>
                              <div className="kside-card-bar">
                                {c.type && <span className="kside-type">{c.type}</span>}
                                {conceptUpdatedAt(c) && (
                                  <span className="kside-updated num">
                                    updated {fmtWhen(conceptUpdatedAt(c)!)}
                                  </span>
                                )}
                                <span className="spacer" />
                                <button
                                  className="open-raw"
                                  onClick={() => {
                                    setDraft(concepts[key]!.raw);
                                    setEditKey(key);
                                    setSaveError("");
                                  }}
                                >
                                  <Icon name="edit" className="ms-sm" /> edit
                                </button>
                                <Link href={conceptHref} className="open-raw">
                                  open ↗
                                </Link>
                              </div>
                              <div
                                className="kside-md md-body"
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
              {!shut && detail && detail.concepts.length === 0 && (
                <div className="viewer-note">no concepts yet</div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/** Latest of a concept's generated/verified timestamps, for the card meta. */
function conceptUpdatedAt(c: ConceptInfo): string | undefined {
  const times = [c.generated?.at, ...c.verified.map((v) => v.at)].filter(
    (t): t is string => typeof t === "string" && t.length > 0
  );
  return times.sort().pop();
}

/* ---------- landing ---------- */

/**
 * A bare #/agents/<slug> URL jumps straight into the agent's most recent
 * session; with no sessions yet it shows the profile instead.
 */
function MemberLanding({ slug }: { slug: string }) {
  const [noSessions, setNoSessions] = useState(false);
  useEffect(() => {
    let alive = true;
    setNoSessions(false);
    fetch("/api/chats")
      .then((r) => r.json())
      .then((d: { chats: ChatMeta[] }) => {
        if (!alive) return;
        // /api/chats is sorted by updatedAt desc — first match is the latest.
        const latest = d.chats.find((c) => c.scope.kind === "team" && c.scope.member === slug);
        if (latest) {
          navigate(`/agents/${encodeURIComponent(slug)}/chat/${latest.id}`, { replace: true });
        } else setNoSessions(true);
      })
      .catch(() => alive && setNoSessions(true));
    return () => {
      alive = false;
    };
  }, [slug]);
  if (!noSessions) return <div className="empty">loading…</div>;
  return <MemberView slug={slug} />;
}

/* ---------- sessions sidebar ---------- */

function SessionsSide({ slug, chatId }: { slug: string; chatId?: string }) {
  const data = usePoll<{ chats: Array<ChatMeta & { busy: boolean }> }>("/api/chats", false);
  const sessions = (data?.chats ?? []).filter(
    (c) => c.scope.kind === "team" && c.scope.member === slug
  );
  const [creating, setCreating] = useState(false);

  return (
    <aside className="runs-side">
      <div className="side-head">
        <span className="microlabel">sessions</span>
        <span className="spacer" />
        <Link href={`/agents/${encodeURIComponent(slug)}/info`} className="open-raw" title="agent profile & settings">
          profile
        </Link>
        <button
          className="open-raw"
          disabled={creating}
          onClick={async () => {
            setCreating(true);
            await createChatAndOpen("claude", { kind: "team", member: slug });
            setCreating(false);
          }}
        >
          {creating ? "…" : <><Icon name="add" className="ms-sm" /> new</>}
        </button>
      </div>
      <div className="side-list">
        {sessions.map((c) => (
          <Link
            key={c.id}
            href={`/agents/${encodeURIComponent(slug)}/chat/${c.id}`}
            className={`side-row ${c.id === chatId ? "active" : ""}`}
          >
            <span className={`lamp ${c.busy ? "running" : "pending"}`} />
            <div className="side-row-body">
              <div className="side-row-top">
                <span className="side-wf">{c.title || "new session"}</span>
              </div>
              <div className="side-row-sub">
                <span className="side-when num">{fmtWhen(c.updatedAt)}</span>
              </div>
            </div>
            <button
              type="button"
              className="row-x"
              title="delete session"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!window.confirm(`Delete session "${c.title || c.id}"?`)) return;
                await fetch(`/api/chats/${c.id}`, { method: "DELETE" }).catch(() => {});
                if (c.id === chatId) navigate(`/agents/${encodeURIComponent(slug)}`);
              }}
            >
              <Icon name="close" className="ms-sm" />
            </button>
          </Link>
        ))}
        {data && sessions.length === 0 && <div className="viewer-note">no sessions yet</div>}
      </div>
    </aside>
  );
}

/* ---------- general chats sidebar ---------- */

// Chats that don't belong to an agent (scope kind != team) — the former
// standalone chat screen, now living under the agents screen.
function GeneralChatsSide({ chatId }: { chatId?: string }) {
  const data = usePoll<{ chats: Array<ChatMeta & { busy: boolean }> }>("/api/chats", false);
  const chats = (data?.chats ?? []).filter((c) => c.scope.kind !== "team");

  return (
    <aside className="runs-side">
      <div className="side-head">
        <span className="microlabel">chats</span>
        <span className="spacer" />
        <Link href="/agents/chats" className="open-raw">
          <Icon name="add" className="ms-sm" /> new
        </Link>
      </div>
      <div className="side-list">
        {chats.map((c) => (
          <Link
            key={c.id}
            href={`/agents/chats/${c.id}`}
            className={`side-row ${c.id === chatId ? "active" : ""}`}
          >
            <span className={`lamp ${c.busy ? "running" : "pending"}`} />
            <div className="side-row-body">
              <div className="side-row-top">
                <span className="side-wf">{c.title || "new chat"}</span>
              </div>
              <div className="side-row-sub">
                <span className="side-req">
                  {c.agent}
                  {c.scope.kind === "run"
                    ? ` · ${c.scope.runId}`
                    : c.scope.kind === "kraftwerk"
                      ? " · kraftwerk"
                      : c.scope.kind === "knowledge"
                        ? ` · knowledge${c.scope.bundle ? `:${c.scope.bundle}` : ""}`
                        : ""}
                </span>
                <span className="side-when num">{fmtWhen(c.updatedAt)}</span>
              </div>
            </div>
            <button
              type="button"
              className="row-x"
              title="delete chat"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!window.confirm(`Delete chat "${c.title || c.id}"?`)) return;
                await fetch(`/api/chats/${c.id}`, { method: "DELETE" }).catch(() => {});
                if (c.id === chatId) navigate("/agents/chats");
              }}
            >
              <Icon name="close" className="ms-sm" />
            </button>
          </Link>
        ))}
        {data && chats.length === 0 && <div className="viewer-note">no chats yet</div>}
      </div>
    </aside>
  );
}

/* ---------- home ---------- */

function TeamHome({ hasMembers, root }: { hasMembers: boolean; root?: string }) {
  const expert = useExpertMode();
  return (
    <div className="new-chat">
      <div className="page-head">
        <h1>agents</h1>
      </div>
      <section className="panel new-chat-panel">
        <div className="panel-head">
          <span className="microlabel">what lives here</span>
        </div>
        <div className="know-intro">
          Your agents, set up like teammates: each one has a name, a role (system prompt), a
          harness/model to run on, and the workflows that belong to its job. An agent lives in{" "}
          <code>{root ? `${root}/<slug>/` : "agents/<slug>/"}</code> as <code>agent.yml</code> +{" "}
          <code>system.md</code> — git-tracked, so your team travels with the repo. Every session
          is a persistent conversation with that agent; it knows its connected workflows and
          knowledge bundles, runs the workflows for you, and keeps the knowledge current.
        </div>
        {expert ? (
          <div style={{ padding: "0 16px 16px" }}>
            <button className="run-btn" onClick={() => navigate("/agents/new")}>
              <><Icon name="add" className="ms-sm" /> {hasMembers ? "new agent" : "create your first agent"}</>
            </button>
          </div>
        ) : (
          <div className="settings-note" style={{ padding: "0 16px 16px" }}>
            Creating agents needs expert mode — flip the switch in the top bar.
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------- member profile ---------- */

/**
 * Agent profile with in-place editing: role, workflows, knowledge, and
 * skills save right here (full PUT with the changed section merged in).
 * Identity fields (name, emoji, harness, model, …) stay in the full editor.
 */
function MemberView({ slug }: { slug: string }) {
  const [member, setMember] = useState<TeamMemberDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [editing, setEditing] = useState<"" | "role" | "workflows" | "knowledge" | "skills">("");
  const [roleDraft, setRoleDraft] = useState("");
  const [listDraft, setListDraft] = useState<string[]>([]);
  const [allSkillsDraft, setAllSkillsDraft] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const wfData = usePoll<{ workflows: WorkflowSummary[] }>("/api/workflows", false);
  const kData = usePoll<KnowledgeIndex>("/api/knowledge", false);
  const sData = usePoll<{ skills: SkillInfo[] }>("/api/skills", false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/team/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m) => alive && setMember(m))
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
    };
  }, [slug]);

  async function save(patch: {
    system?: string;
    workflows?: string[];
    knowledge?: string[];
    skills?: string[];
  }): Promise<void> {
    if (!member) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/team/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // Full member + the changed section; an absent skills key = all skills.
        body: JSON.stringify({
          name: member.name,
          emoji: member.emoji,
          description: member.description,
          harness: member.harness,
          model: member.model,
          effort: member.effort,
          group: member.group,
          system: member.system,
          workflows: member.workflows,
          knowledge: member.knowledge,
          skills: member.skills,
          ...patch,
        }),
      });
      const body = await res.json();
      if (body.error) setError(body.error);
      else {
        setMember(body);
        setEditing("");
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  function toggleDraft(name: string, on: boolean): void {
    setListDraft(on ? [...listDraft, name] : listDraft.filter((n) => n !== name));
  }

  async function setArchived(archived: boolean): Promise<void> {
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(slug)}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const body = await r.json();
      if (body.error) setError(body.error);
      else setMember(body);
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  }

  if (gone) return <div className="empty">agent not found</div>;
  if (!member) return <div className="empty">loading…</div>;

  const editActions = (patch: Parameters<typeof save>[0]) => (
    <div className="team-form-row" style={{ marginTop: 8 }}>
      <button className="run-btn" disabled={saving} onClick={() => void save(patch)}>
        {saving ? "saving…" : "save"}
      </button>
      <button className="open-raw" disabled={saving} onClick={() => (setEditing(""), setError(""))}>
        cancel
      </button>
    </div>
  );

  return (
    <div className="member-view">
      <div className="detail-head">
        <span className="agent-avatar lg">
          <span aria-hidden>{member.emoji}</span>
        </span>
        <h1>{member.name}</h1>
        <span className="chip agent">{member.harness}</span>
        {member.model && <span className="chip">{member.model}</span>}
        {member.effort && <span className="chip">effort: {member.effort}</span>}
        {member.archived && <span className="chip archived-chip"><Icon name="inventory_2" className="ms-sm" /> archived</span>}
        <span className="spacer" />
        <Link href={`/agents/${encodeURIComponent(slug)}/edit`} className="open-raw">
          edit
        </Link>
        {member.archived ? (
          <button className="run-btn tonal" disabled={saving} onClick={() => void setArchived(false)}>
            <Icon name="unarchive" className="ms-sm" /> {saving ? "…" : "unarchive"}
          </button>
        ) : (
          <>
            <button
              className="open-raw"
              disabled={saving}
              title="Hide this agent from the roster — restorable any time"
              onClick={() => void setArchived(true)}
            >
              <Icon name="archive" className="ms-sm" /> archive
            </button>
            <button
              className="run-btn"
              disabled={creating}
              onClick={async () => {
                setCreating(true);
                await createChatAndOpen("claude", { kind: "team", member: slug });
                setCreating(false);
              }}
            >
              {creating ? "starting…" : "new session"}
            </button>
          </>
        )}
      </div>
      <section className="panel">
        <div className="m3-list">
          <button type="button" className="m3-row m3-toggle" onClick={() => setRoleOpen(!roleOpen)}>
            <span className="m3-ico"><Icon name="badge" /></span>
            <span className="m3-body">
              <span className="m3-head">role</span>
              {!roleOpen && (
                <span className="m3-sub m3-ellipsis">
                  {(member.system || "").trim().split("\n")[0] ||
                    "empty — expand to give this agent a role"}
                </span>
              )}
            </span>
            <span className={`m3-chev ${roleOpen ? "open" : ""}`}><Icon name="expand_more" className="ms-sm" /></span>
          </button>
          {roleOpen && editing !== "role" && (
            <div className="m3-expand">
              <pre>{member.system || "(empty — click edit to give this agent a role)"}</pre>
              <div className="team-form-row" style={{ marginTop: 10 }}>
                <button
                  className="open-raw"
                  onClick={() => {
                    setRoleDraft(member.system);
                    setEditing("role");
                    setError("");
                  }}
                >
                  <Icon name="edit" className="ms-sm" /> edit role
                </button>
                <span className="spacer" />
                <span className="m3-sub">agents/{member.slug}/system.md</span>
              </div>
            </div>
          )}
          {roleOpen && editing === "role" && (
            <div className="m3-expand">
              <textarea
                className="concept-edit"
                rows={Math.min(24, Math.max(8, roleDraft.split("\n").length + 2))}
                value={roleDraft}
                placeholder={"You are the ... for this project. Your job is ..."}
                onChange={(e) => setRoleDraft(e.target.value)}
                spellCheck={false}
              />
              {editActions({ system: roleDraft })}
            </div>
          )}
          <div className="m3-row">
            <span className="m3-ico"><Icon name="account_tree" /></span>
            <span className="m3-body">
              <span className="m3-head">workflows</span>
              {editing === "workflows" ? (
                <>
                  <div className="wf-checks">
                    {(wfData?.workflows ?? []).map((w) => (
                      <label key={w.slug}>
                        <input
                          type="checkbox"
                          checked={listDraft.includes(w.slug)}
                          onChange={(e) => toggleDraft(w.slug, e.target.checked)}
                        />
                        <b>{w.slug}</b>
                        {w.description && <span className="opt-hint"> — {w.description}</span>}
                      </label>
                    ))}
                    {(wfData?.workflows ?? []).length === 0 && (
                      <div className="viewer-note">no workflows in this project</div>
                    )}
                  </div>
                  {editActions({ workflows: listDraft })}
                </>
              ) : member.workflows.length === 0 ? (
                <span className="m3-sub">none connected — the agent can run any workflow you connect</span>
              ) : (
                <span className="m3-chips">
                  {member.workflows.map((w) => (
                    <Link key={w} href={`/workflows/${encodeURIComponent(w)}`} className="chip">
                      {w}
                    </Link>
                  ))}
                </span>
              )}
            </span>
            {editing !== "workflows" && (
              <button
                className="open-raw"
                onClick={() => {
                  setListDraft(member.workflows);
                  setEditing("workflows");
                  setError("");
                }}
              >
                edit
              </button>
            )}
          </div>
          <div className="m3-row">
            <span className="m3-ico"><Icon name="menu_book" /></span>
            <span className="m3-body">
              <span className="m3-head">knowledge</span>
              {editing === "knowledge" ? (
                <>
                  <div className="wf-checks">
                    {(kData?.bundles ?? []).map((b) => (
                      <label key={b.name}>
                        <input
                          type="checkbox"
                          checked={listDraft.includes(b.name)}
                          onChange={(e) => toggleDraft(b.name, e.target.checked)}
                        />
                        <b>{b.name}</b>
                        <span className="opt-hint"> — {b.concepts} concepts</span>
                      </label>
                    ))}
                    {(kData?.bundles ?? []).length === 0 && (
                      <div className="viewer-note">no knowledge bundles in this project</div>
                    )}
                  </div>
                  {editActions({ knowledge: listDraft })}
                </>
              ) : member.knowledge.length === 0 ? (
                <span className="m3-sub">none connected — connected bundles are read and kept current by the agent</span>
              ) : (
                <span className="m3-chips">
                  {member.knowledge.map((b) => (
                    <Link key={b} href={`/knowledge/${encodeURIComponent(b)}`} className="chip">
                      {b}
                    </Link>
                  ))}
                </span>
              )}
            </span>
            {editing !== "knowledge" && (
              <button
                className="open-raw"
                onClick={() => {
                  setListDraft(member.knowledge);
                  setEditing("knowledge");
                  setError("");
                }}
              >
                edit
              </button>
            )}
          </div>
          <div className="m3-row">
            <span className="m3-ico"><Icon name="extension" /></span>
            <span className="m3-body">
              <span className="m3-head">shared skills</span>
              {editing === "skills" ? (
                <>
                  <div className="wf-checks">
                    <label>
                      <input
                        type="checkbox"
                        checked={allSkillsDraft}
                        onChange={(e) => setAllSkillsDraft(e.target.checked)}
                      />
                      <b>all skills</b>
                      <span className="opt-hint"> — every discovered skill, including future ones</span>
                    </label>
                    {!allSkillsDraft &&
                      (sData?.skills ?? []).map((s) => (
                        <label key={s.name}>
                          <input
                            type="checkbox"
                            checked={listDraft.includes(s.name)}
                            onChange={(e) => toggleDraft(s.name, e.target.checked)}
                          />
                          <b>/{s.name}</b>
                          {s.description && <span className="opt-hint"> — {s.description}</span>}
                        </label>
                      ))}
                    {!allSkillsDraft && (sData?.skills ?? []).length === 0 && (
                      <div className="viewer-note">no skills found (.claude/skills, project or user)</div>
                    )}
                  </div>
                  {editActions({ skills: allSkillsDraft ? undefined : listDraft })}
                </>
              ) : member.skills === undefined ? (
                <span className="m3-sub">all discovered skills (default) — invoke with /name in a session</span>
              ) : member.skills.length === 0 ? (
                <span className="m3-sub">none — this agent runs without skills</span>
              ) : (
                <span className="m3-chips">
                  {member.skills.map((s) => (
                    <span key={s} className="chip">
                      /{s}
                    </span>
                  ))}
                </span>
              )}
            </span>
            {editing !== "skills" && (
              <button
                className="open-raw"
                onClick={() => {
                  setAllSkillsDraft(member.skills === undefined);
                  setListDraft(member.skills ?? []);
                  setEditing("skills");
                  setError("");
                }}
              >
                edit
              </button>
            )}
          </div>
        </div>
        {error && <div className="msg error"><Icon name="error" className="ms-sm" /> {error}</div>}
      </section>

      <AgentSkillsPanel slug={slug} />
      <RoutinesPanel slug={slug} />
    </div>
  );
}

/* ---------- agent skills (agents/<slug>/skills, private to this agent) ---------- */

// Frontmatter without a name: the folder name is the skill name, so a
// rename in the form never fights the file contents.
const AGENT_SKILL_TEMPLATE = `---
description: What this skill is for (one line)
---

Instructions this agent follows when the skill applies or is invoked with /<name>.
`;

function AgentSkillsPanel({ slug }: { slug: string }) {
  const data = usePoll<{ skills: SkillInfo[] }>(
    `/api/team/${encodeURIComponent(slug)}/skills`,
    false
  );
  const skills = data?.skills ?? [];
  const [form, setForm] = useState<{ name: string; content: string; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function edit(name: string): Promise<void> {
    setError("");
    const r = await fetch(
      `/api/team/${encodeURIComponent(slug)}/skills/${encodeURIComponent(name)}`
    );
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || body.error) return void setError(body?.error ?? "could not load skill");
    setForm({ name, content: body.content ?? "", isNew: false });
  }

  async function save(): Promise<void> {
    if (!form) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/team/${encodeURIComponent(slug)}/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.name, content: form.content }),
    });
    const body = await res.json().catch(() => ({ error: "save failed" }));
    setSaving(false);
    if (body.error) setError(body.error);
    else setForm(null);
  }

  async function remove(name: string): Promise<void> {
    if (!window.confirm(`Delete skill "/${name}" of this agent (its folder is removed)?`)) return;
    await fetch(`/api/team/${encodeURIComponent(slug)}/skills/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }).catch(() => {});
    if (form?.name === name) setForm(null);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">own skills — only this agent</span>
        <span className="spacer" />
        {!form && (
          <button
            className="open-raw"
            onClick={() => {
              setForm({ name: "", content: AGENT_SKILL_TEMPLATE, isNew: true });
              setError("");
            }}
          >
            <Icon name="add" className="ms-sm" /> new skill
          </button>
        )}
      </div>
      {skills.length === 0 && !form && (
        <div className="viewer-note">
          none — skills in <code>agents/{slug}/skills/</code> are private to this agent; skills for
          every agent live in the workspace skills folder.
        </div>
      )}
      {skills.length > 0 && !form && (
        <div className="m3-list">
          {skills.map((s) => (
            <div key={s.name} className="m3-row">
              <span className="m3-ico"><Icon name="extension" /></span>
              <span className="m3-body">
                <span className="m3-head">/{s.name}</span>
                <span className="m3-sub">{s.description || <code>SKILL.md</code>}</span>
              </span>
              <button className="open-raw" onClick={() => void edit(s.name)}>
                <Icon name="edit" className="ms-sm" /> edit
              </button>
              <button className="open-raw" onClick={() => void remove(s.name)}>
                <Icon name="close" className="ms-sm" />
              </button>
            </div>
          ))}
        </div>
      )}
      {form && (
        <div className="team-form">
          <div className="team-form-row">
            <label className="team-field" style={{ flex: 1 }}>
              name — invoked as /&lt;name&gt;
              <input
                value={form.name}
                placeholder="e.g. report-html"
                disabled={!form.isNew}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
          </div>
          <label className="team-field">
            SKILL.md — frontmatter (description) + the instructions
            <textarea
              className="concept-edit"
              rows={Math.min(28, Math.max(12, form.content.split("\n").length + 2))}
              value={form.content}
              spellCheck={false}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </label>
          <div className="team-form-row">
            <button
              className="run-btn"
              disabled={saving || !form.name.trim()}
              onClick={() => void save()}
            >
              {saving ? "saving…" : "save"}
            </button>
            <button className="open-raw" disabled={saving} onClick={() => setForm(null)}>
              cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="msg error"><Icon name="error" className="ms-sm" /> {error}</div>}
    </section>
  );
}

/* ---------- routines ---------- */

interface RoutineForm {
  id?: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
}

function RoutinesPanel({ slug }: { slug: string }) {
  const data = usePoll<{ routines: RoutineStatus[] }>(
    `/api/team/${encodeURIComponent(slug)}/routines`,
    false
  );
  const routines = data?.routines ?? [];
  const [form, setForm] = useState<RoutineForm | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function post(routine: RoutineForm): Promise<boolean> {
    setError("");
    const res = await fetch(`/api/team/${encodeURIComponent(slug)}/routines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(routine),
    });
    const body = await res.json();
    if (body.error) {
      setError(body.error);
      return false;
    }
    return true;
  }

  async function runNow(id: string) {
    setBusyId(id);
    setError("");
    const res = await fetch(
      `/api/team/${encodeURIComponent(slug)}/routines/${encodeURIComponent(id)}/run`,
      { method: "POST" }
    );
    const body = await res.json();
    setBusyId("");
    if (body.error) setError(body.error);
    else if (body.chatId) navigate(`/agents/${encodeURIComponent(slug)}/chat/${body.chatId}`);
  }

  async function remove(id: string) {
    if (!window.confirm(`Delete routine "${id}"?`)) return;
    await fetch(`/api/team/${encodeURIComponent(slug)}/routines/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">routines — scheduled prompts</span>
        <span className="spacer" />
        {!form && (
          <button
            className="open-raw"
            onClick={() => setForm({ name: "", schedule: "0 9 * * 1-5", prompt: "", enabled: true })}
          >
            <Icon name="add" className="ms-sm" /> new routine
          </button>
        )}
      </div>
      {routines.length === 0 && !form && (
        <div className="viewer-note">
          none — a routine messages this agent on a schedule (cron, server local time) and each run
          opens a new session with the result.
        </div>
      )}
      {routines.length > 0 && (
        <div className="m3-list">
          {routines.map((r) => (
            <div key={r.id} className="m3-row">
              <span className="m3-ico"><Icon name="schedule" /></span>
              <span className="m3-body">
                <span className="m3-head">
                  {r.name}
                  {r.lastError && (
                    <span className="chip stale" title={r.lastError}>
                      error
                    </span>
                  )}
                </span>
                <span className="m3-sub">
                  <code>{r.schedule}</code>
                  {!r.enabled
                    ? " · paused"
                    : r.nextRunAt
                      ? ` · next ${fmtWhen(r.nextRunAt)}`
                      : ""}
                  {" · "}
                  {r.lastChatId ? (
                    <Link href={`/agents/${encodeURIComponent(slug)}/chat/${r.lastChatId}`}>
                      last run {fmtWhen(r.lastRunAt)}
                    </Link>
                  ) : (
                    "never ran"
                  )}
                </span>
              </span>
              <button className="open-raw" disabled={busyId === r.id} onClick={() => runNow(r.id)}>
                {busyId === r.id ? "starting…" : <><Icon name="play_arrow" className="ms-sm" /> run</>}
              </button>
              <button
                className="open-raw"
                onClick={() =>
                  setForm({
                    id: r.id,
                    name: r.name,
                    schedule: r.schedule,
                    prompt: r.prompt,
                    enabled: r.enabled,
                  })
                }
              >
                edit
              </button>
              <button className="open-raw" onClick={() => void remove(r.id)}>
                delete
              </button>
              <label
                className="m3-switch"
                title={r.enabled ? "enabled — click to pause" : "paused — click to enable"}
              >
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={() =>
                    void post({
                      id: r.id,
                      name: r.name,
                      schedule: r.schedule,
                      prompt: r.prompt,
                      enabled: !r.enabled,
                    })
                  }
                />
                <span className="m3-switch-track" />
              </label>
            </div>
          ))}
        </div>
      )}
      {form && (
        <div className="team-form">
          <div className="team-form-row">
            <label className="team-field" style={{ flex: 1 }}>
              name
              <input
                value={form.name}
                placeholder="e.g. Morning report"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="team-field" style={{ width: 200 }}>
              schedule (cron)
              <input
                value={form.schedule}
                placeholder="0 9 * * 1-5"
                onChange={(e) => setForm({ ...form, schedule: e.target.value })}
              />
            </label>
            <label className="team-field wf-checks" style={{ width: 90 }}>
              enabled
              <label>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                on
              </label>
            </label>
          </div>
          <label className="team-field">
            prompt — what to ask this agent on each run
            <textarea
              rows={5}
              value={form.prompt}
              placeholder="Check ... and summarize what changed."
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
          </label>
          <div className="team-form-row">
            <button
              className="run-btn"
              disabled={!form.name.trim() || !form.prompt.trim()}
              onClick={async () => {
                if (await post(form)) setForm(null);
              }}
            >
              {form.id ? "save routine" : "create routine"}
            </button>
            <button className="open-raw" onClick={() => (setForm(null), setError(""))}>
              cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="msg error"><Icon name="error" className="ms-sm" /> {error}</div>}
    </section>
  );
}

/* ---------- editor ---------- */

function MemberEditor({ slug }: { slug?: string }) {
  const [form, setForm] = useState<{
    name: string;
    emoji: string;
    description: string;
    harness: string;
    model: string;
    effort: string;
    group: string;
    system: string;
    workflows: string[];
    knowledge: string[];
    skillsAll: boolean;
    skills: string[];
  } | null>(slug ? null : defaults());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const wfData = usePoll<{ workflows: WorkflowSummary[] }>("/api/workflows", false);
  const available = wfData?.workflows ?? [];
  const kData = usePoll<KnowledgeIndex>("/api/knowledge", false);
  const bundles = kData?.bundles ?? [];
  const sData = usePoll<{ skills: SkillInfo[] }>("/api/skills", false);
  const allSkills = sData?.skills ?? [];

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/team/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m: TeamMemberDetail) =>
        setForm({
          name: m.name,
          emoji: m.emoji,
          description: m.description ?? "",
          harness: m.harness,
          model: m.model ?? "",
          effort: m.effort ?? "",
          group: m.group ?? "",
          system: m.system,
          workflows: m.workflows,
          knowledge: m.knowledge ?? [],
          skillsAll: m.skills === undefined,
          skills: m.skills ?? [],
        })
      )
      .catch(() => setError("agent not found"));
  }, [slug]);

  function defaults() {
    return {
      name: "",
      emoji: "🤖",
      description: "",
      harness: "claude",
      model: "",
      effort: "",
      group: "",
      system: "",
      workflows: [] as string[],
      knowledge: [] as string[],
      skillsAll: true,
      skills: [] as string[],
    };
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    const res = await fetch(slug ? `/api/team/${encodeURIComponent(slug)}` : "/api/team", {
      method: slug ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      // skillsAll = no allowlist: omit the skills key entirely.
      body: JSON.stringify({ ...form, skills: form.skillsAll ? undefined : form.skills }),
    });
    const body = await res.json();
    setSaving(false);
    if (body.error) setError(body.error);
    else navigate(`/agents/${encodeURIComponent(body.slug)}/info`);
  }

  async function remove() {
    if (!slug || !window.confirm(`Delete agent "${slug}" and its definition folder?`)) return;
    await fetch(`/api/team/${encodeURIComponent(slug)}`, { method: "DELETE" }).catch(() => {});
    navigate("/agents");
  }

  if (!form) return <div className="empty">{error || "loading…"}</div>;
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  return (
    <div className="new-chat">
      <div className="page-head">
        <h1>{slug ? `edit ${slug}` : "new agent"}</h1>
      </div>
      <section className="panel new-chat-panel">
        <div className="team-form">
          <div className="team-form-row">
            <label className="team-field" style={{ flex: 1 }}>
              name
              <input
                value={form.name}
                placeholder="e.g. Max"
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
            <label className="team-field" style={{ width: 90 }}>
              emoji
              <input value={form.emoji} onChange={(e) => set({ emoji: e.target.value })} />
            </label>
          </div>
          <div className="emoji-pick">
            {EMOJI_PRESETS.map((e) => (
              <button
                key={e}
                type="button"
                className={form.emoji === e ? "active" : ""}
                onClick={() => set({ emoji: e })}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="team-form-row">
            <label className="team-field" style={{ flex: 1 }}>
              description
              <input
                value={form.description}
                placeholder="one line: what this agent is for"
                onChange={(e) => set({ description: e.target.value })}
              />
            </label>
            <label className="team-field" style={{ width: 180 }}>
              group
              <input
                value={form.group}
                placeholder="none"
                onChange={(e) => set({ group: e.target.value })}
              />
            </label>
          </div>
          <div className="team-form-row">
            <label className="team-field" style={{ width: 140 }}>
              harness
              <select value={form.harness} onChange={(e) => set({ harness: e.target.value })}>
                <option value="claude">claude</option>
                <option value="codex">codex</option>
                <option value="pi">pi</option>
              </select>
            </label>
            <label className="team-field" style={{ flex: 1 }}>
              model
              <input
                value={form.model}
                placeholder="harness default — e.g. sonnet, gpt-5.6-sol"
                onChange={(e) => set({ model: e.target.value })}
              />
            </label>
            <label className="team-field" style={{ width: 140 }}>
              effort
              <select value={form.effort} onChange={(e) => set({ effort: e.target.value })}>
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>
                    {ef || "default"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="team-field">
            system prompt — the agent's role
            <textarea
              rows={10}
              value={form.system}
              placeholder={"You are the ... for this project. Your job is ..."}
              onChange={(e) => set({ system: e.target.value })}
            />
          </label>
          <div className="team-field">
            <span className="team-field-label">connected workflows — autoloaded into the agent's context; it can run them</span>
            <div className="wf-checks">
              {available.map((w) => (
                <label key={w.slug}>
                  <input
                    type="checkbox"
                    checked={form.workflows.includes(w.slug)}
                    onChange={(e) =>
                      set({
                        workflows: e.target.checked
                          ? [...form.workflows, w.slug]
                          : form.workflows.filter((s) => s !== w.slug),
                      })
                    }
                  />
                  <b>{w.slug}</b>
                  {w.description && <span className="opt-hint"> — {w.description}</span>}
                </label>
              ))}
              {available.length === 0 && <div className="viewer-note">no workflows in this project</div>}
            </div>
          </div>
          <div className="team-field">
            <span className="team-field-label">connected knowledge — OKF bundles the agent consults and maintains</span>
            <div className="wf-checks">
              {bundles.map((b) => (
                <label key={b.name}>
                  <input
                    type="checkbox"
                    checked={form.knowledge.includes(b.name)}
                    onChange={(e) =>
                      set({
                        knowledge: e.target.checked
                          ? [...form.knowledge, b.name]
                          : form.knowledge.filter((n) => n !== b.name),
                      })
                    }
                  />
                  <b>{b.name}</b>
                  <span className="opt-hint"> — {b.concepts} concepts</span>
                </label>
              ))}
              {bundles.length === 0 && <div className="viewer-note">no knowledge bundles in this project</div>}
            </div>
          </div>
          <div className="team-field">
            <span className="team-field-label">connected skills — workspace skill packages (see the skills tab); invoked with /name in sessions</span>
            <div className="wf-checks">
              <label>
                <input
                  type="checkbox"
                  checked={form.skillsAll}
                  onChange={(e) => set({ skillsAll: e.target.checked })}
                />
                <b>all skills</b>
                <span className="opt-hint"> — every discovered skill, including future ones</span>
              </label>
              {!form.skillsAll &&
                allSkills.map((s) => (
                  <label key={s.name}>
                    <input
                      type="checkbox"
                      checked={form.skills.includes(s.name)}
                      onChange={(e) =>
                        set({
                          skills: e.target.checked
                            ? [...form.skills, s.name]
                            : form.skills.filter((n) => n !== s.name),
                        })
                      }
                    />
                    <b>/{s.name}</b>
                    {s.description && <span className="opt-hint"> — {s.description}</span>}
                  </label>
                ))}
              {!form.skillsAll && allSkills.length === 0 && (
                <div className="viewer-note">no skills found (.claude/skills, project or user)</div>
              )}
            </div>
          </div>
          {error && <div className="msg error"><Icon name="error" className="ms-sm" /> {error}</div>}
          <div className="team-form-row">
            <button className="run-btn" disabled={!form.name.trim() || saving} onClick={save}>
              {saving ? "saving…" : slug ? "save" : "create"}
            </button>
            <span className="spacer" />
            {slug && (
              <button className="stop-btn" onClick={remove}>
                delete agent
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
