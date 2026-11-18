import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSummary, AgentSearch, ChannelSummary, DeckHit, EntityHit, ProjectHit, TaskHit, WorkspaceAgents } from "./types";
import { api, useApi } from "./api";
import { chatHref } from "./dashboard";
import { OpenHere } from "./chat-card";
import { QuickChat, QuickTask } from "./new-thing";
import { RunForm } from "./run-launcher";
import { WORKSPACE_ROUTINES } from "./routines";
import { Icon, navigate, startWorkspace, useFeatures, workspaceHref } from "./shared";
import { SkillRun } from "./skills";
import { cn, Kbd } from "./ui";

/**
 * ⌘K palette: jump to any agent, project or channel in any workspace this
 * machine knows. The server gathers the lists (/api/search/agents); this only
 * filters and navigates. Hits are grouped by workspace, this one first. A
 * hit of this workspace opens in place, one of another workspace loads that
 * workspace's UI at the hit's URL — starting the workspace first when it is
 * not running.
 */

type Hit = { ws: WorkspaceAgents; key: string } & (
  | { kind: "agent"; agent: AgentSummary }
  | { kind: "project"; project: ProjectHit }
  | { kind: "channel"; channel: ChannelSummary }
  | { kind: "entity"; entity: EntityHit }
  | { kind: "task"; task: TaskHit }
  | { kind: "deck"; deck: DeckHit }
  | { kind: "thing"; thing: Thing }
);

/**
 * What only this workspace has and the palette reads itself: its skills,
 * workflows, routines, knowledge, apps and chats, the pages under Settings,
 * and the commands. One with `act` can be done right here, in a chat window
 * inside the palette: use a skill, run a workflow, start a chat, add a task.
 */
interface Thing {
  type: "skill" | "workflow" | "routine" | "knowledge" | "app" | "chat" | "page" | "command";
  id: string;
  name: string;
  sub?: string;
  icon: string;
  href: string;
  /** More to match on. */
  words?: string;
  act?: { kind: "skill" | "workflow" | "chat" | "task"; label: string; usesRequest?: boolean };
  /** Its shortcut, shown on the row. */
  keys?: string;
}

const MAX_SHOWN = 40;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** The last answer, so reopening the palette shows results before the refresh lands. */
let cached: AgentSearch | null = null;

const flatten = (data: AgentSearch | null): Hit[] =>
  (data?.workspaces ?? []).flatMap((ws) => [
    ...ws.agents.map((agent): Hit => ({ kind: "agent", agent, ws, key: `${ws.url}|agent|${agent.slug}` })),
    ...(ws.projects ?? []).map((project): Hit => ({ kind: "project", project, ws, key: `${ws.url}|project|${project.slug}` })),
    ...(ws.channels ?? []).map((channel): Hit => ({ kind: "channel", channel, ws, key: `${ws.url}|channel|${channel.slug}` })),
    ...(ws.entities ?? []).map((entity): Hit => ({ kind: "entity", entity, ws, key: `${ws.url}|${entity.kind}|${entity.slug}` })),
    // Tasks are this workspace's only: the registry carries none for the others.
    ...(ws.current ? (ws.tasks ?? []) : []).map((task): Hit => ({ kind: "task", task, ws, key: `${ws.url}|task|${task.project ?? ""}|${task.board}|${task.slug}` })),
    ...(ws.current ? (ws.decks ?? []) : []).map((deck): Hit => ({ kind: "deck", deck, ws, key: `${ws.url}|deck|${deck.project ?? ""}|${deck.name}` })),
  ]);

const nameOf = (hit: Hit): string =>
  hit.kind === "thing" ? hit.thing.name : hit.kind === "agent" ? hit.agent.name : hit.kind === "project" ? hit.project.title : hit.kind === "entity" ? hit.entity.title : hit.kind === "task" ? hit.task.title : hit.kind === "deck" ? hit.deck.title : hit.channel.name;
