import type { Agent, Channel, ChatSummary } from "./api";
import { EditIcon } from "./icons";
import { useMenu } from "./menu";

/** Who the chat talks to: the workspace's general assistant, or one of its agents by slug. */
export const GENERAL = "general";

/** A channel as a target: "#<slug>". No agent slug can start with "#". */
export const channelTarget = (slug: string): string => `#${slug}`;
export const channelOf = (target: string): string | null => (target.startsWith("#") ? target.slice(1) : null);

export const isSessionOf = (chat: ChatSummary, target: string): boolean =>
  target === GENERAL ? chat.scope.kind === "general" : chat.scope.kind === "agent" && chat.scope.slug === target;

const Check = () => (
  <svg className="menu-check" viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

/** "14:32" for today, "12 Sep" this year, "12 Sep 2025" before. */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

/** The panel title as a dropdown: the general chat first, then every agent (each editable), then a new one. */
export function TargetPicker({ agents, channels, target, onPick, onEdit, onNew, onNewChannel }: {
  agents: Agent[];
  channels: Channel[];
  target: string;
  onPick: (target: string) => void;
  /** The pencil of a row: an agent's slug, or a channel's target ("#slug"). */
  onEdit: (key: string) => void;
  onNew: () => void;
  onNewChannel: () => void;
}) {
  const { open, setOpen, wrap } = useMenu<HTMLDivElement>();
  const agent = agents.find((a) => a.slug === target);
  const channel = channels.find((c) => channelTarget(c.slug) === target);
  const names = (slugs: string[]) => slugs.map((m) => agents.find((a) => a.slug === m)?.name ?? m).join(", ");
  const groups = [
    {
      label: "",
      items: [{ key: GENERAL, emoji: "💬", name: "Chat", sub: "The workspace's general assistant", editable: false }],
    },
    {
      label: "Agents",
      items: agents.map((a) => ({ key: a.slug, emoji: a.emoji || "🤖", name: a.name, sub: a.description ?? "", editable: true })),
    },
    {
      label: "Channels",
      items: channels.map((c) => ({
        key: channelTarget(c.slug),
        emoji: "#",
        name: c.name,
        sub: c.purpose || (c.members.length ? `with ${names(c.members)}` : "no agents yet"),
        editable: true,
      })),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="menu" ref={wrap}>
      {/* The heading holds the button, not the other way round: a button takes no heading inside. */}
      <h2>
        <button className="menu-button menu-title" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {/* The same mark the row in the menu carries, so the title is that row, picked. */}
          {agent && <span aria-hidden>{agent.emoji || "🤖"}</span>}
          {channel && <span className="menu-hash" aria-hidden>#</span>}
          {!agent && !channel && <span aria-hidden>💬</span>}
          <span className="menu-title-text">{agent?.name ?? channel?.name ?? "Chat"}</span>
          <span className="menu-caret" aria-hidden>▾</span>
        </button>
      </h2>
      {open && (
        <div className="menu-pop" role="menu">
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label || undefined}>
              {g.label && <div className="menu-group">{g.label}</div>}
              {g.items.map((it) => (
                // Two buttons side by side, since a button cannot hold another one.
                <div key={it.key} className="menu-row">
                  <button
                    className="menu-item"
                    role="menuitemradio"
                    aria-checked={it.key === target}
                    onClick={() => {
                      setOpen(false);
                      if (it.key !== target) onPick(it.key);
                    }}
                  >
                    <span className="menu-emoji" aria-hidden>{it.emoji}</span>
                    <span className="menu-text">
                      <span className="menu-name">{it.name}</span>
                      {it.sub && <span className="menu-sub">{it.sub}</span>}
                    </span>
                    {it.key === target && <Check />}
                  </button>
                  {it.editable && (
                    <button
                      className="icon menu-edit"
                      role="menuitem"
                      title="Edit"
                      aria-label={`Edit ${it.name}`}
                      onClick={() => {
                        setOpen(false);
                        onEdit(it.key);
                      }}
                    >
                      <EditIcon />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
          <div className="menu-sep" role="separator" />
          {[
            { label: "New agent", run: onNew },
            { label: "New channel", run: onNewChannel },
          ].map((it) => (
            <button
              key={it.label}
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              <span className="menu-emoji" aria-hidden>＋</span>
              <span className="menu-text">
                <span className="menu-name">{it.label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The sessions with the current target, newest first, and a fresh one on top. */
export function SessionPicker({ sessions, current, onOpen, onPick, onNew }: {
  sessions: ChatSummary[];
  /** null = a new session that has no message yet. */
  current: string | null;
  /** The menu opens: the moment to refresh the list. */
  onOpen: () => void;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const { open, setOpen, wrap } = useMenu<HTMLDivElement>();
  const title = (c: ChatSummary) => c.title || "Untitled session";

  return (
    <div className="menu menu-right" ref={wrap}>
      <button
        className="menu-button menu-session"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen();
          setOpen((v) => !v);
        }}
      >
        Session
        <span className="menu-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button
            className="menu-item"
            role="menuitemradio"
            aria-checked={current === null}
            onClick={() => {
              setOpen(false);
              if (current !== null) onNew();
            }}
          >
            <span className="menu-emoji" aria-hidden>＋</span>
            <span className="menu-text">
              <span className="menu-name">New session</span>
            </span>
            {current === null && <Check />}
          </button>
          {sessions.length > 0 && <div className="menu-sep" role="separator" />}
          {sessions.map((c) => (
            <button
              key={c.id}
              className="menu-item"
              role="menuitemradio"
              aria-checked={c.id === current}
              onClick={() => {
                setOpen(false);
                if (c.id !== current) onPick(c.id);
              }}
            >
              <span className="menu-text">
                <span className="menu-name">{title(c)}</span>
                <span className="menu-sub">
                  {c.awaitingApproval ? "needs your approval · " : c.busy ? "working · " : ""}
                  {when(c.updatedAt)}
                </span>
              </span>
              {c.id === current && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
