import { useCallback, useEffect, useState, type ReactNode } from "react";
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
  Agent,
  AgentDetail,
  VibeablesView,
  WorkflowSummary,
} from "./types";
import { ChatThread, NewChat, createChatAndOpen } from "./chat";
import { EFFORTS, Icon, Link, navigate, usePoll, fmtWhen, useExpertMode, useFeatures } from "./shared";
import { NewTabButton, SessionsPane, useSessionsList, type Session } from "./sessions";
import { exportBundlePdf } from "./export";
import { Avatar, Button, Checkbox, cn, EmptyState, Eyebrow, Field, FieldRow, FormStack, Hint, IconButton, ListRow, Notice, Page, Panel, PanelRow, PanelRows, RowIcon, Select, SideHead, SideList, Switch, Tag, TextArea, TextField, Title } from "./ui";

/**
 * Agents: persistent agents ("employees"), each defined in
 * agents/<slug>/ (agent.yml + system.md). The screen is a double sidebar:
 * agents on the left, the selected agent's sessions next to it, and the
 * main pane shows the agent profile, a session thread, or the editor.
 * Sessions are ordinary chats with scope { kind: "agent", slug } — the
 * thread view is reused from the chat screen.
 */

const EMOJI_PRESETS = ["🤖", "🧑‍💻", "🎧", "🛠️", "📊", "✍️", "🔍", "🧹", "📦", "🚀"];

/* ---------- building blocks of these screens ---------- */

/** The line under a profile row's title. */
const SUB = "text-xs leading-[1.5] text-fg-2 [&_a]:text-inherit [&_code]:text-2xs";


function Chips({ children }: { children: ReactNode }) {
  return <span className="mt-[3px] flex flex-wrap gap-1.5">{children}</span>;
}

