import { useCallback, useEffect, useRef, useState } from "react";
import { api, failure, live } from "./api";
import { fmtAgo, Icon, navigate, useExpertMode } from "./shared";
import { Button, cn, Dot, EmptyState, Hint, IconButton, ListRow, Notice, Select, SideHead, SideList, SideNote, SideSearch, Tag, TextField, Title, type DotTone } from "./ui";
import type { ChatAgentId, ChatMeta, VibeableInfo, VibeablesView, VibeableStatus } from "./types";

/**
 * Vibeable: an app folder rendered live next to a chat. The picker opens one
 * (or creates a new one with the starter) on the chat; the pane embeds it
 * — the folder served by the inspector, or the app's own dev server once it
 * runs — and reloads on the file-change events the server streams while
 * the agent edits.
 */

/**
 * A chat with an app attached shows it in the context column: the chat owns
 * the pane (it knows the chat, whether a turn runs, and takes the detach)
 * and renders it through a portal into the column's slot; this event tells
 * the column to open the vibeables category on that app.
 */
export const VIBE_ATTACH_EVENT = "kw-vibeable";
export const VIBE_SLOT_ID = "kw-vibe-slot";
export interface VibeAttachment {
  chatId: string;
  slug: string;
}
export function announceVibeable(detail: VibeAttachment | null): void {
  window.dispatchEvent(new CustomEvent(VIBE_ATTACH_EVENT, { detail }));
}

async function setVibeable(chatId: string, slug: string | null): Promise<ChatMeta> {
  const r = await api.request("chats.setVibeable", { id: chatId, body: { slug } });
  if (!r.ok) throw new Error(failure(r));
  return r.data;
}

/* ---------- pane ---------- */