const subOf = (hit: Hit): string | undefined =>
  hit.kind === "thing"
    ? hit.thing.sub
    : hit.kind === "agent"
    ? hit.agent.description
    : hit.kind === "project"
      ? hit.project.goal || (hit.project.status !== "active" ? hit.project.status : undefined)
      : hit.kind === "entity"
        ? hit.entity.detail
        : hit.kind === "task"
          ? `${hit.task.project ? `${hit.task.project} · ` : ""}${hit.task.board} · ${hit.task.status}`
          : hit.kind === "deck"
            ? `${hit.deck.project ? `${hit.deck.project} · ` : ""}${hit.deck.slides} ${hit.deck.slides === 1 ? "slide" : "slides"}`
            : hit.channel.purpose;
const hrefOf = (hit: Hit): string =>
  hit.kind === "thing"
    ? hit.thing.href
    : hit.kind === "agent"
    ? `/agents/${encodeURIComponent(hit.agent.slug)}`
    : hit.kind === "project"
      ? `/projects/${encodeURIComponent(hit.project.slug)}`
      : hit.kind === "entity"
        ? `/${hit.entity.kind}/${encodeURIComponent(hit.entity.slug)}`
        : hit.kind === "task"
          ? hit.task.href
          : hit.kind === "deck"
            ? hit.deck.href
            : `/channels/${encodeURIComponent(hit.channel.slug)}`;
/** The singular of a hit's kind, for the tag beside its name: contact, place, event. */
const ENTITY_WORD: Record<EntityHit["kind"], string> = { contacts: "contact", places: "place", events: "event" };
const ENTITY_ICON: Record<EntityHit["kind"], string> = { contacts: "person", places: "location_on", events: "event" };
/** The same marks the rail uses for a project's status. */
const PROJECT_MARK: Record<ProjectHit["status"], string> = { active: "📁", paused: "⏸️", done: "✅", archived: "🗄️" };
const emojiOf = (hit: Hit): React.ReactNode =>
  hit.kind === "agent" ? (
    hit.agent.emoji
  ) : hit.kind === "thing" ? (
    <Icon name={hit.thing.icon} className="text-[18px] text-fg-2" />
  ) : hit.kind === "project" ? (
    PROJECT_MARK[hit.project.status]
  ) : hit.kind === "entity" ? (
    <Icon name={ENTITY_ICON[hit.entity.kind]} className="text-[18px] text-fg-2" />
  ) : hit.kind === "task" ? (
    <Icon name="task" className="text-[18px] text-fg-2" />
  ) : hit.kind === "deck" ? (
    <Icon name="slideshow" className="text-[18px] text-fg-2" />
  ) : (
    <Icon name="forum" className="text-[18px] text-fg-2" />
  );

/** "channel", "project", "stopped": what a hit or a workspace is, beside its name. */
const PALETTE_TAG = "flex-none rounded-full border border-line px-1.5 py-px text-[10px] font-semibold tracking-[0.4px] uppercase";

/**
 * Every whitespace-separated token has to occur somewhere in the hit's
 * name, slug, description, group, kind or workspace name. Within a
 * workspace hits are ranked by where the first token lands (name prefix,
 * then name, then the rest); the workspace order is the server's, this
 * workspace first.
 */
