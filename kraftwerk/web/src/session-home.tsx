import { useEffect, useRef, useState } from "react";
import { api, failure, useApi } from "./api";
import { Icon, Link, PROJECT_ASSISTANT, fmtAgo, navigate } from "./shared";
import { ChatNameInput, SessionMenuItem, sessionTitle } from "./sessions";
import { Dot, IconButton, Notice, Popover } from "./ui";
import type { Agent, ChatAgentId, ChatMeta } from "./types";

/**
 * The overview of a place you talk in, like a desktop app's project page:
 * a composer that starts a session — with the place's default (a project's
 * assistant, Ralv) or with a specific agent from the picker — then whatever
 * the place pins (`children`, e.g. a project's apps), then the recent
 * sessions, each saying who it is with, with a rename/delete menu. Used by a
 * project (`ProjectHome` in projects.tsx), by Ralv (`RalvHome`) and by an
 * agent (`AgentHome`, both in agents/landing.tsx).
 */
export type HomeChat = ChatMeta & { busy: boolean; awaitingApproval?: boolean };

export interface HomeDefault {
  emoji: string;
  name: string;
  /** Under the name in the picker. */
  sub?: string;
  /** Beside the send button while the default is picked. */
  hint?: string;
}

export function SessionHome({
  placeholder,
  byDefault,
  firstGroup,
  agentHint,
  exclude,
  placeOf,
  sessions,
  hrefOf,
  create,
  children,
}: {
  placeholder: string;
  byDefault: HomeDefault;
  /** Agents listed first under their own heading (a project's team). */
  firstGroup?: { label: string; slugs: Set<string> };
  /** Beside the send button while an agent is picked. */
  agentHint?: string;
  /** An agent left out of the picker: the default itself, on an agent's overview. */
  exclude?: string;
  /** Where a session is filed, shown beside its name (an agent's sessions: their project). */
  placeOf?: (c: HomeChat) => string | undefined;
  sessions: HomeChat[] | null;
  hrefOf: (c: HomeChat) => string;
  /** Start a session: with the default (agent undefined) or the agent picked; resolves to the new chat's id and route, or an error. */
  create: (agent: string | undefined) => Promise<{ id: string; href: string } | { error: string }>;
  children?: React.ReactNode;
}) {
  const agents = useApi("agents.list", {}, { interval: 30_000 });
  const [who, setWho] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Focus the composer on arrival — unless a dialog (the edit modal over the columns) has the focus.
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!document.querySelector("[role=dialog]")) input.current?.focus();
  }, []);
  const roster = (agents?.agents ?? []).filter((a) => !a.archived);
  const all = roster.filter((a) => a.slug !== exclude);
  const first = firstGroup ? all.filter((a) => firstGroup.slugs.has(a.slug)) : [];
  const others = firstGroup ? all.filter((a) => !firstGroup.slugs.has(a.slug)) : all;
  const picked = who ? all.find((a) => a.slug === who) : undefined;
  const labelOf = (slug: string) => {
    const a = roster.find((x) => x.slug === slug);
    return a ? `${a.emoji || "🤖"} ${a.name}` : slug;
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const r = await create(who || undefined);
    if ("error" in r) {
      setBusy(false);
      return setError(r.error);
    }
    const message = text.trim();
    if (message) {
      const m = await api.request("chats.message", { id: r.id, body: { text: message } });
      if (!m.ok) {
        setBusy(false);
        return setError(failure(m));
      }
    }
    navigate(r.href);
  };

  const whoLabel = picked ? `${picked.emoji || "🤖"} ${picked.name}` : `${byDefault.emoji} ${byDefault.name}`;
  const agentItem = (a: Agent, close: () => void) => (
    <WhoItem
      key={a.slug}
      emoji={a.emoji || "🤖"}
      name={a.name}
      sub={a.description}
      on={who === a.slug}
      onClick={() => {
        setWho(a.slug);
        close();
      }}
    />
  );

  return (
    <div className="session-home mx-auto flex w-full max-w-[760px] animate-rise flex-col gap-7 px-6 pt-8 pb-12 max-[800px]:px-3 max-[800px]:pt-4">
      <div className="flex flex-col gap-2">
        <div className="rounded-[18px] border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_4px_16px_rgb(0_0_0/0.04)] focus-within:border-line-strong">
          <textarea
            ref={input}
            rows={2}
            value={text}
            aria-label="new session"
            placeholder={placeholder}
            className="block max-h-[40vh] min-h-[64px] w-full resize-none rounded-t-[18px] border-0 bg-transparent px-4 pt-3.5 pb-1 font-[inherit] text-base text-fg shadow-none outline-none focus:shadow-none focus:outline-none focus-visible:outline-none placeholder:text-fg-2 [field-sizing:content]"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void start();
              }
            }}
          />
          <div className="flex items-center gap-2 px-2.5 pb-2.5">
            <Popover
              className="max-h-[50vh] overflow-y-auto"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-label="session with"
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
                  onClick={toggle}
                >
                  {whoLabel}
                  <Icon name="expand_more" className="ms-sm text-fg-2" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <WhoItem
                    emoji={byDefault.emoji}
                    name={`${byDefault.name} (default)`}
                    sub={byDefault.sub}
                    on={!who}
                    onClick={() => {
                      setWho("");
                      close();
                    }}
                  />
                  {first.length > 0 && firstGroup && <MenuHead>{firstGroup.label}</MenuHead>}
                  {first.map((a) => agentItem(a, close))}
                  {others.length > 0 && <MenuHead>{first.length > 0 ? "other agents" : "agents"}</MenuHead>}
                  {others.map((a) => agentItem(a, close))}
                </>
              )}
            </Popover>
            <span className="flex-1" />
            <span className="truncate text-xs text-fg-2 max-[800px]:hidden">{picked ? (agentHint ?? "") : (byDefault.hint ?? "")}</span>
            <button
              type="button"
              aria-label="start session"
              title="start session (Enter)"
              className="inline-grid size-8 flex-none cursor-pointer place-items-center rounded-full bg-accent text-on-accent transition-[filter] hover:enabled:brightness-110 disabled:cursor-default disabled:opacity-60"
              disabled={busy}
              onClick={() => void start()}
            >
              <Icon name={busy ? "progress_activity" : "arrow_upward"} className="ms-sm" />
            </button>
          </div>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
      </div>

      {children}

      <section className="flex flex-col gap-1" aria-label="recent sessions">
        <h2 className="m-0 px-3 pb-1 text-sm font-medium text-fg-2">Recents</h2>
        {sessions && sessions.length === 0 && <p className="m-0 px-3 text-sm text-fg-2">No sessions yet — start one above.</p>}
        {(sessions ?? []).map((c) => (
          <RecentRow
            key={c.id}
            chat={c}
            href={hrefOf(c)}
            place={placeOf?.(c)}
            who={
              c.scope.kind === "channel"
                ? `👥 coworkers · #${c.scope.slug}`
                : c.scope.kind === "agent"
                  ? labelOf(c.scope.slug)
                  : c.scope.kind === "project"
                    ? `${PROJECT_ASSISTANT.emoji} ${PROJECT_ASSISTANT.name}`
                    : `${byDefault.emoji} ${byDefault.name}`
            }
          />
        ))}
      </section>
    </div>
  );
}

