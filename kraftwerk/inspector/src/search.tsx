import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSummary, AgentSearch, ChannelSummary, WorkspaceAgents } from "./types";
import { Icon, navigate, startWorkspace } from "./shared";

/**
 * ⌘K palette: jump to any agent or channel in any workspace this machine
 * knows. The server gathers the lists (/api/search/agents); this only
 * filters and navigates. Hits are grouped by workspace, this one first. A
 * hit of this workspace opens in place, one of another workspace loads that
 * workspace's UI at the hit's URL — starting the workspace first when it is
 * not running.
 */

type Hit = { ws: WorkspaceAgents; key: string } & ({ kind: "agent"; agent: AgentSummary } | { kind: "channel"; channel: ChannelSummary });

const MAX_SHOWN = 40;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** The last answer, so reopening the palette shows results before the refresh lands. */
let cached: AgentSearch | null = null;

const flatten = (data: AgentSearch | null): Hit[] =>
  (data?.workspaces ?? []).flatMap((ws) => [
    ...ws.agents.map((agent): Hit => ({ kind: "agent", agent, ws, key: `${ws.url}|agent|${agent.slug}` })),
    ...(ws.channels ?? []).map((channel): Hit => ({ kind: "channel", channel, ws, key: `${ws.url}|channel|${channel.slug}` })),
  ]);

const nameOf = (hit: Hit): string => (hit.kind === "agent" ? hit.agent.name : hit.channel.name);
const subOf = (hit: Hit): string | undefined => (hit.kind === "agent" ? hit.agent.description : hit.channel.purpose);
const hrefOf = (hit: Hit): string =>
  hit.kind === "agent" ? `/agents/${encodeURIComponent(hit.agent.slug)}` : `/channels/${encodeURIComponent(hit.channel.slug)}`;

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
    const own = hit.kind === "agent" ? [hit.agent.slug, hit.agent.description ?? "", hit.agent.group ?? "", "agent"] : [hit.channel.slug, hit.channel.purpose ?? "", "channel"];
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
      <button type="button" className="search-btn" onClick={() => setOpen(true)} title="jump to an agent or channel" aria-label="search">
        <Icon name="search" />
        <kbd className="kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
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

  let body: React.ReactNode;
  if (hits.length > 0) {
    let i = -1;
    body = (
      <ul className="palette-list" role="listbox" aria-label="agents and channels" ref={listRef}>
        {groups.map((g) => (
          <Fragment key={g.ws.url || g.ws.name}>
            <li className="palette-group" role="presentation" title={g.ws.current ? "this workspace" : g.ws.url}>
              {g.ws.icon && <span aria-hidden>{g.ws.icon}</span>}
              <span className="palette-group-name">{g.ws.name}</span>
              {g.ws.current ? (
                <span className="palette-group-note">this workspace</span>
              ) : !g.ws.live ? (
                <span className="palette-chip">stopped</span>
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
                  className={`palette-item${idx === current ? " active" : ""}`}
                  onMouseMove={() => idx !== current && setActive(idx)}
                  onClick={() => open(hit)}
                >
                  <span className="palette-emoji" aria-hidden>
                    {hit.kind === "agent" ? hit.agent.emoji : <Icon name="forum" />}
                  </span>
                  <span className="palette-text">
                    <span className="palette-name">{nameOf(hit)}</span>
                    {subOf(hit) && <span className="palette-sub">{subOf(hit)}</span>}
                  </span>
                  {starting === hit.key ? (
                    <Icon name="progress_activity" className="ms-sm" />
                  ) : (
                    hit.kind === "channel" && <span className="palette-chip">channel</span>
                  )}
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
    );
  } else if (failed) body = <div className="palette-empty">could not load the agents and channels</div>;
  else if (loading) body = <div className="palette-empty">looking for agents and channels…</div>;
  else if (all.length === 0) {
    body = (
      <div className="palette-empty">
        no agents yet — <a href="#/agents/new" onClick={onClose}>create one</a>
      </div>
    );
  } else body = <div className="palette-empty">no agent or channel matches “{query}”</div>;

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="jump to an agent or channel" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="jump to an agent or channel…"
            aria-label="search"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && data && <Icon name="progress_activity" className="ms-sm" />}
          <kbd className="kbd">esc</kbd>
        </div>
        {body}
        <div className="palette-foot">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> move</span>
          <span><kbd className="kbd">↵</kbd> open</span>
          {starting && <span className="palette-note"><Icon name="progress_activity" className="ms-sm" /> starting the workspace…</span>}
          {startError && <span className="palette-warn" title={startError}><Icon name="warning" className="ms-sm" /> {startError}</span>}
        </div>
      </div>
    </div>
  );
}
