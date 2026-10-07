import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ChatMeta } from "./types";
import { Icon, Link, navigate, usePoll, fmtWhen } from "./shared";
import { cn, Dot, IconButton, ListRow, SideHead, SideList, SideNote } from "./ui";

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
/** The "+" after the last tab: a new chat in this context. */
export function NewTabButton({ busy, onClick, href }: { busy?: boolean; onClick?: () => void; href?: string }) {
  return <IconButton icon={busy ? "progress_activity" : "add"} label="new chat" size="sm" className="mb-1 ml-1 rounded-full" disabled={busy} onClick={onClick} href={href} />;
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

/** Fired with {id, title} when a chat is renamed from its tab, so the open thread takes the new name too. */
export const CHAT_RENAMED_EVENT = "kw-chat-renamed";

/** A tab being renamed: Enter or leaving the field saves, Escape keeps the name. */
function TabName({ name, onDone }: { name: string; onDone: (title?: string) => void }) {
  const [value, setValue] = useState(name);
  const clean = value.replace(/\s+/g, " ").trim().slice(0, 80);
  return (
    <input
      autoFocus
      value={value}
      aria-label="chat name"
      maxLength={80}
      className="-mb-px w-[220px] flex-none self-end rounded-t-[10px] border border-b-0 border-accent bg-surface px-3 py-[7px] font-[inherit] text-sm font-medium text-fg outline-none"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(clean && clean !== name ? clean : undefined);
        if (e.key === "Escape") onDone();
      }}
      onBlur={() => onDone(clean && clean !== name ? clean : undefined)}
    />
  );
}

/** The tab strip's right end: the open chat puts its own actions there (`StripEnd`). */
const STRIP_END_ID = "kw-strip-end";

/** Render into the strip's right end, from inside the chat; nothing while there is no strip. */
export function StripEnd({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const target = document.getElementById(STRIP_END_ID);
    if (target !== el) setEl(target);
  });
  return el ? createPortal(children, el) : null;
}

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

  // A rename shows at once; the next poll carries the same name.
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const rename = async (id: string, title: string) => {
    setRenaming(null);
    const r = await fetch(`/api/chats/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) }).catch(() => null);
    if (!r?.ok) return;
    setRenamed((m) => ({ ...m, [id]: title }));
    window.dispatchEvent(new CustomEvent(CHAT_RENAMED_EVENT, { detail: { id, title } }));
  };

  const shown = data ? tabs.filter((id) => byId.has(id)) : [];
  const titleOf = (c: Session) => renamed[c.id] ?? (c.scope.kind === "channel" ? c.title || `#${c.scope.slug}` : c.title || fallbackTitle);

  return (
    <>
      <nav
        className="order-first col-span-full flex min-w-0 items-end gap-1 border-b border-line bg-surface-2 pt-1.5 pr-2 pl-1.5"
        aria-label="open chats"
      >
        <button
          type="button"
          className={cn(
            "mb-1 inline-flex flex-none cursor-pointer items-center gap-1 self-center rounded-control px-2 py-1 text-2xs transition-colors",
            open ? "bg-accent-soft text-on-accent-soft" : "text-fg-2 hover:bg-surface hover:text-fg"
          )}
          onClick={() => setSessionsList(!open)}
          title={open ? `hide the ${label} list` : `show all ${label}`}
          aria-label={`${label} list`}
          aria-pressed={open}
        >
          <Icon name="view_list" className="ms-sm" />
          {data && <span className="tabular-nums">{sessions.length}</span>}
        </button>
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" role="tablist">
          {shown.map((id) => {
            const c = byId.get(id)!;
            const active = id === chatId;
            if (renaming === id) return <TabName key={id} name={titleOf(c)} onDone={(t) => (t ? void rename(id, t) : setRenaming(null))} />;
            return (
              <Link
                key={id}
                href={hrefOf(c)}
                className={cn(
                  "session-tab group/tab -mb-px inline-flex max-w-[220px] min-w-0 flex-none animate-tab-in items-center gap-1.5 self-end",
                  "rounded-t-[10px] border border-b-0 py-[7px] pr-1.5 pl-3 text-sm font-medium no-underline transition-colors",
                  active ? "border-line bg-surface text-fg" : "border-transparent text-fg-2 hover:bg-surface"
                )}
                role="tab"
                aria-selected={active}
                title={`${titleOf(c)} · double-click to rename`}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  setRenaming(id);
                }}
              >
                {(c.busy || c.awaitingApproval) && <Dot tone={c.awaitingApproval ? "bad" : "working"} title={c.awaitingApproval ? "waiting for your approval" : "working"} />}
                {c.scope.kind === "channel" && <Icon name="forum" className="ms-sm text-fg-2" />}
                <span className="truncate">{titleOf(c)}</span>
                {active && (
                  <button
                    type="button"
                    className="inline-flex flex-none cursor-pointer rounded-md p-0.5 text-fg-2 opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 pointer-coarse:opacity-100"
                    aria-label={`rename ${titleOf(c)}`}
                    title="rename"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setRenaming(id);
                    }}
                  >
                    <Icon name="edit" className="ms-sm" />
                  </button>
                )}
                <button
                  type="button"
                  className={cn(
                    "inline-flex flex-none cursor-pointer rounded-md p-0.5 text-fg-2 transition-opacity hover:bg-surface-2 hover:text-fg focus-visible:opacity-100",
                    active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100"
                  )}
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
        <span className="flex-1" />
        <span id={STRIP_END_ID} className="mb-1 flex flex-none items-center gap-0.5 self-center" />
      </nav>
      {open && (
        <aside className="runs-side sessions-side animate-slide-left">
          <SideHead title={label} action={<IconButton icon="close" label="hide the list" size="sm" onClick={() => setSessionsList(false)} />} />
          <SideList>
            {sessions.map((c) => (
              <ListRow
                key={c.id}
                href={hrefOf(c)}
                active={c.id === chatId}
                size="sm"
                leading={<Dot tone={c.awaitingApproval ? "bad" : c.busy ? "working" : "idle"} title={c.awaitingApproval ? "waiting for your approval" : undefined} />}
                title={
                  <>
                    {c.scope.kind === "channel" && <Icon name="forum" className="ms-sm mr-1 align-[-3px]" />}
                    {titleOf(c)}
                  </>
                }
                sub={
                  <>
                    {subOf && <>{subOf(c)} · </>}
                    <span className="tabular-nums">{fmtWhen(c.updatedAt)}</span>
                  </>
                }
                actions={
                  <IconButton
                    icon="close"
                    size="sm"
                    label={label === "chats" ? "delete chat" : "delete session"}
                    disabled={deleting}
                    onClick={() => {
                      setDeleting(true);
                      void remove(c).finally(() => setDeleting(false));
                    }}
                  />
                }
              />
            ))}
            {data && sessions.length === 0 && <SideNote>no {label} yet</SideNote>}
          </SideList>
        </aside>
      )}
    </>
  );
}
