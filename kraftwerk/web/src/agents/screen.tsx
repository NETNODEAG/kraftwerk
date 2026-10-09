import { useEffect, useState } from "react";
import type { Agent } from "../types";
import { ChatThread, NewChat } from "../chat";
import { api, useApi } from "../api";
import { Icon, useExpertMode } from "../shared";
import { useSessionsList } from "../sessions";
import { Button, cn, EmptyState, Eyebrow, Hint, IconButton, ListRow, SideHead, SideList, TextField } from "../ui";
import { KnowledgeSide } from "./knowledge-side";
import { AgentLanding, NewAgentSession, GeneralChatsLanding, AgentSessions, GeneralSessions, AgentsLanding, AgentsHome } from "./landing";
import { AgentView } from "./profile";
import { AgentEditor } from "./editor";

/**
 * Agents: persistent agents ("employees"), each defined in
 * agents/<slug>/ (agent.yml + system.md). The screen is a double sidebar:
 * agents on the left, the selected agent's sessions next to it, and the
 * main pane shows the agent profile, a session thread, or the editor.
 * Sessions are ordinary chats with scope { kind: "agent", slug } — the
 * thread view is reused from the chat screen.
 */

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

  const data = useApi("agents.list", {});
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
      const full = await api.call("agents.get", { slug: memberSlug });
      await api.call("agents.save", { slug: memberSlug, body: { ...full, group: group || undefined } });
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