export function VibePane({
  chatId,
  slug,
  agentBusy,
  onClosed,
}: {
  /** The chat the app is attached to; absent on the vibeables screen, where the pane is a plain preview. */
  chatId?: string;
  slug: string;
  /** A turn is running: closing would move the agent mid-work, so the server refuses it. */
  agentBusy?: boolean;
  onClosed?: (meta: ChatMeta) => void;
}) {
  const [status, setStatus] = useState<VibeableStatus | null>(null);
  const [tick, setTick] = useState(0);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showLog, setShowLog] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.request("vibeables.get", { slug });
      if (!r.ok) throw new Error(failure(r));
      setStatus(r.data);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void load();
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = live.subscribe(`vibeable.${slug}`, {}, (data) => {
      const ev = data as
        | { type: "change"; files: string[] }
        | { type: "dev"; dev: VibeableStatus["dev"] }
        | { type: "error"; message: string };
      if (ev.type === "change") {
        setTick((t) => t + 1);
        setFlash(ev.files.slice(0, 3).join(", ") + (ev.files.length > 3 ? ` +${ev.files.length - 3}` : ""));
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => setFlash(""), 2_500);
      } else if (ev.type === "dev" && ev.dev) {
        const dev = ev.dev;
        setStatus((s) => (s ? { ...s, dev, mode: dev.running ? "dev" : "static" } : s));
      } else if (ev.type === "error") {
        setError(ev.message);
      }
    });
    return () => {
      stop();
      clearTimeout(flashTimer);
    };
  }, [slug, load]);

  // The log grows while the dev server runs; dev events only mark state changes.
  const devRunning = !!status?.dev?.running;
  useEffect(() => {
    if (!devRunning || !showLog) return;
    const t = setInterval(() => void load(), 2_000);
    return () => clearInterval(t);
  }, [devRunning, showLog, load]);

  // Both modes go through the inspector's own origin: static files served
  // directly, a running dev server proxied under the same prefix. That is
  // what a container or reverse proxy exposes; a random host port is not.
  const src = status ? `${status.url}?v=${tick}` : "";

  const reload = () => setTick((t) => t + 1);

  const dev = async (verb: "start" | "stop") => {
    setBusy(verb);
    setError("");
    try {
      const r = await api.request(verb === "start" ? "vibeables.devStart" : "vibeables.devStop", { slug });
      if (!r.ok) throw new Error(failure(r));
      setStatus(r.data);
      if (verb === "start") setShowLog(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  };

  const close = async () => {
    if (!chatId || !onClosed) return;
    setBusy("close");
    setError("");
    try {
      onClosed(await setVibeable(chatId, null));
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  };

  const d = status?.dev;
  const modeChip: { tone: DotTone; text: string } = d?.running
    ? d.ready
      ? { tone: "ok", text: `dev :${d.port}` }
      : { tone: "working", text: "starting…" }
    : d && d.exitCode !== undefined
      ? { tone: "bad", text: `dev exited${d.exitCode == null ? "" : ` (${d.exitCode})`}` }
      : { tone: "ok", text: "static" };

  return (
    <aside className={PANE} data-vibe={slug}>
      <div className={BAR}>
        <Icon name="web" className="text-fg-2" />
        <span className="truncate text-base font-medium" title={status?.path}>{slug}</span>
        <Mode tone={modeChip.tone} title={d?.command ? `dev: ${d.command}` : status?.dir}>{modeChip.text}</Mode>
        {flash && (
          <span className="inline-flex animate-vibe-flash items-center gap-1 text-2xs whitespace-nowrap text-accent" title={flash}>
            <Icon name="bolt" className="ms-sm" /> reloaded
          </span>
        )}
        <span className="flex-1" />
        {status?.config.dev &&
          (d?.running ? (
            <IconButton icon={busy === "stop" ? "progress_activity" : "stop"} label="stop dev server" title={`Stop the dev server (${status.config.dev})`} onClick={() => void dev("stop")} disabled={!!busy} />
          ) : (
            <IconButton
              icon={busy === "start" ? "progress_activity" : "play_arrow"}
              label="start dev server"
              title={`Start the dev server: ${status.config.dev}`}
              className="text-accent"
              onClick={() => void dev("start")}
              disabled={!!busy}
            />
          ))}
        {d && (
          <IconButton
            icon="terminal"
            label="dev server output"
            title="Dev server output"
            className={showLog ? "bg-accent-soft text-on-accent-soft" : undefined}
            aria-pressed={showLog}
            onClick={() => setShowLog((v) => !v)}
          />
        )}
        <IconButton icon="refresh" label="reload preview" title="Reload the preview" onClick={reload} />
        <IconButton icon="open_in_new" label="open in new tab" title="Open in a new tab" onClick={() => window.open(status?.url ?? "", "_blank", "noopener")} disabled={!status} />
        {chatId && onClosed && (
          <IconButton
            icon={busy === "close" ? "progress_activity" : "close"}
            label="close preview"
            title={agentBusy ? "The agent is working — close the preview when the turn is done" : "Close the preview (the agent returns to the project root)"}
            onClick={() => void close()}
            disabled={!!busy || agentBusy}
          />
        )}
      </div>
      {(error || status?.configError) && (
        <div className={ERR}>
          <span className="flex-1">{error || status?.configError}</span>
          {error && <IconButton icon="close" label="dismiss" size="sm" className="rounded-full text-inherit hover:bg-transparent hover:text-inherit" onClick={() => setError("")} />}
        </div>
      )}
      {status?.config.dev && !d?.running && !error && (
        <Hint className="flex-none border-b border-line px-3.5 py-1.5">
          This app has a dev command (<code>{status.config.dev}</code>). Showing the static folder until you start it.
        </Hint>
      )}
      {src && (
        <iframe
          ref={frame}
          className="vibeable-frame block min-h-0 w-full flex-1 border-0 bg-white"
          src={src}
          title={`vibeable ${slug}`}
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          allow="clipboard-write"
        />
      )}
      {!src && !error && <EmptyState className="m-auto">loading…</EmptyState>}
      {showLog && d && (
        <pre
          className="m-0 max-h-[180px] flex-none overflow-auto border-t border-line bg-surface-2 px-3.5 py-2 font-mono text-[11.5px] leading-[1.5] break-words whitespace-pre-wrap text-fg-2"
          aria-label="dev server log"
        >
          {d.log.length ? d.log.join("\n") : "(no output yet)"}
        </pre>
      )}
    </aside>
  );
}

/**
 * `vibeable-pane` and `data-vibe` are what the context column (`.ctx-embed-vibe`)
 * and the tests find; the pane fills whatever column holds it.
 */
const PANE_BASE = "vibeable-pane flex flex-col overflow-hidden rounded-2xl bg-surface-2";
const PANE = `${PANE_BASE} min-h-0 min-w-0 flex-1`;
const BAR = "flex min-h-11 flex-none items-center gap-2 border-b border-line py-1.5 pr-2 pl-3.5";
const ERR = "flex flex-none items-center gap-2.5 bg-bad-soft py-1.5 pr-2 pl-3.5 text-[12.5px] text-on-bad-soft";

/** How the app is served right now: "static", "dev :5173", "starting…". `vibeable-mode` is a test hook. */
function Mode({ tone, title, children }: { tone: DotTone; title?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "vibeable-mode inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-2xs font-medium tracking-[0.02em] whitespace-nowrap",
        tone === "bad" ? "bg-bad-soft text-on-bad-soft" : "bg-surface text-fg-2"
      )}
      title={title}
    >
      <Dot tone={tone} />
      {children}
    </span>
  );
}