/** A checklist of things to connect: workflows, bundles, apps, skills. */
function Checks({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[7px] py-1">{children}</div>;
}

/** Markdown and prompts are edited as code. */
const CODE_AREA = "resize-y font-mono text-[12.5px] leading-[1.65]";

/** A group the dragged agent hovers over. */
const DROP_OVER = "bg-accent/7 outline-[1.5px] -outline-offset-[1.5px] outline-accent outline-dashed";
const GROUP_EMPTY = "px-2.5 pt-1.5 pb-2 text-2xs text-fg-2";

export function AgentsScreen({ seg }: { seg: string[] }) {
  // seg (after /agents): [] | [new] | [chats] | [chats, new] | [chats, chatId] |
  // [slug] | [slug, info] | [slug, edit] | [slug, chat, chatId]. A bare slug
  // lands on the agent's most recent session and a bare /chats on the most
  // recent general chat; the profile lives at /info, a fresh chat at /chats/new.
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
                ? "agent"
                : "home";
  const newChat = mode === "chats" && seg[1] === "new";
  const chatId = mode === "chat" ? seg[2] : mode === "chats" && !newChat ? seg[1] : undefined;

  const data = usePoll<{ root: string; agents: Agent[] }>("/api/agents", false);
  const expert = useExpertMode();
  const listOpen = useSessionsList();

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

  const agents = (data?.agents ?? []).map((m) =>
    moved[m.slug] !== undefined ? { ...m, group: moved[m.slug] || undefined } : m
  );
  useEffect(() => {
    setMoved((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const m of data?.agents ?? []) {
        if (next[m.slug] !== undefined && (m.group ?? "") === next[m.slug]) {
          delete next[m.slug];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data]);

  // Archived agents leave the roster (and its groups) for a collapsed
  // section at the bottom; unarchiving puts them right back.
  const active = agents.filter((m) => !m.archived);
  const archivedMembers = agents.filter((m) => m.archived);
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

  // Rename = move every agent of the group; renaming onto an existing group
  // merges into it. Empty created groups just rename in localStorage.
  function renameGroup(from: string, to: string): void {
    setRenaming(null);
    const next = to.trim();
    if (!next || next === from) return;
    for (const m of agents.filter((x) => x.group === from)) void moveToGroup(m.slug, next);
    if (extraGroups.includes(from)) {
      saveExtraGroups([...new Set(extraGroups.map((g) => (g === from ? next : g)))]);
    }
  }

  // saveAgent rewrites agent.yml + system.md wholesale, so a group move must
  // carry the complete agent: fetch the detail first, then PUT it back.
  async function moveToGroup(memberSlug: string, group: string): Promise<void> {
    const current = agents.find((m) => m.slug === memberSlug);
    if ((current?.group ?? "") === group) return;
    setMoved((prev) => ({ ...prev, [memberSlug]: group }));
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(memberSlug)}`);
      if (!r.ok) throw new Error();
      const full = (await r.json()) as AgentDetail;
      const res = await fetch(`/api/agents/${encodeURIComponent(memberSlug)}`, {
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

  const memberRow = (m: Agent) => (
    <div
      key={m.slug}
      className={dragSlug === m.slug ? "opacity-40" : undefined}
      onDragStart={(e) => {
        if (!expert) return e.preventDefault();
        e.dataTransfer.setData("text/plain", m.slug);
        e.dataTransfer.effectAllowed = "move";
        setDragSlug(m.slug);
      }}
      onDragEnd={() => {
        setDragSlug(null);
        setDropGroup(null);
      }}
    >
      <ListRow
        href={`/agents/${encodeURIComponent(m.slug)}`}
        active={m.slug === slug}
        leading={<span aria-hidden>{m.emoji}</span>}
        title={m.name}
        sub={m.description || m.harness}
      />
    </div>
  );

  // Archived rows: no dragging, land on the profile (where unarchive lives).
  const archivedRow = (m: Agent) => (
    <ListRow
      key={m.slug}
      href={`/agents/${encodeURIComponent(m.slug)}/info`}
      active={m.slug === slug}
      dim={m.slug !== slug}
      leading={<span aria-hidden>{m.emoji}</span>}
      title={m.name}
      sub={m.description || m.harness}
    />
  );

  let main: React.ReactNode;
  if (mode === "new") main = <AgentEditor key="new" />;
  else if (mode === "edit" && slug) main = <AgentEditor key={slug} slug={slug} />;
  else if (mode === "chat" && slug && chatId === "new") main = <NewAgentSession key={slug} slug={slug} name={agents.find((m) => m.slug === slug)?.name} />;
  else if (mode === "chat" && slug && chatId)
    main = (
      <div className="chat-main">
        <ChatThread
          key={chatId}
          id={chatId}
          agentName={agents.find((m) => m.slug === slug)?.name ?? slug}
          agentDescription={agents.find((m) => m.slug === slug)?.description}
        />
      </div>
    );
  else if (mode === "chats")
    main = chatId ? (
      <div className="chat-main">
        <ChatThread key={chatId} id={chatId} />
      </div>
    ) : newChat ? (
      <NewChat />
    ) : (
      <GeneralChatsLanding />
    );
  else if (mode === "info" && slug) main = <AgentView key={slug} slug={slug} />;
  else if (slug) main = <AgentLanding key={slug} slug={slug} name={agents.find((m) => m.slug === slug)?.name} />;
  else if (!data) main = <EmptyState>loading…</EmptyState>;
  else if (active.length) main = <AgentsLanding agents={active} />;
  else main = <AgentsHome />;

  // Linked knowledge bundles of the selected agent → right sidebar on the
  // profile and chat views (not while editing). Hidden state persists.
  const kBundles =
    (mode === "agent" || mode === "info" || mode === "chat") && slug
      ? (agents.find((m) => m.slug === slug)?.knowledge ?? [])
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
      className={`runs-screen agents-screen ${slug || mode === "chats" ? "has-tabs" : ""} ${(slug || mode === "chats") && listOpen ? "has-sessions" : ""} ${showKnowledge ? "has-knowledge" : ""}`}
      style={showKnowledge ? ({ "--kside-w": `${kWidth}px` } as React.CSSProperties) : undefined}
    >
      <aside className="runs-side">
        <SideHead
          title="agents"
          action={
            expert && (
              <Button size="sm" variant="quiet" icon="add" href="/agents/new">
                new
              </Button>
            )
          }
        />
        <SideList>
          <div className="mb-1.5 border-b border-line pb-1.5">
            <ListRow href="/agents/chats" active={mode === "chats"} leading={<span aria-hidden>🎩</span>} title="Ralv" sub="chief of staff of the workspace" />
          </div>
          <div className={cn("rounded-xl", dragSlug && dropGroup === "" && DROP_OVER)} {...dropProps("")}>
            {ungrouped.map(memberRow)}
            {dragSlug != null && ungrouped.length === 0 && <div className={GROUP_EMPTY}>no group — drop here</div>}
          </div>
          {groups.map((g) => {
            const its = active.filter((m) => m.group === g);
            return (
              <div key={g} className={cn("group/grp mt-3 rounded-xl", dragSlug && dropGroup === g && DROP_OVER)} {...dropProps(g)}>
                <div className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-0.5">
                  {renaming === g ? (
                    <TextField
                      className="h-7 min-w-0 flex-1 text-2xs"
                      autoFocus
                      aria-label="group name"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameGroup(g, renameDraft);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={() => renameGroup(g, renameDraft)}
                    />
                  ) : (
                    <Eyebrow>{g}</Eyebrow>
                  )}
                  <span className="text-[10px] tabular-nums text-fg-2">{its.length}</span>
                  <span className="flex-1" />
                  {expert && renaming !== g && (
                    <IconButton
                      icon="edit"
                      label="Rename group"
                      size="sm"
                      className="size-6 opacity-0 group-hover/grp:opacity-100 focus-visible:opacity-100"
                      onClick={() => {
                        setRenaming(g);
                        setRenameDraft(g);
                      }}
                    />
                  )}
                  {expert && its.length === 0 && extraGroups.includes(g) && (
                    <IconButton
                      icon="close"
                      label="Remove empty group"
                      size="sm"
                      className="size-6 opacity-0 group-hover/grp:opacity-100 focus-visible:opacity-100"
                      onClick={() => saveExtraGroups(extraGroups.filter((x) => x !== g))}
                    />
                  )}
                </div>
                {its.map(memberRow)}
                {its.length === 0 && <div className={GROUP_EMPTY}>{expert ? "drag agents here" : "no agents"}</div>}
              </div>
            );
          })}
          {archivedMembers.length > 0 && (
            <div className="mt-2.5 border-t border-line pt-1">
              <button
                type="button"
                className="group/arch flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2.5 pt-1.5 pb-0.5 text-left text-fg-2"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((v) => !v)}
              >
                <Eyebrow className="group-hover/arch:text-fg">archived</Eyebrow>
                <span className="text-[10px] tabular-nums">{archivedMembers.length}</span>
                <span className="flex-1" />
                <Icon name={showArchived ? "expand_less" : "expand_more"} className="ms-sm" />
              </button>
              {showArchived && archivedMembers.map(archivedRow)}
            </div>
          )}
          {data && agents.length === 0 && <Hint className="py-1.5 px-2.5">no agents yet</Hint>}
          {expert &&
            (addingGroup ? (
              <div className="px-2.5 pt-2.5 pb-1">
                <TextField
                  className="h-8 text-sm"
                  autoFocus
                  aria-label="new group"
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
              <button
                type="button"
                className="mx-2.5 mt-3 mb-1 flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-line bg-transparent px-2.5 py-1 text-2xs text-fg-2 hover:text-accent"
                onClick={() => setAddingGroup(true)}
              >
                <Icon name="add" className="ms-sm" /> group
              </button>
            ))}
        </SideList>
      </aside>
      {slug && <AgentSessions slug={slug} chatId={chatId === "new" ? undefined : chatId} />}
      {mode === "chats" && <GeneralSessions chatId={chatId} />}
      <div className="runs-main">{main}</div>
      {showKnowledge && (
        <KnowledgeSide bundles={kBundles} onHide={() => toggleKnowledge(false)} onResize={resizeKnowledge} />
      )}
      {kBundles.length > 0 && !kOpen && (
        <button
          type="button"
          className="kside-reopen fixed top-[60px] right-3.5 z-5 inline-flex cursor-pointer items-center gap-1 rounded-full border border-line bg-surface-2 px-3 py-1 text-2xs text-fg-2 hover:text-fg"
          onClick={() => toggleKnowledge(true)}
          title="Show knowledge sidebar"
        >
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

/* ---------- landing ---------- */

/**
 * A bare #/agents/<slug> URL jumps straight into the agent's most recent
 * session; with no sessions yet it offers a first one (the profile is the
 * pencil on the sign).
 */
function AgentLanding({ slug, name }: { slug: string; name?: string }) {
  const [noSessions, setNoSessions] = useState(false);
  useEffect(() => {
    let alive = true;
    setNoSessions(false);
    fetch("/api/chats")
      .then((r) => r.json())
      .then((d: { chats: ChatMeta[] }) => {
        if (!alive) return;
        // /api/chats is sorted by updatedAt desc — first match is the latest.
        const latest = d.chats.find((c) => c.scope.kind === "agent" && c.scope.slug === slug);
        if (latest) {
          navigate(`/agents/${encodeURIComponent(slug)}/chat/${latest.id}`, { replace: true });
        } else setNoSessions(true);
      })
      .catch(() => alive && setNoSessions(true));
    return () => {
      alive = false;
    };
  }, [slug]);
  if (!noSessions) return <EmptyState>loading…</EmptyState>;
  return <NewAgentSession slug={slug} name={name} />;
}

/** The fresh pane of an agent: what shows when no session is open. */
function NewAgentSession({ slug, name }: { slug: string; name?: string }) {
  const [creating, setCreating] = useState(false);
  return (
    <Page width="narrow">
      <Title>new session with {name ?? slug}</Title>
      <Panel>
        <div className="p-4">
          <button
            type="button"
            className="flex w-full cursor-pointer flex-col gap-0.5 rounded-card border border-transparent bg-accent-soft px-3.5 py-3 text-left text-on-accent-soft transition-colors hover:brightness-[0.98] disabled:cursor-default disabled:opacity-60"
            disabled={creating}
            onClick={async () => {
              setCreating(true);
              await createChatAndOpen("claude", { kind: "agent", slug });
              setCreating(false);
            }}
          >
            <b className="text-base font-medium">{creating ? "starting…" : "start chat"}</b>
            <span className="text-xs">on the agent's harness, with its role, knowledge and skills</span>
          </button>
        </div>
      </Panel>
    </Page>
  );
}

/**
 * A bare #/agents/chats (the "Ralv" entry) opens the most recent
 * general chat, like an agent's entry opens its latest session; with none
 * yet it shows the new-chat pane, which otherwise lives at /chats/new.
 */
function GeneralChatsLanding() {
  const [none, setNone] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/chats")
      .then((r) => r.json())
      .then((d: { chats: ChatMeta[] }) => {
        if (!alive) return;
        // /api/chats is sorted by updatedAt desc — first match is the latest.
        const latest = d.chats.find((c) => c.scope.kind !== "agent" && c.scope.kind !== "channel" && c.scope.kind !== "project");
        if (latest) navigate(`/agents/chats/${latest.id}`, { replace: true });
        else setNone(true);
      })
      .catch(() => alive && setNone(true));
    return () => {
      alive = false;
    };
  }, []);
  if (!none) return <EmptyState>loading…</EmptyState>;
  return <NewChat />;
}

/* ---------- sessions: tabs above the chat, the list on request ---------- */

function AgentSessions({ slug, chatId }: { slug: string; chatId?: string }) {
  const [creating, setCreating] = useState(false);
  const filter = useCallback((chats: Session[]) => chats.filter((c) => c.scope.kind === "agent" && c.scope.slug === slug), [slug]);
  const hrefOf = useCallback((c: Session) => `/agents/${encodeURIComponent(slug)}/chat/${c.id}`, [slug]);
  return (
    <SessionsPane
      storeKey={`agent:${slug}`}
      label="chats"
      fallbackTitle="new chat"
      chatId={chatId}
      filter={filter}
      hrefOf={hrefOf}
      closeHref={`/agents/${encodeURIComponent(slug)}/chat/new`}
      actions={
        <NewTabButton
          busy={creating}
          onClick={async () => {
            setCreating(true);
            await createChatAndOpen("claude", { kind: "agent", slug: slug });
            setCreating(false);
          }}
        />
      }
    />
  );
}

// Chats that belong to no agent, channel or project — Ralv's.
const generalChats = (chats: Session[]): Session[] => chats.filter((c) => c.scope.kind !== "agent" && c.scope.kind !== "channel" && c.scope.kind !== "project");
const generalHref = (c: Session): string => `/agents/chats/${c.id}`;

function GeneralSessions({ chatId }: { chatId?: string }) {
  return (
    <SessionsPane
      storeKey="general"
      label="chats"
      fallbackTitle="new chat"
      chatId={chatId}
      filter={generalChats}
      hrefOf={generalHref}
      closeHref="/agents/chats/new"
      subOf={(c) => (
        <>
          {c.agent}
          {c.scope.kind === "run"
            ? ` · ${c.scope.runId}`
            : c.scope.kind === "kraftwerk"
              ? " · kraftwerk"
              : c.scope.kind === "knowledge"
                ? ` · knowledge${c.scope.bundle ? `:${c.scope.bundle}` : ""}`
                : ""}
        </>
      )}
      actions={
        <NewTabButton href="/agents/chats/new" />
      }
    />
  );
}

/* ---------- home ---------- */

/**
 * #/agents with agents in the workspace: land on the most recent agent
 * session (like #/channels lands on the latest channel); an agent that has
 * never been talked to lands on its profile.
 */
function AgentsLanding({ agents }: { agents: Agent[] }) {
  useEffect(() => {
    let alive = true;
    const fallback = () => navigate(`/agents/${encodeURIComponent(agents[0].slug)}`, { replace: true });
    fetch("/api/chats")
      .then((r) => r.json())
      .then((d: { chats: ChatMeta[] }) => {
        if (!alive) return;
        // /api/chats is sorted by updatedAt desc — the first agent session wins.
        const slugs = new Set(agents.map((a) => a.slug));
        const latest = d.chats.find((c) => c.scope.kind === "agent" && slugs.has(c.scope.slug));
        if (latest && latest.scope.kind === "agent") {
          navigate(`/agents/${encodeURIComponent(latest.scope.slug)}/chat/${latest.id}`, { replace: true });
        } else fallback();
      })
      .catch(() => alive && fallback());
    return () => {
      alive = false;
    };
  }, [agents.map((a) => a.slug).join(",")]);
  return <EmptyState>loading…</EmptyState>;
}

/** No agents yet: nothing to explain, one thing to do (which needs expert mode). */
function AgentsHome() {
  const expert = useExpertMode();
  return (
    <div className="empty-action flex justify-center py-16 text-center text-sm text-fg-2">
      {expert ? (
        // run-btn: the hook e2e/agents.spec.ts finds the one action by.
        <Button variant="primary" icon="add" onClick={() => navigate("/agents/new")}>
          create your first agent
        </Button>
      ) : (
        <span>Creating agents needs expert mode — flip the switch in the top bar.</span>
      )}
    </div>
  );
}

/* ---------- agent profile ---------- */

/**
 * Agent profile with in-place editing: role, workflows, knowledge, vibeables
 * and skills save right here (full PUT with the changed section merged in).
 * Identity fields (name, emoji, harness, model, …) stay in the full editor.
 */
export function AgentView({ slug }: { slug: string }) {
  const [agent, setMember] = useState<AgentDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [editing, setEditing] = useState<"" | "role" | "workflows" | "knowledge" | "vibeables" | "skills">("");
  const [roleDraft, setRoleDraft] = useState("");
  const [listDraft, setListDraft] = useState<string[]>([]);
  const [allSkillsDraft, setAllSkillsDraft] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const features = useFeatures();
  const wfData = usePoll<{ workflows: WorkflowSummary[] }>("/api/workflows", false);
  const kData = usePoll<KnowledgeIndex>("/api/knowledge", false);
  const vData = usePoll<VibeablesView>(features.vibeables ? "/api/vibeables" : "", false);
  const sData = usePoll<{ skills: SkillInfo[] }>("/api/skills", false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/agents/${encodeURIComponent(slug)}`)
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
    vibeables?: string[];
    skills?: string[];
  }): Promise<void> {
    if (!agent) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // Full agent + the changed section; an absent skills key = all skills.
        body: JSON.stringify({
          name: agent.name,
          emoji: agent.emoji,
          description: agent.description,
          harness: agent.harness,
          model: agent.model,
          effort: agent.effort,
          group: agent.group,
          system: agent.system,
          workflows: agent.workflows,
          knowledge: agent.knowledge,
          vibeables: agent.vibeables,
          skills: agent.skills,
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
      const r = await fetch(`/api/agents/${encodeURIComponent(slug)}/archive`, {
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

  if (gone) return <EmptyState icon="person_off">agent not found</EmptyState>;
  if (!agent) return <EmptyState>loading…</EmptyState>;

  const editActions = (patch: Parameters<typeof save>[0]) => (
    <div className="mt-2 flex items-center gap-2.5">
      <Button variant="primary" busy={saving} onClick={() => void save(patch)}>
        {saving ? "saving…" : "save"}
      </Button>
      <Button variant="quiet" disabled={saving} onClick={() => (setEditing(""), setError(""))}>
        cancel
      </Button>
    </div>
  );
  const editButton = (open: () => void) => (
    <Button
      size="sm"
      onClick={() => {
        open();
        setError("");
      }}
    >
      edit
    </Button>
  );

  return (
    <div className="agent-view flex animate-rise flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <Avatar>
          <span aria-hidden>{agent.emoji}</span>
        </Avatar>
        <Title size="lg">{agent.name}</Title>
        <Tag>{agent.harness}</Tag>
        {agent.model && <Tag>{agent.model}</Tag>}
        {agent.effort && <Tag>effort: {agent.effort}</Tag>}
        {agent.archived && (
          <Tag>
            <Icon name="inventory_2" className="ms-sm mr-1" /> archived
          </Tag>
        )}
        <span className="flex-1" />
        <Button href={`/agents/${encodeURIComponent(slug)}/edit`}>edit</Button>
        {agent.archived ? (
          <Button variant="primary" icon="unarchive" busy={saving} onClick={() => void setArchived(false)}>
            {saving ? "…" : "unarchive"}
          </Button>
        ) : (
          <Button
            variant="quiet"
            icon="archive"
            disabled={saving}
            title="Hide this agent from the roster — restorable any time"
            onClick={() => void setArchived(true)}
          >
            archive
          </Button>
        )}
      </div>
      <Panel>
        <PanelRows>
          <div>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-3.5 border-0 bg-transparent px-[18px] py-3 text-left font-[inherit] text-inherit hover:bg-surface-2"
              aria-expanded={roleOpen}
              onClick={() => setRoleOpen(!roleOpen)}
            >
              <RowIcon name="badge" />
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="text-[13.5px] font-medium text-fg">role</span>
                {!roleOpen && (
                  <span className={cn(SUB, "truncate")}>
                    {(agent.system || "").trim().split("\n")[0] || "empty — expand to give this agent a role"}
                  </span>
                )}
              </span>
              <Icon name="expand_more" className={cn("ms-sm flex-none text-fg-2 transition-transform", roleOpen && "rotate-180")} />
            </button>
            {roleOpen && editing !== "role" && (
              <div className="pr-[18px] pb-4 pl-16">
                <pre className="m-0 font-mono text-[12.5px] leading-[1.65] whitespace-pre-wrap">
                  {agent.system || "(empty — click edit to give this agent a role)"}
                </pre>
                <div className="mt-2.5 flex items-center gap-2.5">
                  <Button
                    size="sm"
                    icon="edit"
                    onClick={() => {
                      setRoleDraft(agent.system);
                      setEditing("role");
                      setError("");
                    }}
                  >
                    edit role
                  </Button>
                  <span className="flex-1" />
                  <span className={SUB}>agents/{agent.slug}/system.md</span>
                </div>
              </div>
            )}
            {roleOpen && editing === "role" && (
              <div className="pr-[18px] pb-4 pl-16">
                <TextArea
                  className={CODE_AREA}
                  aria-label="role"
                  rows={Math.min(24, Math.max(8, roleDraft.split("\n").length + 2))}
                  value={roleDraft}
                  placeholder={"You are the ... for this project. Your job is ..."}
                  onChange={(e) => setRoleDraft(e.target.value)}
                  spellCheck={false}
                />
                {editActions({ system: roleDraft })}
              </div>
            )}
          </div>
          <PanelRow
            icon="account_tree"
            title="workflows"
            action={editing !== "workflows" && editButton(() => (setListDraft(agent.workflows), setEditing("workflows")))}
          >
            {editing === "workflows" ? (
              <>
                <Checks>
                  {(wfData?.workflows ?? []).map((w) => (
                    <Checkbox key={w.slug} checked={listDraft.includes(w.slug)} onChange={(on) => toggleDraft(w.slug, on)} hint={w.description} mono>{w.slug}</Checkbox>
                  ))}
                  {(wfData?.workflows ?? []).length === 0 && <Hint className="py-1.5 px-0">no workflows in this project</Hint>}
                </Checks>
                {editActions({ workflows: listDraft })}
              </>
            ) : agent.workflows.length === 0 ? (
              <span className={SUB}>none connected — the agent can run any workflow you connect</span>
            ) : (
              <Chips>
                {agent.workflows.map((w) => (
                  <Tag key={w} href={`/workflows/${encodeURIComponent(w)}`}>
                    {w}
                  </Tag>
                ))}
              </Chips>
            )}
          </PanelRow>
          <PanelRow
            icon="menu_book"
            title="knowledge"
            action={editing !== "knowledge" && editButton(() => (setListDraft(agent.knowledge), setEditing("knowledge")))}
          >
            {editing === "knowledge" ? (
              <>
                <Checks>
                  {(kData?.bundles ?? []).map((b) => (
                    <Checkbox key={b.name} checked={listDraft.includes(b.name)} onChange={(on) => toggleDraft(b.name, on)} hint={`${b.concepts} concepts`} mono>{b.name}</Checkbox>
                  ))}
                  {(kData?.bundles ?? []).length === 0 && <Hint className="py-1.5 px-0">no knowledge bundles in this project</Hint>}
                </Checks>
                {editActions({ knowledge: listDraft })}
              </>
            ) : agent.knowledge.length === 0 ? (
              <span className={SUB}>none connected — connected bundles are read and kept current by the agent</span>
            ) : (
              <Chips>
                {agent.knowledge.map((b) => (
                  <Tag key={b} href={`/knowledge/${encodeURIComponent(b)}`}>
                    {b}
                  </Tag>
                ))}
              </Chips>
            )}
          </PanelRow>
          {(features.vibeables || (agent.vibeables ?? []).length > 0) && (
            <PanelRow
              icon="web"
              title="apps"
              data-link-kind="vibeables"
              action={editing !== "vibeables" && editButton(() => (setListDraft(agent.vibeables ?? []), setEditing("vibeables")))}
            >
              {editing === "vibeables" ? (
                <>
                  <Checks>
                    {(vData?.vibeables ?? []).map((v) => (
                      <Checkbox key={v.slug} checked={listDraft.includes(v.slug)} onChange={(on) => toggleDraft(v.slug, on)} hint={v.dev ? "dev" : "static"} mono>{v.slug}</Checkbox>
                    ))}
                    {/* A linked app that is gone stays in the draft so unticking removes it; it just has no folder to show. */}
                    {listDraft
                      .filter((slug) => !(vData?.vibeables ?? []).some((v) => v.slug === slug))
                      .map((slug) => (
                        <Checkbox key={slug} checked onChange={(on) => toggleDraft(slug, on)} hint="not found in this workspace" mono>{slug}</Checkbox>
                      ))}
                    {!features.vibeables && <Hint className="py-1.5 px-0">vibeables are off in this workspace's settings</Hint>}
                    {features.vibeables && (vData?.vibeables ?? []).length === 0 && (
                      <Hint className="py-1.5 px-0">no apps in this workspace yet — create one on the apps page</Hint>
                    )}
                  </Checks>
                  {editActions({ vibeables: listDraft })}
                </>
              ) : (agent.vibeables ?? []).length === 0 ? (
                <span className={SUB}>none linked — linked apps are the agent's to build and maintain; it knows them from the first message</span>
              ) : (
                <Chips>
                  {(agent.vibeables ?? []).map((v) => {
                    const found = !features.vibeables || !vData || vData.vibeables.some((x) => x.slug === v);
                    return (
                      <Tag
                        key={v}
                        href={`/vibeables/${encodeURIComponent(v)}`}
                        tone={found ? "neutral" : "bad"}
                        title={found ? undefined : "configured but not found in this workspace"}
                      >
                        {v}
                        {!found && " · not found"}
                      </Tag>
                    );
                  })}
                </Chips>
              )}
            </PanelRow>
          )}
          <PanelRow
            icon="extension"
            title="shared skills"
            action={
              editing !== "skills" &&
              editButton(() => {
                setAllSkillsDraft(agent.skills === undefined);
                setListDraft(agent.skills ?? []);
                setEditing("skills");
              })
            }
          >
            {editing === "skills" ? (
              <>
                <Checks>
                  <Checkbox checked={allSkillsDraft} onChange={setAllSkillsDraft} hint="every discovered skill, including future ones" mono>all skills</Checkbox>
                  {!allSkillsDraft &&
                    (sData?.skills ?? []).map((s) => (
                      <Checkbox key={s.name} checked={listDraft.includes(s.name)} onChange={(on) => toggleDraft(s.name, on)} hint={s.description} mono>{`/${s.name}`}</Checkbox>
                    ))}
                  {!allSkillsDraft && (sData?.skills ?? []).length === 0 && (
                    <Hint className="py-1.5 px-0">no skills found (.claude/skills, project or user)</Hint>
                  )}
                </Checks>
                {editActions({ skills: allSkillsDraft ? undefined : listDraft })}
              </>
            ) : agent.skills === undefined ? (
              <span className={SUB}>all discovered skills (default) — invoke with /name in a session</span>
            ) : agent.skills.length === 0 ? (
              <span className={SUB}>none — this agent runs without skills</span>
            ) : (
              <Chips>
                {agent.skills.map((s) => (
                  <Tag key={s}>/{s}</Tag>
                ))}
              </Chips>
            )}
          </PanelRow>
        </PanelRows>
        {error && (
          <div className="px-[18px] pb-3">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
      </Panel>

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
    `/api/agents/${encodeURIComponent(slug)}/skills`,
    false
  );
  const skills = data?.skills ?? [];
  const [form, setForm] = useState<{ name: string; content: string; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function edit(name: string): Promise<void> {
    setError("");
    const r = await fetch(
      `/api/agents/${encodeURIComponent(slug)}/skills/${encodeURIComponent(name)}`
    );
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || body.error) return void setError(body?.error ?? "could not load skill");
    setForm({ name, content: body.content ?? "", isNew: false });
  }

  async function save(): Promise<void> {
    if (!form) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/skills`, {
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
    if (!window.confirm(`Move skill "/${name}" of this agent to the trash?`)) return;
    await fetch(`/api/agents/${encodeURIComponent(slug)}/skills/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }).catch(() => {});
    if (form?.name === name) setForm(null);
  }

  return (
    <Panel
      title="own skills — only this agent"
      actions={
        !form && (
          <Button
            size="sm"
            icon="add"
            onClick={() => {
              setForm({ name: "", content: AGENT_SKILL_TEMPLATE, isNew: true });
              setError("");
            }}
          >
            new skill
          </Button>
        )
      }
    >
      {skills.length === 0 && !form && (
        <Hint className="px-[18px] py-3 text-xs">
          none — skills in <code>agents/{slug}/skills/</code> are private to this agent; skills for
          every agent live in the workspace skills folder.
        </Hint>
      )}
      {skills.length > 0 && !form && (
        <PanelRows>
          {skills.map((s) => (
            <PanelRow
              key={s.name}
              icon="extension"
              title={`/${s.name}`}
              action={
                <>
                  <Button size="sm" icon="edit" onClick={() => void edit(s.name)}>
                    edit
                  </Button>
                  <IconButton icon="delete" label={`delete /${s.name}`} variant="danger" size="sm" onClick={() => void remove(s.name)} />
                </>
              }
            >
              <span className={SUB}>{s.description || <code>SKILL.md</code>}</span>
            </PanelRow>
          ))}
        </PanelRows>
      )}
      {form && (
        <FormStack className="max-w-[680px]">
          <Field label="name — invoked as /<name>">
            <TextField
              className="font-mono"
              value={form.name}
              placeholder="e.g. report-html"
              disabled={!form.isNew}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="SKILL.md — frontmatter (description) + the instructions">
            <TextArea
              className={CODE_AREA}
              rows={Math.min(28, Math.max(12, form.content.split("\n").length + 2))}
              value={form.content}
              spellCheck={false}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-2.5">
            <Button variant="primary" busy={saving} disabled={!form.name.trim()} onClick={() => void save()}>
              {saving ? "saving…" : "save"}
            </Button>
            <Button variant="quiet" disabled={saving} onClick={() => setForm(null)}>
              cancel
            </Button>
          </div>
        </FormStack>
      )}
      {error && (
        <div className="px-[18px] pb-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Panel>
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
    `/api/agents/${encodeURIComponent(slug)}/routines`,
    false
  );
  const routines = data?.routines ?? [];
  const [form, setForm] = useState<RoutineForm | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function post(routine: RoutineForm): Promise<boolean> {
    setError("");
    const res = await fetch(`/api/agents/${encodeURIComponent(slug)}/routines`, {
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
      `/api/agents/${encodeURIComponent(slug)}/routines/${encodeURIComponent(id)}/run`,
      { method: "POST" }
    );
    const body = await res.json();
    setBusyId("");
    if (body.error) setError(body.error);
    else if (body.chatId) navigate(`/agents/${encodeURIComponent(slug)}/chat/${body.chatId}`);
  }

  async function remove(id: string) {
    if (!window.confirm(`Delete the scheduled prompt "${id}"?`)) return;
    await fetch(`/api/agents/${encodeURIComponent(slug)}/routines/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  return (
    <Panel
      title="schedule — prompts that run on their own"
      actions={
        !form && (
          <Button size="sm" icon="add" onClick={() => setForm({ name: "", schedule: "0 9 * * 1-5", prompt: "", enabled: true })}>
            schedule a prompt
          </Button>
        )
      }
    >
      {routines.length === 0 && !form && (
        <Hint className="px-[18px] py-3 text-xs">
          none — a routine messages this agent on a schedule (cron, server local time) and each run
          opens a new session with the result.
        </Hint>
      )}
      {routines.length > 0 && (
        <PanelRows>
          {routines.map((r) => (
            <PanelRow
              key={r.id}
              icon="schedule"
              title={
                <>
                  {r.name}
                  {r.lastError && (
                    <span title={r.lastError}>
                      <Tag tone="bad">error</Tag>
                    </span>
                  )}
                  {r.awaitingApproval && r.lastChatId && (
                    <Tag
                      href={`/agents/${encodeURIComponent(slug)}/chat/${r.lastChatId}`}
                      tone="bad"
                      title="the last run asked for a permission nobody has answered yet"
                    >
                      needs approval
                    </Tag>
                  )}
                </>
              }
              action={
                <>
                  <Button size="sm" icon="play_arrow" busy={busyId === r.id} onClick={() => runNow(r.id)}>
                    {busyId === r.id ? "starting…" : "run"}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
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
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void remove(r.id)}>
                    delete
                  </Button>
                  <Switch checked={r.enabled} label={r.enabled ? "enabled — click to pause" : "paused — click to enable"} onChange={() =>
                      void post({
                        id: r.id,
                        name: r.name,
                        schedule: r.schedule,
                        prompt: r.prompt,
                        enabled: !r.enabled,
                      })
                    } />
                </>
              }
            >
              <span className={SUB}>
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
            </PanelRow>
          ))}
        </PanelRows>
      )}
      {form && (
        <FormStack className="max-w-[680px]">
          <FieldRow>
            <Field label="name" className="flex-1">
              <TextField value={form.name} placeholder="e.g. Morning report" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="schedule (cron)" className="w-[200px] max-[900px]:w-auto">
              <TextField className="font-mono" value={form.schedule} placeholder="0 9 * * 1-5" onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
            </Field>
            <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-fg">
              <input type="checkbox" className="accent-accent" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              enabled
            </label>
          </FieldRow>
          <Field label="prompt — what to ask this agent on each run">
            <TextArea rows={5} value={form.prompt} placeholder="Check ... and summarize what changed." onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          </Field>
          <div className="flex items-center gap-2.5">
            <Button
              variant="primary"
              disabled={!form.name.trim() || !form.prompt.trim()}
              onClick={async () => {
                if (await post(form)) setForm(null);
              }}
            >
              {form.id ? "save" : "add to the schedule"}
            </Button>
            <Button variant="quiet" onClick={() => (setForm(null), setError(""))}>
              cancel
            </Button>
          </div>
        </FormStack>
      )}
      {error && (
        <div className="px-[18px] pb-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Panel>
  );
}

/* ---------- editor ---------- */

export function AgentEditor({ slug }: { slug?: string }) {
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
    vibeables: string[];
    skillsAll: boolean;
    skills: string[];
  } | null>(slug ? null : defaults());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const wfData = usePoll<{ workflows: WorkflowSummary[] }>("/api/workflows", false);
  const available = wfData?.workflows ?? [];
  const kData = usePoll<KnowledgeIndex>("/api/knowledge", false);
  const bundles = kData?.bundles ?? [];
  const features = useFeatures();
  const vData = usePoll<VibeablesView>(features.vibeables ? "/api/vibeables" : "", false);
  const vibeables = vData?.vibeables ?? [];
  const sData = usePoll<{ skills: SkillInfo[] }>("/api/skills", false);
  const allSkills = sData?.skills ?? [];

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/agents/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m: AgentDetail) =>
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
          vibeables: m.vibeables ?? [],
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
      vibeables: [] as string[],
      skillsAll: true,
      skills: [] as string[],
    };
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    const res = await fetch(slug ? `/api/agents/${encodeURIComponent(slug)}` : "/api/agents", {
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
    if (!slug || !window.confirm(`Move agent "${slug}" to the trash?`)) return;
    await fetch(`/api/agents/${encodeURIComponent(slug)}`, { method: "DELETE" }).catch(() => {});
    navigate("/agents");
  }

  if (!form) return <EmptyState>{error || "loading…"}</EmptyState>;
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  // Connect or disconnect one item of a list field.
  const toggleIn = (key: "workflows" | "knowledge" | "vibeables" | "skills", name: string, on: boolean) =>
    set({ [key]: on ? [...form[key], name] : form[key].filter((n) => n !== name) });

  return (
    <Page width="narrow">
      <Title>{slug ? `edit ${slug}` : "new agent"}</Title>
      <Panel>
        <FormStack className="max-w-[680px]">
          <FieldRow>
            <Field label="name" className="flex-1">
              <TextField value={form.name} placeholder="e.g. Max" onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="emoji" className="w-[90px] max-[900px]:w-auto">
              <TextField value={form.emoji} onChange={(e) => set({ emoji: e.target.value })} />
            </Field>
          </FieldRow>
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_PRESETS.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={form.emoji === e}
                className={cn(
                  "cursor-pointer rounded-xl border px-2.5 py-1.5 text-base transition-colors",
                  form.emoji === e ? "border-transparent bg-accent-soft" : "border-line bg-transparent hover:bg-surface-2"
                )}
                onClick={() => set({ emoji: e })}
              >
                {e}
              </button>
            ))}
          </div>
          <FieldRow>
            <Field label="description" className="flex-1">
              <TextField value={form.description} placeholder="one line: what this agent is for" onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <Field label="group" className="w-[180px] max-[900px]:w-auto">
              <TextField value={form.group} placeholder="none" onChange={(e) => set({ group: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="harness" className="w-[140px] max-[900px]:w-auto">
              <Select value={form.harness} onChange={(e) => set({ harness: e.target.value })}>
                <option value="claude">claude</option>
                <option value="codex">codex</option>
                <option value="pi">pi</option>
              </Select>
            </Field>
            <Field label="model" className="flex-1">
              <TextField className="font-mono" value={form.model} placeholder="harness default — e.g. sonnet, gpt-5.6-sol" onChange={(e) => set({ model: e.target.value })} />
            </Field>
            <Field label="effort" className="w-[140px] max-[900px]:w-auto">
              <Select value={form.effort} onChange={(e) => set({ effort: e.target.value })}>
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>
                    {ef || "default"}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <Field label="system prompt — the agent's role">
            <TextArea
              className={CODE_AREA}
              rows={10}
              value={form.system}
              placeholder={"You are the ... for this project. Your job is ..."}
              onChange={(e) => set({ system: e.target.value })}
            />
          </Field>
          <ConnectField label="connected workflows — autoloaded into the agent's context; it can run them">
            {available.map((w) => (
              <Checkbox key={w.slug} checked={form.workflows.includes(w.slug)} onChange={(on) => toggleIn("workflows", w.slug, on)} hint={w.description} mono>{w.slug}</Checkbox>
            ))}
            {available.length === 0 && <Hint className="py-1.5 px-0">no workflows in this project</Hint>}
          </ConnectField>
          <ConnectField label="connected knowledge — OKF bundles the agent consults and maintains">
            {bundles.map((b) => (
              <Checkbox key={b.name} checked={form.knowledge.includes(b.name)} onChange={(on) => toggleIn("knowledge", b.name, on)} hint={`${b.concepts} concepts`} mono>{b.name}</Checkbox>
            ))}
            {bundles.length === 0 && <Hint className="py-1.5 px-0">no knowledge bundles in this project</Hint>}
          </ConnectField>
          {(features.vibeables || form.vibeables.length > 0) && (
            <ConnectField label="apps — small apps the agent builds and maintains" linkKind="vibeables">
              {vibeables.map((v) => (
                <Checkbox key={v.slug} checked={form.vibeables.includes(v.slug)} onChange={(on) => toggleIn("vibeables", v.slug, on)} hint={v.dev ? "dev" : "static"} mono>{v.slug}</Checkbox>
              ))}
              {form.vibeables
                .filter((slug) => !vibeables.some((v) => v.slug === slug))
                .map((slug) => (
                  <Checkbox key={slug} checked onChange={() => toggleIn("vibeables", slug, false)} hint="not found in this workspace" mono>{slug}</Checkbox>
                ))}
              {!features.vibeables && <Hint className="py-1.5 px-0">vibeables are off in this workspace's settings</Hint>}
              {features.vibeables && vibeables.length === 0 && <Hint className="py-1.5 px-0">no vibeables in this workspace yet</Hint>}
            </ConnectField>
          )}
          <ConnectField label="connected skills — workspace skill packages (see the skills tab); invoked with /name in sessions">
            <Checkbox checked={form.skillsAll} onChange={(on) => set({ skillsAll: on })} hint="every discovered skill, including future ones" mono>all skills</Checkbox>
            {!form.skillsAll &&
              allSkills.map((s) => (
                <Checkbox key={s.name} checked={form.skills.includes(s.name)} onChange={(on) => toggleIn("skills", s.name, on)} hint={s.description} mono>{`/${s.name}`}</Checkbox>
              ))}
            {!form.skillsAll && allSkills.length === 0 && <Hint className="py-1.5 px-0">no skills found (.claude/skills, project or user)</Hint>}
          </ConnectField>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex items-center gap-2.5">
            <Button variant="primary" busy={saving} disabled={!form.name.trim()} onClick={save}>
              {saving ? "saving…" : slug ? "save" : "create"}
            </Button>
            <span className="flex-1" />
            {slug && (
              <Button variant="danger" icon="delete" onClick={remove}>
                delete agent
              </Button>
            )}
          </div>
        </FormStack>
      </Panel>
    </Page>
  );
}

/** A labelled checklist in the editor: what the agent is connected to. */
function ConnectField({ label, linkKind, children }: { label: string; linkKind?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5" data-link-kind={linkKind}>
      <span className="text-sm font-semibold text-fg">{label}</span>
      <Checks>{children}</Checks>
    </div>
  );
}
