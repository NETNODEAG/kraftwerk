import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentSummary, AgentSearch, WorkspaceAgents } from "./types";
import { Icon, navigate, startWorkspace } from "./shared";

/**
 * ⌘K palette: jump to any agent in any workspace this machine knows. The
 * server gathers the rosters (/api/search/agents); this only filters and
 * navigates. An agent of this workspace opens in place, one of another
 * workspace loads that workspace's UI at the agent's URL — starting the
 * workspace first when it is not running.
 */

interface Hit {
  agent: AgentSummary;
  ws: WorkspaceAgents;
  key: string;
}

const MAX_SHOWN = 40;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** The last answer, so reopening the palette shows results before the refresh lands. */
let cached: AgentSearch | null = null;

const flatten = (data: AgentSearch | null): Hit[] =>
  (data?.workspaces ?? []).flatMap((ws) => ws.agents.map((agent) => ({ agent, ws, key: `${ws.url}|${agent.slug}` })));

/**
 * Every whitespace-separated token has to occur somewhere in the agent's
 * name, slug, description, group or workspace name. Hits are ranked by
 * where the first token lands (name prefix, then name, then the rest),
 * current workspace first among equals.
 */
function filter(hits: Hit[], query: string): Hit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return hits;
  const scored: { hit: Hit; score: number }[] = [];
  for (const hit of hits) {
    const name = hit.agent.name.toLowerCase();
    const hay = [name, hit.agent.slug, hit.agent.description ?? "", hit.agent.group ?? "", hit.ws.name].join(" ").toLowerCase();
    if (!tokens.every((t) => hay.includes(t))) continue;
    const score = name.startsWith(tokens[0]) ? 0 : name.includes(tokens[0]) ? 1 : 2;
    scored.push({ hit, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.hit);
}

async function openHit(hit: Hit): Promise<void> {
  const target = `/agents/${encodeURIComponent(hit.agent.slug)}`;
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
      <button type="button" className="search-btn" onClick={() => setOpen(true)} title="jump to an agent" aria-label="search agents">
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
  const current = Math.min(active, Math.max(hits.length - 1, 0));

  useEffect(() => {
    const el = listRef.current?.children[current] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
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
    body = (
      <ul className="palette-list" role="listbox" aria-label="agents" ref={listRef}>
        {hits.map((hit, i) => (
          <li
            key={hit.key}
            role="option"
            aria-selected={i === current}
            className={`palette-item${i === current ? " active" : ""}`}
            onMouseMove={() => i !== current && setActive(i)}
            onClick={() => open(hit)}
          >
            <span className="palette-emoji" aria-hidden>{hit.agent.emoji}</span>
            <span className="palette-text">
              <span className="palette-name">{hit.agent.name}</span>
              {hit.agent.description && <span className="palette-sub">{hit.agent.description}</span>}
            </span>
            <span className="palette-ws" title={hit.ws.current ? "this workspace" : hit.ws.url}>
              {hit.ws.icon && <span aria-hidden>{hit.ws.icon}</span>}
              {hit.ws.name}
              {starting === hit.key ? (
                <Icon name="progress_activity" className="ms-sm" />
              ) : !hit.ws.live ? (
                <span className="palette-chip">stopped</span>
              ) : (
                !hit.ws.current && <Icon name="open_in_new" className="ms-sm" />
              )}
            </span>
          </li>
        ))}
      </ul>
    );
  } else if (failed) body = <div className="palette-empty">could not load the agents</div>;
  else if (loading) body = <div className="palette-empty">looking for agents…</div>;
  else if (all.length === 0) {
    body = (
      <div className="palette-empty">
        no agents yet — <a href="#/agents/new" onClick={onClose}>create one</a>
      </div>
    );
  } else body = <div className="palette-empty">no agent matches “{query}”</div>;

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="jump to an agent" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="jump to an agent…"
            aria-label="search agents"
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