/** Shown in place of the pane when the feature was switched off while a chat still had an app open. */
export function VibeOffNote({ chatId, slug, onClosed }: { chatId: string; slug: string; onClosed: (meta: ChatMeta) => void }) {
  const [error, setError] = useState("");
  return (
    <aside className={cn(PANE_BASE, "max-w-[420px] min-w-[320px] flex-none self-start")} data-vibe={slug}>
      <div className={BAR}>
        <Icon name="web" className="text-fg-2" />
        <span className="truncate text-base font-medium">{slug}</span>
        <Mode tone="bad">vibeables are off</Mode>
        <span className="flex-1" />
        <IconButton
          icon="close"
          label="close preview"
          title="Detach the app from this chat"
          onClick={() => setVibeable(chatId, null).then(onClosed).catch((e: Error) => setError(e.message))}
        />
      </div>
      <Hint className="flex-none border-b border-line px-3.5 py-1.5">
        This chat has <b>{slug}</b> open, but vibeables were switched off in <a href="#/settings">settings</a>. Turn them back on to see the preview, or detach the app.
      </Hint>
      {error && <div className={ERR}><span className="flex-1">{error}</span></div>}
    </aside>
  );
}

/* ---------- screen ---------- */

const AGENT_KEY = "kw-vibeable-agent";

/** Start a chat on the given harness with the app open in its pane, and go there. */
async function openInChat(slug: string, agent: ChatAgentId): Promise<void> {
  const r = await api.request("chats.create", { body: { agent, scope: { kind: "general" } } });
  const chat = r.data;
  if (!r.ok || !chat.id) throw new Error(failure(r) || `HTTP ${r.status}`);
  await setVibeable(chat.id, slug);
  navigate(`/agents/chats/${chat.id}`);
}

/**
 * Vibeables (#/vibeables): a sidebar with every app under the root, newest
 * change first, with a search box; the selected app renders in a preview
 * pane on the right. #/vibeables lands on the latest app, #/vibeables/new
 * is the create form (also the whole screen while there are no apps).
 * Shown only when kraftwerk.yml turns the feature on.
 */
