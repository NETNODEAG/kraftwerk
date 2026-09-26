import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ChatMeta } from "./types";
import { Icon, Link, navigate, usePoll, fmtWhen } from "./shared";

/**
 * The sessions of one conversation context (a project, an agent, Ralv):
 * the ones you have open are tabs above the chat, like a browser's; the
 * full list is a sidebar that stays hidden until asked for. Opening a
 * session (from the list, from the rail, by creating one) makes it a tab;
 * closing a tab only takes it off the strip — deleting is the list's job.
 * Open tabs are remembered per context in localStorage; the list toggle is
 * one setting for the whole inspector.
 */

export type Session = ChatMeta & { busy: boolean; awaitingApproval?: boolean };

const LIST_KEY = "kw-sessions-list";
let listOpen = (() => {
  try {
    return localStorage.getItem(LIST_KEY) === "open";
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();
export function setSessionsList(open: boolean): void {
  listOpen = open;
  try {
    localStorage.setItem(LIST_KEY, open ? "open" : "hidden");
  } catch {}
  listeners.forEach((fn) => fn());
}
/** Whether the sessions list is shown beside the chat (default: hidden). */
export function useSessionsList(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => listOpen
  );
}

const tabsKey = (store: string): string => `kw-tabs:${store}`;
const readTabs = (store: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(tabsKey(store)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const writeTabs = (store: string, ids: string[]): void => {
  try {
    localStorage.setItem(tabsKey(store), JSON.stringify(ids));
  } catch {}
};

export function SessionsPane({
  storeKey,
  label,
  fallbackTitle,
  chatId,
  filter,
  hrefOf,
  closeHref,
  subOf,
  actions,
}: {
  /** What the open tabs are remembered under ("project:slug", "agent:slug", "general"). */
  storeKey: string;
  /** The list's heading ("chats", "sessions"). */
  label: string;
  /** Title of a session that has none yet. */
  fallbackTitle: string;
  chatId?: string;
  /** Which of the workspace's chats belong here. */
  filter: (chats: Session[]) => Session[];
  hrefOf: (c: Session) => string;
  /** Where closing the last tab lands (the project page, the profile, the new-chat pane). */
  closeHref: string;
  /** Second line of a list row; the time is added. */
  subOf?: (c: Session) => React.ReactNode;
  /** The "new" button, placed right after the last tab like a browser's. */
  actions?: React.ReactNode;
}) {
  // The current chat rides in the URL so a freshly created one shows up on
  // arrival, not a poll interval later (usePoll refetches on a url change).
  const data = usePoll<{ chats: Session[] }>(`/api/chats?for=${encodeURIComponent(chatId ?? "")}`, false);
  const sessions = useMemo(() => filter(data?.chats ?? []), [data, filter]);
  const byId = useMemo(() => new Map(sessions.map((c) => [c.id, c])), [sessions]);
  const open = useSessionsList();
  const [tabs, setTabs] = useState<string[]>(() => readTabs(storeKey));
  const [deleting, setDeleting] = useState(false);

  const update = (next: string[]) => {
    setTabs(next);
    writeTabs(storeKey, next);
  };

  // Visiting a session opens its tab.
  useEffect(() => {
    if (chatId && !tabs.includes(chatId)) update([...tabs, chatId]);
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A session deleted elsewhere loses its tab once the list says so.
  useEffect(() => {
    if (!data) return;
    const kept = tabs.filter((id) => byId.has(id));
    if (kept.length !== tabs.length) update(kept);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Take a tab off the strip; when it is the current one, move to its neighbour. */
  const closeTab = (id: string) => {
    const at = tabs.indexOf(id);
    const next = tabs.filter((t) => t !== id);
    update(next);
    if (id !== chatId) return;
    const neighbour = byId.get(next[Math.min(Math.max(at, 0), next.length - 1)] ?? "");
    navigate(neighbour ? hrefOf(neighbour) : closeHref);
  };

  const remove = async (c: Session) => {
    if (!window.confirm(`Delete ${label === "chats" ? "chat" : "session"} "${c.title || c.id}"?`)) return;
    await fetch(`/api/chats/${c.id}`, { method: "DELETE" }).catch(() => {});
    if (tabs.includes(c.id)) closeTab(c.id);
  };

  const shown = data ? tabs.filter((id) => byId.has(id)) : [];
  const titleOf = (c: Session) => (c.scope.kind === "channel" ? c.title || `#${c.scope.slug}` : c.title || fallbackTitle);

  return (
    <>
      <nav className="session-tabs" aria-label="open sessions">
        <button
          type="button"
          className={`tab-toggle${open ? " on" : ""}`}
          onClick={() => setSessionsList(!open)}
          title={open ? `hide the ${label} list` : `show all ${label}`}
          aria-label={`${label} list`}
          aria-pressed={open}
        >
          <Icon name="view_list" className="ms-sm" />
          {data && <span className="num">{sessions.length}</span>}
        </button>
        <div className="session-tab-list" role="tablist">
          {shown.map((id) => {
            const c = byId.get(id)!;
            const active = id === chatId;
            return (
              <Link key={id} href={hrefOf(c)} className={`session-tab${active ? " active" : ""}`} role="tab" aria-selected={active} title={titleOf(c)}>
                {(c.busy || c.awaitingApproval) && (
                  <span className={`lamp ${c.awaitingApproval ? "blocked" : "running"}`} title={c.awaitingApproval ? "waiting for your approval" : "working"} />
                )}
                {c.scope.kind === "channel" && <Icon name="forum" className="ms-sm" />}
                <span className="session-tab-title">{titleOf(c)}</span>
                <button
                  type="button"
                  className="tab-x"
                  aria-label={`close ${titleOf(c)}`}
                  title="close tab"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeTab(id);
                  }}
                >
                  <Icon name="close" className="ms-sm" />
                </button>
              </Link>
            );
          })}
          {actions}
        </div>
      </nav>
      {open && (
        <aside className="runs-side sessions-side">
          <div className="side-head">
            <span className="microlabel">{label}</span>
            <span className="spacer" />
            <button type="button" className="side-back" onClick={() => setSessionsList(false)} title="hide the list" aria-label="hide the list">
              <Icon name="close" className="ms-sm" />
            </button>
          </div>
          <div className="side-list">
            {sessions.map((c) => (
              <Link key={c.id} href={hrefOf(c)} className={`side-row ${c.id === chatId ? "active" : ""}`}>
                <span className={`lamp ${c.awaitingApproval ? "blocked" : c.busy ? "running" : "pending"}`} title={c.awaitingApproval ? "waiting for your approval" : undefined} />
                <div className="side-row-body">
                  <div className="side-row-top">
                    <span className="side-wf">
                      {c.scope.kind === "channel" && <Icon name="forum" className="ms-sm" />}
                      {titleOf(c)}
                    </span>
                  </div>
                  <div className="side-row-sub">
                    {subOf && <span className="side-req">{subOf(c)}</span>}
                    <span className="side-when num">{fmtWhen(c.updatedAt)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="row-x"
                  title={label === "chats" ? "delete chat" : "delete session"}
                  disabled={deleting}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleting(true);
                    void remove(c).finally(() => setDeleting(false));
                  }}
                >
                  <Icon name="close" className="ms-sm" />
                </button>
              </Link>
            ))}
            {data && sessions.length === 0 && <div className="viewer-note">no {label} yet</div>}
          </div>
        </aside>
      )}
    </>
  );
}