function filter(hits: Hit[], query: string): Hit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return hits;
  const scored: { hit: Hit; score: number; ws: number }[] = [];
  const order = new Map<WorkspaceAgents, number>();
  for (const hit of hits) {
    if (!order.has(hit.ws)) order.set(hit.ws, order.size);
    const name = nameOf(hit).toLowerCase();
    const own =
      hit.kind === "thing"
        ? [hit.thing.id, hit.thing.sub ?? "", hit.thing.type, hit.thing.words ?? ""]
        : hit.kind === "agent"
        ? [hit.agent.slug, hit.agent.description ?? "", hit.agent.group ?? "", "agent"]
        : hit.kind === "project"
          ? [hit.project.slug, hit.project.goal ?? "", hit.project.status, "project"]
          : hit.kind === "entity"
            ? [hit.entity.slug, hit.entity.detail ?? "", ENTITY_WORD[hit.entity.kind], `${ENTITY_WORD[hit.entity.kind]}:${hit.entity.slug}`]
            : hit.kind === "task"
              ? [hit.task.slug, `task:${hit.task.slug}`, hit.task.board, hit.task.project ?? "", hit.task.status, "task"]
              : hit.kind === "deck"
                ? [hit.deck.name, `presentation:${hit.deck.name}`, hit.deck.project ?? "", "presentation", "deck"]
                : [hit.channel.slug, hit.channel.purpose ?? "", "channel"];
    const hay = [name, ...own, hit.ws.name].join(" ").toLowerCase();
    if (!tokens.every((t) => hay.includes(t))) continue;
    const score = name.startsWith(tokens[0]) ? 0 : name.includes(tokens[0]) ? 1 : 2;
    scored.push({ hit, score, ws: order.get(hit.ws)! });
  }
  return scored.sort((a, b) => a.ws - b.ws || a.score - b.score).map((s) => s.hit);
}

/** The shown hits in workspace groups, in order of first appearance. */
function group(hits: Hit[]): { ws: WorkspaceAgents; hits: Hit[] }[] {
  const groups: { ws: WorkspaceAgents; hits: Hit[] }[] = [];
  for (const hit of hits) {
    const g = groups.find((x) => x.ws === hit.ws);
    if (g) g.hits.push(hit);
    else groups.push({ ws: hit.ws, hits: [hit] });
  }
  return groups;
}

async function openHit(hit: Hit): Promise<void> {
  const target = hrefOf(hit);
  if (hit.ws.current) return navigate(target);
  const url = hit.ws.live || !hit.ws.root ? workspaceHref(hit.ws) : await startWorkspace(hit.ws.root);
  window.location.assign(`${url.replace(/\/+$/, "")}/#${target}`);
}

const CMD_CHAT: Thing = { type: "command", id: "New chat", name: "New chat", href: "/agents/chats", icon: "chat", words: "start session message ask", keys: "⌥C", act: { kind: "chat", label: "chat" } };
const CMD_TASK: Thing = { type: "command", id: "New task", name: "New task", href: "/boards", icon: "task_alt", words: "add todo create", keys: "⌥T", act: { kind: "task", label: "add" } };

export function SearchPalette() {
  const [open, setOpen] = useState<boolean | Thing>(false);
  const features = useFeatures();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      // ⌥C: a new chat, ⌥T: a new task — from anywhere but a field being typed in (where ⌥ makes letters).
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.code !== "KeyC" && e.code !== "KeyT")) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.code === "KeyT" && !features.boards) return;
      e.preventDefault();
      setOpen(e.code === "KeyC" ? CMD_CHAT : CMD_TASK);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [features.boards]);
  return (
    <>
      <button
        type="button"
        className="inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-xl border-0 bg-transparent py-1 pr-2 pl-1.5 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg active:scale-96"
        onClick={() => setOpen(true)}
        title="jump to anything, or do something (⌥C new chat, ⌥T new task)"
        aria-label="search"
      >
        <Icon name="search" />
        <Kbd className="max-[1100px]:hidden">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
      </button>
      {open && <Palette start={open === true ? undefined : open} onClose={() => setOpen(false)} />}
    </>
  );
}

