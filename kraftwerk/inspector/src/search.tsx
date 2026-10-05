import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSummary, AgentSearch, ChannelSummary, ProjectHit, WorkspaceAgents } from "./types";
import { Icon, navigate, startWorkspace } from "./shared";
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
);

const MAX_SHOWN = 40;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** The last answer, so reopening the palette shows results before the refresh lands. */
let cached: AgentSearch | null = null;

const flatten = (data: AgentSearch | null): Hit[] =>
  (data?.workspaces ?? []).flatMap((ws) => [
    ...ws.agents.map((agent): Hit => ({ kind: "agent", agent, ws, key: `${ws.url}|agent|${agent.slug}` })),
    ...(ws.projects ?? []).map((project): Hit => ({ kind: "project", project, ws, key: `${ws.url}|project|${project.slug}` })),
    ...(ws.channels ?? []).map((channel): Hit => ({ kind: "channel", channel, ws, key: `${ws.url}|channel|${channel.slug}` })),
  ]);

const nameOf = (hit: Hit): string => (hit.kind === "agent" ? hit.agent.name : hit.kind === "project" ? hit.project.title : hit.channel.name);
const subOf = (hit: Hit): string | undefined =>
  hit.kind === "agent" ? hit.agent.description : hit.kind === "project" ? hit.project.goal || (hit.project.status !== "active" ? hit.project.status : undefined) : hit.channel.purpose;
const hrefOf = (hit: Hit): string =>
  hit.kind === "agent"
    ? `/agents/${encodeURIComponent(hit.agent.slug)}`
    : hit.kind === "project"
      ? `/projects/${encodeURIComponent(hit.project.slug)}`
      : `/channels/${encodeURIComponent(hit.channel.slug)}`;
/** The same marks the rail uses for a project's status. */
const PROJECT_MARK: Record<ProjectHit["status"], string> = { active: "📁", paused: "⏸️", done: "✅", archived: "🗄️" };
const emojiOf = (hit: Hit): React.ReactNode =>
  hit.kind === "agent" ? hit.agent.emoji : hit.kind === "project" ? PROJECT_MARK[hit.project.status] : <Icon name="forum" className="text-[18px] text-fg-2" />;

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
      hit.kind === "agent"
        ? [hit.agent.slug, hit.agent.description ?? "", hit.agent.group ?? "", "agent"]
        : hit.kind === "project"
          ? [hit.project.slug, hit.project.goal ?? "", hit.project.status, "project"]
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
  const url = hit.ws.live || !hit.ws.root ? hit.ws.url : await startWorkspace(hit.ws.root);
  window.location.assign(`${url.replace(/\/+$/, "")}/#${target}`);
}

export function SearchPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button
        type="button"
        className="inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-xl border-0 bg-transparent py-1 pr-2 pl-1.5 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg active:scale-96"
        onClick={() => setOpen(true)}
        title="jump to an agent, project or channel"
        aria-label="search"
      >
        <Icon name="search" />
        <Kbd className="max-[1100px]:hidden">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
      </button>
      {open && <Palette onClose={() => setOpen(false)} />}
    </>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
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
    fetch("/api/search/agents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: AgentSearch) => {
        cached = d;
        if (alive) setData(d);
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const all = useMemo(() => flatten(data), [data]);
  const hits = useMemo(() => filter(all, query).slice(0, MAX_SHOWN), [all, query]);
  const groups = useMemo(() => group(hits), [hits]);
  const current = Math.min(active, Math.max(hits.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, hits]);

  const open = (hit: Hit) => {
    if (starting) return;
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
    if (e.key === "ArrowDown") {
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
                  {starting === hit.key ? (
                    <Icon name="progress_activity" className="ms-sm" />
                  ) : (
                    hit.kind !== "agent" && <span className={cn(PALETTE_TAG, "text-fg-2")}>{hit.kind}</span>
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
            placeholder="jump to an agent, project or channel…"
            aria-label="search"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && data && <Icon name="progress_activity" className="ms-sm" />}
          <Kbd>esc</Kbd>
        </div>
        {body}
        <div className="flex items-center gap-3.5 border-t border-line px-3.5 py-2 text-2xs text-fg-2 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span><Kbd>↵</Kbd> open</span>
          {starting && <span className="ml-auto"><Icon name="progress_activity" className="ms-sm" /> starting the workspace…</span>}
          {startError && <span className="ml-auto max-w-[60%] truncate text-bad" title={startError}><Icon name="warning" className="ms-sm" /> {startError}</span>}
        </div>
      </div>
    </div>
  );
}