export function VibeablesScreen({ slug }: { slug?: string }) {
  const [view, setView] = useState<VibeablesView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [agent, setAgent] = useState<ChatAgentId>(() => {
    try {
      const v = localStorage.getItem(AGENT_KEY);
      return v === "codex" || v === "pi" ? v : "claude";
    } catch {
      return "claude";
    }
  });
  const expert = useExpertMode();

  const reload = useCallback(async () => {
    try {
      const r = await api.request("vibeables.list");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setView(r.data);
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message || "could not load the apps");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await reload();
      if (alive) timer = setTimeout(tick, 15_000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [reload]);

  // Newest change first; the API lists alphabetically.
  const apps = [...(view?.vibeables ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const needle = filter.trim().toLowerCase();
  const shown = needle ? apps.filter((a) => a.slug.toLowerCase().includes(needle)) : apps;
  const creating = slug === "new";
  const current = slug && !creating ? apps.find((a) => a.slug === slug) : undefined;

  // Route changes refetch, so a row removed elsewhere does not linger for a poll interval.
  useEffect(() => {
    void reload();
  }, [slug, reload]);

  // A bare #/vibeables lands on the app changed last.
  const latest = apps[0]?.slug;
  useEffect(() => {
    if (!slug && latest) navigate(`/vibeables/${encodeURIComponent(latest)}`, { replace: true });
  }, [slug, latest]);

  const mark = (key: string, verb: string) => setBusy((b) => ({ ...b, [key]: verb }));
  const unmark = (key: string) =>
    setBusy((b) => {
      const next = { ...b };
      delete next[key];
      return next;
    });
  const fail = (key: string, err: unknown) => setErrors((e) => ({ ...e, [key]: (err as Error).message }));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy.__new) return;
    mark("__new", "create");
    setErrors((x) => ({ ...x, __new: "" }));
    try {
      const r = await api.request("vibeables.create", { body: { name: n } });
      if (!r.ok) throw new Error(failure(r));
      const d = r.data;
      setName("");
      await reload();
      navigate(`/vibeables/${encodeURIComponent(d.slug ?? n)}`);
    } catch (err) {
      fail("__new", err);
    } finally {
      unmark("__new");
    }
  };

  const open = async (target: string) => {
    mark(target, "open");
    try {
      await openInChat(target, agent);
    } catch (err) {
      fail(target, err);
      unmark(target);
    }
  };

  const remove = async (target: string) => {
    mark(target, "remove");
    setConfirmRemove(false);
    try {
      const r = await api.request("vibeables.delete", { slug: target });
      const d = r.data as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) throw new Error(d.error || "failed");
      await reload();
      navigate("/vibeables", { replace: true });
    } catch (err) {
      fail(target, err);
      void reload();
    } finally {
      unmark(target);
    }
  };

  const pickAgent = (a: ChatAgentId) => {
    setAgent(a);
    try {
      localStorage.setItem(AGENT_KEY, a);
    } catch {}
  };

  const stateOf = (a: VibeableInfo): { label: string; tone: DotTone } =>
    a.configError
      ? { label: "config error", tone: "bad" }
      : a.hasIndex
        ? { label: a.dev ? "dev" : "static", tone: "ok" }
        : { label: "no index.html yet", tone: "idle" };

  let main: React.ReactNode;
  if (view && !view.enabled)
    main = (
      <EmptyState>
        {view.error && !/are off/.test(view.error) ? (
          <Notice tone="bad">{view.error}</Notice>
        ) : (
          <>
            Apps are off. Turn them on in <a href="#/settings">settings</a> or add a <code>vibeables:</code> block to kraftwerk.yml.
          </>
        )}
      </EmptyState>
    );
  else if (!view) main = <EmptyState>loading…</EmptyState>;
  else if (creating || apps.length === 0)
    main = (
      <form className="mx-auto flex w-full max-w-[560px] flex-col gap-2.5 px-4 py-10" onSubmit={(e) => void create(e)}>
        <div className="flex gap-2.5">
          <TextField className="flex-1 font-mono text-sm" value={name} placeholder="e.g. team-dashboard" aria-label="new app name" onChange={(e) => setName(e.target.value)} autoFocus />
          <Button type="submit" variant="primary" icon="add" busy={!!busy.__new} disabled={!name.trim()}>
            {busy.__new ? "creating…" : "new app"}
          </Button>
        </div>
        {errors.__new && <Notice tone="bad">{errors.__new}</Notice>}
        <p className="m-0 text-xs text-fg-2">
          A small app built live with an agent. One folder each under <code title={view.root}>{view.root}</code>; part of the workspace, commit it from the git screen.
        </p>
      </form>
    );
  else if (slug && !current) main = <EmptyState>no vibeable named {slug}</EmptyState>;
  else if (current) {
    const a = current;
    const st = stateOf(a);
    const verb = busy[a.slug];
    main = (
      // chat-main: the column's full-height flex box, so the pane fills what is left under the head.
      <div className="chat-main gap-3">
        <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2.5">
          <Dot tone={st.tone} />
          <Title>{a.slug}</Title>
          <Tag tone={st.tone === "bad" ? "bad" : st.tone === "ok" ? "ok" : "neutral"}>{st.label}</Tag>
          {a.updatedAt && <span className="text-xs text-fg-2" title={a.updatedAt}>changed {fmtAgo(a.updatedAt)}</span>}
          {expert && <span className="max-w-[40ch] truncate font-mono text-xs text-fg-2" title={a.path}>{a.path}</span>}
          <span className="flex-1" />
          <Select className="h-8 w-auto text-sm" value={agent} onChange={(e) => pickAgent(e.target.value as ChatAgentId)} aria-label="agent for new chats">
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="pi">pi</option>
          </Select>
          <Button variant="primary" icon="chat" busy={verb === "open"} disabled={!!verb} onClick={() => void open(a.slug)} title={`Start a ${agent} chat with this app in the preview pane`}>
            open in chat
          </Button>
          {!confirmRemove ? (
            <Button variant="danger" icon="delete" disabled={!!verb} onClick={() => setConfirmRemove(true)} title="Move the folder to the trash">
              remove
            </Button>
          ) : (
            <>
              <Button variant="danger" icon="delete" onClick={() => void remove(a.slug)}>
                confirm remove
              </Button>
              <Button variant="quiet" onClick={() => setConfirmRemove(false)}>cancel</Button>
            </>
          )}
        </div>
        {(a.configError || errors[a.slug]) && <Notice tone="bad">{a.configError || errors[a.slug]}</Notice>}
        <VibePane key={a.slug} slug={a.slug} />
      </div>
    );
  } else main = <EmptyState>loading…</EmptyState>;

  return (
    <div className="runs-screen vibeables-screen">
      <aside className="runs-side">
        <SideHead
          title="apps"
          count={view?.enabled ? apps.length : undefined}
          action={
            view?.enabled && (
              <Button size="sm" variant="quiet" icon="add" href="/vibeables/new">
                new
              </Button>
            )
          }
        />
        <SideSearch icon="filter_list" value={filter} placeholder="search apps" aria-label="search apps" onChange={(e) => setFilter(e.target.value)} />
        <SideList>
          {shown.map((a) => {
            const st = stateOf(a);
            return (
              // vibeable-row + data-vibeable: the tests' handle on one app's row.
              <div key={a.slug} className="vibeable-row" data-vibeable={a.slug}>
                <ListRow
                  href={`/vibeables/${encodeURIComponent(a.slug)}`}
                  active={a.slug === slug}
                  size="sm"
                  leading={<Dot tone={st.tone} />}
                  title={a.slug}
                  sub={`${st.label}${a.dev ? ` · ${a.dev}` : ""}`}
                  meta={a.updatedAt && <span title={a.updatedAt}>{fmtAgo(a.updatedAt)}</span>}
                />
              </div>
            );
          })}
          {view && apps.length === 0 && <SideNote>nothing built yet</SideNote>}
          {view && apps.length > 0 && shown.length === 0 && <SideNote>no vibeable matches</SideNote>}
          {loadError && <Notice tone="bad">{loadError}</Notice>}
        </SideList>
      </aside>
      <div className="runs-main">{main}</div>
    </div>
  );
}