function Palette({ onClose, start }: { onClose: () => void; start?: Thing }) {
  const [data, setData] = useState<AgentSearch | null>(cached);
  const [loading, setLoading] = useState(cached === null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .call("search.agents")
      .then((d) => {
        cached = d;
        if (alive) setData(d);
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const things = useThings();
  const [acting, setActing] = useState<Thing | null>(start ?? null);
  const all = useMemo(() => {
    const flat = flatten(data);
    const ws = data?.workspaces.find((w) => w.current);
    if (!ws) return flat;
    const own = things.map((thing): Hit => ({ kind: "thing", thing, ws, key: `${ws.url}|${thing.type}|${thing.id}` }));
    // The commands lead this workspace's hits, the rest of what it has follows its agents, projects and tasks.
    const at = flat.findIndex((h) => h.ws === ws);
    const end = flat.reduce((n, h, i) => (h.ws === ws ? i + 1 : n), 0);
    const cmds = own.filter((h) => h.kind === "thing" && h.thing.type === "command");
    const rest = own.filter((h) => !cmds.includes(h));
    return at < 0 ? [...own, ...flat] : [...flat.slice(0, at), ...cmds, ...flat.slice(at, end), ...rest, ...flat.slice(end)];
  }, [data, things]);
  const hits = useMemo(() => filter(all, query).slice(0, MAX_SHOWN), [all, query]);
  const groups = useMemo(() => group(hits), [hits]);
  const current = Math.min(active, Math.max(hits.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, hits]);

  const actOf = (hit?: Hit) => (hit?.kind === "thing" ? hit.thing.act : undefined);
  const open = (hit: Hit) => {
    if (starting) return;
    // A command is done here; a skill or a workflow opens, and Tab (or its button) uses it here.
    if (hit.kind === "thing" && hit.thing.type === "command" && hit.thing.act) return setActing(hit.thing);
    if (hit.ws.current || hit.ws.live) {
      onClose();
      void openHit(hit);
      return;
    }
    // A stopped workspace: keep the palette up while it starts.
    setStarting(hit.key);
    setStartError("");
    openHit(hit).catch((err: Error) => {
      setStarting(null);
      setStartError(`${hit.ws.name}: ${err.message}`);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (acting) {
      // The chat window has the keys; Escape goes back to the list.
      if (e.key === "Escape") {
        e.preventDefault();
        setActing(null);
      }
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && actOf(hits[current])) {
      e.preventDefault();
      setActing((hits[current] as Hit & { kind: "thing" }).thing);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(hits.length ? (current + 1) % hits.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(hits.length ? (current - 1 + hits.length) % hits.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[current];
      if (hit) open(hit);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const empty = "px-4 py-7 text-center text-sm text-fg-2 [&_a]:underline";
  let body: React.ReactNode;
  if (hits.length > 0) {
    let i = -1;
    body = (
      <ul className="m-0 list-none overflow-y-auto overscroll-contain p-1.5" role="listbox" aria-label="agents, projects and channels" ref={listRef}>
        {groups.map((g) => (
          <Fragment key={g.ws.url || g.ws.name}>
            {/* palette-group: the tests count the workspace groups by it. */}
            <li
              className="palette-group flex items-center gap-1.5 px-2.5 pt-3 pb-1 text-2xs font-semibold tracking-[0.4px] text-fg-2 uppercase first:pt-1.5"
              role="presentation"
              title={g.ws.current ? "this workspace" : g.ws.url}
            >
              {g.ws.icon && <span aria-hidden>{g.ws.icon}</span>}
              <span className="truncate">{g.ws.name}</span>
              {g.ws.current ? (
                <span className="font-normal tracking-normal normal-case">this workspace</span>
              ) : !g.ws.live ? (
                <span className={PALETTE_TAG}>stopped</span>
              ) : (
                <Icon name="open_in_new" className="ms-sm" />
              )}
            </li>
            {g.hits.map((hit) => {
              const idx = ++i;
              return (
                <li
                  key={hit.key}
                  role="option"
                  aria-selected={idx === current}
                  className={cn("flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2", idx === current && "bg-surface-2")}
                  onMouseMove={() => idx !== current && setActive(idx)}
                  onClick={() => open(hit)}
                >
                  <span className="w-6 flex-none text-center text-[18px] leading-none" aria-hidden>
                    {emojiOf(hit)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13.5px] font-medium text-fg">{nameOf(hit)}</span>
                    {subOf(hit) && <span className="truncate text-xs text-fg-2">{subOf(hit)}</span>}
                  </span>
                  {hit.kind === "thing" && hit.thing.act && hit.thing.type !== "command" && (
                    <button
                      type="button"
                      className="palette-act inline-flex flex-none cursor-pointer items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-fg hover:bg-accent-soft hover:text-on-accent-soft"
                      title={`${hit.thing.act.label} here (Tab)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActing(hit.thing);
                      }}
                    >
                      {hit.thing.act.label}
                    </button>
                  )}
                  {starting === hit.key ? (
                    <Icon name="progress_activity" className="ms-sm" />
                  ) : hit.kind === "thing" && hit.thing.keys ? (
                    <Kbd>{hit.thing.keys}</Kbd>
                  ) : hit.kind === "thing" ? (
                    <span className={cn(PALETTE_TAG, "text-fg-2")}>{hit.thing.type}</span>
                  ) : (
                    hit.kind !== "agent" && <span className={cn(PALETTE_TAG, "text-fg-2")}>{hit.kind === "entity" ? ENTITY_WORD[hit.entity.kind] : hit.kind === "deck" ? "presentation" : hit.kind}</span>
                  )}
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
    );
  } else if (failed) body = <div className={empty}>could not load the agents, projects and channels</div>;
  else if (loading) body = <div className={empty}>looking for agents, projects and channels…</div>;
  else if (all.length === 0) {
    body = (
      <div className={empty}>
        no agents yet — <a href="#/agents/new" onClick={onClose}>create one</a>
      </div>
    );
  } else body = <div className={empty}>no agent, project or channel matches “{query}”</div>;

  return (
    // palette-backdrop: the edit modal leaves Escape to the palette while it is up (edit-modal.tsx).
    <div className="palette-backdrop fixed inset-0 z-50 flex animate-fade items-start justify-center bg-black/35 px-4 pt-[12vh] pb-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[min(70dvh,560px)] w-[min(620px,100%)] animate-modal flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-modal"
        role="dialog"
        aria-label="jump to an agent, project or channel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3 text-fg-2">
          <Icon name="search" />
          <input
            autoFocus
            className="min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-[16px] text-fg outline-none"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="jump to anything, or do something: new chat, new task, a skill, a workflow…"
            disabled={!!acting}
            aria-label="search"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && data && <Icon name="progress_activity" className="ms-sm" />}
          <Kbd>esc</Kbd>
        </div>
        {acting ? (
          // Whatever is started here opens at its route: the palette steps aside first.
          <OpenHere.Provider
            value={() => {
              onClose();
              return false;
            }}
          >
            <div className="palette-action flex flex-col gap-2 overflow-y-auto p-3">
              <button type="button" className="inline-flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-xs text-fg-2 hover:text-fg" onClick={() => setActing(null)}>
                <Icon name="arrow_back" className="ms-sm" /> back to the list
              </button>
              {acting.act?.kind === "skill" && <SkillRun name={acting.id} />}
              {acting.act?.kind === "workflow" && <RunForm slug={acting.id} usesRequest={acting.act.usesRequest !== false} />}
              {acting.act?.kind === "chat" && <QuickChat />}
              {acting.act?.kind === "task" && <QuickTask />}
            </div>
          </OpenHere.Provider>
        ) : (
          body
        )}
        <div className="flex items-center gap-3.5 border-t border-line px-3.5 py-2 text-2xs text-fg-2 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span><Kbd>↵</Kbd> {acting ? "send" : "open"}</span>
          {!acting && actOf(hits[current]) && hits[current].kind === "thing" && hits[current].thing.type !== "command" && <span><Kbd>⇥</Kbd> {actOf(hits[current])!.label} here</span>}
          {acting && <span><Kbd>esc</Kbd> back</span>}
          {starting && <span className="ml-auto"><Icon name="progress_activity" className="ms-sm" /> starting the workspace…</span>}
          {startError && <span className="ml-auto max-w-[60%] truncate text-bad" title={startError}><Icon name="warning" className="ms-sm" /> {startError}</span>}
        </div>
      </div>
    </div>
  );
}

const enc = encodeURIComponent;

/** This workspace's own things, read while the palette is open. */
function useThings(): Thing[] {
  const features = useFeatures();
  const skills = useApi("skills.list", {});
  const wfs = useApi("workflows.list", {});
  const routines = useApi("routines.list", {});
  const know = useApi("knowledge.list", {});
  const vibes = useApi("vibeables.list", features.vibeables ? {} : null);
  const chats = useApi("chats.list", {});
  return useMemo(() => {
    const page = (name: string, href: string, icon: string, words = ""): Thing => ({ type: "page", id: href, name, href, icon, words: `settings overview ${words}` });
    const cmd = (name: string, href: string, icon: string, words: string, act?: Thing["act"]): Thing => ({ type: "command", id: name, name, href, icon, words, act });
    return [
      CMD_CHAT,
      ...(features.boards ? [CMD_TASK] : []),
      cmd("New routine", `/?kind=routines&open=${enc(`routines:${WORKSPACE_ROUTINES}:new`)}`, "schedule", "create schedule cron"),
      cmd("New agent", "/agents/new", "smart_toy", "create coworker"),
      ...(features.projects ? [cmd("New project", "/projects/new", "folder", "create")] : []),
      ...(features.boards ? [cmd("New board", "/boards/new", "view_kanban", "create kanban")] : []),
      cmd("New knowledge bundle", "/knowledge/new", "menu_book", "create wiki"),
      ...(skills?.skills ?? [])
        .filter((sk) => sk.source === "workspace" || sk.source === "project")
        .map((sk): Thing => ({ type: "skill", id: sk.name, name: `/${sk.name}`, sub: sk.description || undefined, icon: "extension", href: `/skills/${enc(sk.name)}`, act: { kind: "skill", label: "use" } })),
      ...(wfs?.workflows ?? []).map(
        (w): Thing => ({ type: "workflow", id: w.slug, name: w.name || w.slug, sub: w.description || undefined, icon: "account_tree", href: `/workflows/${enc(w.slug)}`, words: w.slug, act: w.error ? undefined : { kind: "workflow", label: "run", usesRequest: w.usesRequest } }),
      ),
      ...(routines?.routines ?? []).map(
        (r): Thing => ({ type: "routine", id: `${r.owner}:${r.id}`, name: r.name, sub: r.schedule, icon: "schedule", href: `/?kind=routines&open=${enc(`routines:${r.owner}:${r.id}`)}` }),
      ),
      ...(know?.bundles ?? []).map((b): Thing => ({ type: "knowledge", id: b.name, name: b.name, sub: `${b.concepts} pages`, icon: "menu_book", href: `/knowledge/${enc(b.name)}` })),
      ...(vibes?.vibeables ?? []).map((v): Thing => ({ type: "app", id: v.slug, name: v.slug, icon: "web", href: `/vibeables/${enc(v.slug)}` })),
      ...(chats?.chats ?? [])
        .filter((c) => c.title)
        .slice(0, 60)
        .map((c): Thing => ({ type: "chat", id: c.id, name: c.title!, icon: "chat", href: chatHref(c) })),
      page("Home", "/", "home", "everything stream"),
      page("Today", "/today", "today", "dashboard attention"),
      page("Settings", "/settings", "settings", "base"),
      page("All agents", "/settings/agents", "smart_toy", "admin"),
      page("All routines", "/settings/routines", "schedule", "admin"),
      page("All workflows", "/workflows", "account_tree"),
      page("All skills", "/skills", "extension"),
      page("All knowledge", "/knowledge", "menu_book"),
      page("Files", "/files", "folder_open"),
      ...(features.boards ? [page("All boards", "/boards", "view_kanban")] : []),
      ...(features.presentations ? [page("All presentations", "/presentations", "slideshow", "slides decks")] : []),
      ...(features.vibeables ? [page("All apps", "/vibeables", "web", "vibeables")] : []),
      ...(features.repos ? [page("Repositories", "/repos", "source", "repos")] : []),
      ...(features.git ? [page("Git", "/git", "commit", "sync changes commit")] : []),
      page("Trash", "/trash", "delete", "deleted restore"),
      page("Workspaces", "/workspaces", "workspaces"),
    ];
  }, [features, skills, wfs, routines, know, vibes, chats]);
}