/** A start function for `SessionHome`: create the chat, answer its id and where it opens. */
export async function createSession(body: { agent: ChatAgentId; scope: Record<string, unknown>; project?: string }, hrefOf: (id: string) => string) {
  const r = await api.request("chats.create", { body: body as never });
  return r.ok ? { id: r.data.id, href: hrefOf(r.data.id) } : { error: failure(r) };
}

function MenuHead({ children }: { children: React.ReactNode }) {
  return <div className="mt-1.5 border-t border-line px-2 pt-2 pb-1 text-2xs font-semibold tracking-[0.06em] text-fg-2 uppercase">{children}</div>;
}

function WhoItem({ emoji, name, sub, on, onClick }: { emoji: string; name: string; sub?: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      className="flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
      onClick={onClick}
    >
      <span className="w-5 flex-none text-center text-base leading-5">{emoji}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm text-fg">{name}</span>
        {sub && <span className="truncate text-xs text-fg-2">{sub}</span>}
      </span>
      {on && <Icon name="check" className="ms-sm mt-0.5 text-accent" />}
    </button>
  );
}

/** One recent session: its name, who it is with, when; the menu (rename, delete) on hover. */
function RecentRow({ chat: c, href, who, place }: { chat: HomeChat; href: string; who: string; place?: string }) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const title = sessionTitle(c, "new session");
  if (renaming)
    return (
      <div className="px-1.5 py-1">
        <ChatNameInput
          name={title}
          className="w-full text-base"
          onDone={(t) => {
            setRenaming(false);
            if (t) void api.request("chats.rename", { id: c.id, body: { title: t } }).catch(() => null);
          }}
        />
      </div>
    );
  return (
    <div className="recent-session group/recent relative flex items-center rounded-card transition-colors hover:bg-surface-2 has-[[aria-expanded=true]]:bg-surface-2" data-chat={c.id}>
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-[15px] text-fg no-underline">
        {(c.busy || c.awaitingApproval) && <Dot tone={c.awaitingApproval ? "bad" : "working"} title={c.awaitingApproval ? "waiting for your approval" : "working"} />}
        {c.scope.kind === "channel" && <Icon name="forum" className="ms-sm text-fg-2" />}
        <span className="truncate">{title}</span>
        {place && <span className="recent-place flex-none truncate text-xs text-fg-2">{place}</span>}
      </Link>
      <span className="recent-agent flex-none truncate rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg-2 max-w-[40%]" title={`session with ${who}`}>
        {who}
      </span>
      <span className="flex-none px-3 text-sm text-fg-2 tabular-nums group-hover/recent:hidden group-has-[[aria-expanded=true]]/recent:hidden" title={c.updatedAt}>
        {fmtAgo(c.updatedAt)}
      </span>
      <span className="hidden flex-none pr-1.5 group-hover/recent:inline-flex group-has-[[aria-expanded=true]]/recent:inline-flex pointer-coarse:inline-flex">
        <Popover
          align="end"
          trigger={({ open, toggle }) => (
            <IconButton
              icon="more_horiz"
              size="sm"
              label={`more for ${title}`}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => {
                setConfirming(false);
                toggle();
              }}
            />
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
                onClick={() => {
                  if (!confirming) return setConfirming(true);
                  close();
                  void api.request("chats.delete", { id: c.id }).catch(() => null);
                }}
              />
            </>
          )}
        </Popover>
      </span>
    </div>
  );
}
