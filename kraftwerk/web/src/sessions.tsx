import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ChatMeta } from "./types";
import { api, useApi } from "./api";
import { Icon, navigate } from "./shared";
import { cn, Dot, Popover } from "./ui";

/**
 * Pieces of a conversation context's sessions (a project, an agent, Ralv):
 * the open session's crumb in the title row (`SessionCrumb`, with the chat's
 * own actions after it through `StripEnd`), renaming, the session menu. The
 * overview with the composer and the recents is `SessionHome`.
 */

export type Session = ChatMeta & { busy: boolean; awaitingApproval?: boolean };

/** The crumb's right end: the open chat puts its own actions there (`StripEnd`). */
const STRIP_END_ID = "kw-strip-end";

/** Render into the crumb's right end, from inside the chat; nothing while there is no crumb. */
export function StripEnd({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const target = document.getElementById(STRIP_END_ID);
    if (target !== el) setEl(target);
  });
  return el ? createPortal(children, el) : null;
}

/** Rename a chat in place: Enter or leaving the field saves, Escape keeps the name. */
export function ChatNameInput({ name, className, onDone }: { name: string; className?: string; onDone: (title?: string) => void }) {
  const [value, setValue] = useState(name);
  const clean = value.replace(/\s+/g, " ").trim().slice(0, 80);
  return (
    <input
      autoFocus
      value={value}
      aria-label="chat name"
      maxLength={80}
      className={cn("min-w-0 rounded-control border border-accent bg-surface px-2 py-1 font-[inherit] text-fg outline-none", className)}
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

/** One row of a session menu ("rename", "delete"). */
export function SessionMenuItem({ icon, label, danger, onClick }: { icon: string; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2", danger ? "text-bad" : "text-fg")}
      onClick={onClick}
    >
      <Icon name={icon} className="ms-sm" />
      {label}
    </button>
  );
}

/** The title a session shows: its own, a channel's name, or the fallback. */
export const sessionTitle = (c: Session, fallback: string): string => (c.scope.kind === "channel" ? c.title || `#${c.scope.slug}` : c.title || fallback);

/**
 * The open session's name next to the title of the space it belongs to
 * ("Project / Session ▾"), where the tab strip used to name it: the menu
 * renames or deletes it, and the chat's own actions (add coworker, file
 * under a project) render after it (`StripEnd`).
 */
export function SessionCrumb({ id, fallbackTitle, backHref }: { id: string; fallbackTitle: string; backHref: string }) {
  const data = useApi("chats.list", {}, { refresh: id });
  const c = data?.chats.find((x) => x.id === id);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const title = c ? sessionTitle(c, fallbackTitle) : "";
  return (
    <>
      <span className="flex-none text-lg text-line-strong" aria-hidden>
        /
      </span>
      {renaming && c ? (
        <ChatNameInput
          name={title}
          className="w-[280px] text-base font-semibold"
          onDone={(t) => {
            setRenaming(false);
            if (t) void api.request("chats.rename", { id, body: { title: t } }).catch(() => null);
          }}
        />
      ) : (
        <Popover
          trigger={({ open, toggle }) => (
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label="session menu"
              className="session-crumb inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-control px-1.5 py-0.5 text-[17px] font-semibold text-fg transition-colors hover:bg-surface-2"
              title={title}
              onClick={() => {
                setConfirming(false);
                toggle();
              }}
            >
              {c && (c.busy || c.awaitingApproval) && <Dot tone={c.awaitingApproval ? "bad" : "working"} title={c.awaitingApproval ? "waiting for your approval" : "working"} />}
              {c?.scope.kind === "channel" && <Icon name="forum" className="ms-sm text-fg-2" />}
              <span className="truncate">{title || "…"}</span>
              <Icon name="expand_more" className="ms-sm flex-none text-fg-2" />
            </button>
          )}
        >
          {(close) => (
            <>
              <SessionMenuItem
                icon="edit"
                label="rename"
                onClick={() => {
                  close();
                  setRenaming(true);
                }}
              />
              <SessionMenuItem
                icon="delete"
                label={confirming ? "confirm delete" : "delete"}
                danger
                onClick={async () => {
                  if (!confirming) return setConfirming(true);
                  close();
                  await api.request("chats.delete", { id }).catch(() => null);
                  navigate(backHref);
                }}
              />
            </>
          )}
        </Popover>
      )}
      <span id={STRIP_END_ID} className="flex flex-none items-center gap-0.5" />
    </>
  );
}
