import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { api, failure, useApi } from "./api";
import { fmtAgo, Icon, Link, navigate } from "./shared";
import { Button, cn, EmptyState, Eyebrow, Field, FieldRow, FormStack, Hint, IconButton, ListRow, Notice, Page, Panel, Select, SideNote, Tag, TextArea, TextField, Title } from "./ui";
import type { ApiName, ApiResult, CallInput } from "./api";

/**
 * Remote boards: the workspace's boards in kraftwerk cloud, multiplayer
 * (src/server/remote-boards.ts → the cloud). Shown in the boards page beside
 * the local boards as their own kind, each with a cloud mark; a task can go
 * to anyone on the workspace (human:<handle>) or an agent. Offline is
 * offline: while the cloud does not answer they are marked so, nothing is
 * cached. Routes: #/boards/@cloud/<board>[/<number>], #/boards/@cloud/new.
 */

export const REMOTE_SEG = "@cloud";
const enc = encodeURIComponent;
export const remoteBoardHref = (board: string): string => `/boards/${REMOTE_SEG}/${enc(board)}`;
const remoteTaskHref = (board: string, n: number): string => `${remoteBoardHref(board)}/${n}`;
const label = (a: string): string => (a.startsWith("human:") ? `@${a.slice("human:".length)}` : a);

/** Polls a remote route; keeps the failure (offline, no id, refused) instead of hiding it. */
type Remote<N extends ApiName> = { data: ApiResult<N> | null; error: string; offline: boolean; reload: () => void };
function useRemote<N extends ApiName>(name: N, input: CallInput<N>, interval = 10_000): Remote<N> {
  const [state, setState] = useState<{ data: ApiResult<N> | null; error: string; offline: boolean }>({ data: null, error: "", offline: false });
  const key = JSON.stringify(input);
  const ref = useRef(input);
  ref.current = input;
  const load = useCallback(async () => {
    const r = await api.request(name, ref.current as never);
    if (r.ok) setState({ data: r.data as ApiResult<N>, error: "", offline: false });
    else setState((s) => ({ data: r.status === 503 ? null : s.data, error: failure(r), offline: (r.data as { offline?: boolean } | undefined)?.offline === true }));
  }, [name, key]);
  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), interval);
    return () => clearInterval(t);
  }, [load, interval]);
  return { ...state, reload: () => void load() };
}

/* ---------- the side list ---------- */

/** The cloud boards under the local ones in the boards page's side list. */
export function RemoteBoardsSide({ active }: { active?: string }) {
  const r = useRemote("remoteBoards.list", {}, 15_000);
  return (
    <>
      <div className="mt-3 flex items-center gap-2 px-3 pb-1 pt-2">
        <Eyebrow className="flex-1">cloud boards</Eyebrow>
        {r.offline ? (
          <Tag tone="ask" title={r.error}>offline</Tag>
        ) : (
          r.data && <IconButton size="sm" icon="add" label="new cloud board" href={`/boards/${REMOTE_SEG}/new`} />
        )}
      </div>
      {(r.data?.boards ?? []).map((b) => (
        <ListRow
          key={b.slug}
          href={remoteBoardHref(b.slug)}
          active={active === b.slug}
          size="sm"
          leading={<Icon name="cloud" className="ms-sm" />}
          title={b.title}
          sub={`${b.taskCount} ${b.taskCount === 1 ? "task" : "tasks"}${r.offline ? " · offline" : ""}`}
          meta={<span>{fmtAgo(new Date(b.updatedAt).toISOString())}</span>}
        />
      ))}
      {r.data && r.data.boards.length === 0 && <SideNote>no cloud boards yet — shared with everyone on the workspace</SideNote>}
      {!r.data && r.error && <SideNote>{r.offline ? `offline — ${r.error}` : r.error}</SideNote>}
    </>
  );
}

/* ---------- the screen ---------- */

/** #/boards/@cloud/… : a cloud board, one of its tasks, or a new one. */
export function RemoteBoardScreen({ seg }: { seg: string[] }) {
  const board = seg[0] ? decodeURIComponent(seg[0]) : "";
  if (!board) return <EmptyState icon="cloud">pick a cloud board</EmptyState>;
  if (board === "new") return <NewRemoteBoard />;
  if (seg[1]) return <RemoteTaskPage key={`${board}/${seg[1]}`} board={board} n={Number(seg[1])} />;
  return <RemoteBoardPage key={board} board={board} />;
}

function OfflineState({ error, offline }: { error: string; offline: boolean }) {
  return (
    <EmptyState icon={offline ? "cloud_off" : "cloud"}>
      {offline ? <><strong>offline</strong> — {error}. Cloud boards come back as soon as the cloud answers.</> : <span className="text-bad">{error}</span>}
    </EmptyState>
  );
}

function RemoteBoardPage({ board }: { board: string }) {
  const r = useRemote("remoteBoards.get", { board }, 8000);
  const agents = useApi("agents.list", {}, { interval: 60_000 });
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<number | null>(null);
  const [assignee, setAssignee] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const data = r.data;
  if (!data) return r.error ? <OfflineState error={r.error} offline={r.offline} /> : <EmptyState>loading…</EmptyState>;

  const move = async (n: number, status: string) => {
    const t = data.tasks.find((x) => x.number === n);
    if (!t || t.status === status) return;
    const res = await api.request("remoteTasks.save", { board, task: String(n), body: { status } });
    setError(res.ok ? "" : failure(res));
    r.reload();
  };
  const remove = async () => {
    const res = await api.request("remoteBoards.delete", { board });
    if (!res.ok) return setError(failure(res));
    navigate("/boards", { replace: true });
  };
  const who = new Set(data.tasks.map((t) => t.assignee).filter((a): a is string => !!a));
  const agentOf = (slug: string) => (agents?.agents ?? []).find((a) => a.slug === slug);

  return (
    <div className="chat-main flex min-h-0 flex-col gap-3">
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2">
        <Icon name="cloud" className="text-[26px] text-fg-2" />
        <Title>{data.board.title}</Title>
        <Tag tone="accent" title="kept in kraftwerk cloud, shared with everyone on the workspace">cloud</Tag>
        <Tag>{data.board.taskCount} {data.board.taskCount === 1 ? "task" : "tasks"}</Tag>
        {r.offline && <Tag tone="ask" title={r.error}>offline</Tag>}
        <span className="flex-1" />
        <span className="text-xs text-fg-2" title="who your changes are signed with">as {label(data.actor)}</span>
        {confirmRemove ? (
          <>
            <Button size="sm" variant="danger" onClick={() => void remove()}>delete for everyone</Button>
            <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(false)}>cancel</Button>
          </>
        ) : (
          <IconButton size="sm" icon="delete" label="delete the board and its tasks (owners only, no trash)" onClick={() => setConfirmRemove(true)} />
        )}
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {who.size > 0 && (
        <div className="flex flex-none items-center gap-2">
          <Select className="h-8 w-auto text-sm" value={assignee} aria-label="assignee" onChange={(e) => setAssignee(e.target.value)}>
            <option value="">anyone</option>
            {[...who].map((a) => (
              <option key={a} value={a}>{label(a)}</option>
            ))}
          </Select>
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto overflow-y-hidden pb-2">
        {data.board.columns.map((col) => {
          const tasks = data.tasks.filter((t) => t.status === col.slug);
          const shown = assignee ? tasks.filter((t) => t.assignee === assignee) : tasks;
          return (
            <section
              key={col.slug}
              aria-label={col.title}
              data-column={col.slug}
              className="flex max-h-full min-w-[208px] max-w-[360px] flex-1 basis-0 flex-col rounded-card border border-line bg-surface-2"
              onDragOver={(e: DragEvent) => drag !== null && e.preventDefault()}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                if (drag !== null) void move(drag, col.slug);
                setDrag(null);
              }}
            >
              <div className="flex flex-none items-center gap-2 px-3 pb-1.5 pt-2.5">
                <Eyebrow className="truncate text-fg">{col.title}</Eyebrow>
                <span className="text-2xs font-semibold tabular-nums text-fg-2">{tasks.length}</span>
              </div>
              <div className="flex min-h-[48px] flex-col gap-1.5 overflow-y-auto px-2 pb-1">
                {shown.map((t) => {
                  const agent = t.assignee && !t.assignee.startsWith("human:") ? agentOf(t.assignee) : undefined;
                  return (
                    <article
                      key={t.number}
                      draggable
                      onDragStart={() => setDrag(t.number)}
                      onDragEnd={() => setDrag(null)}
                      className={cn("flex cursor-grab flex-col gap-1 rounded-card border border-line bg-surface px-2.5 py-2 active:cursor-grabbing", drag === t.number && "opacity-40")}
                    >
                      <div className="flex items-start gap-2">
                        <Link href={remoteTaskHref(board, t.number)} className="min-w-0 flex-1 text-sm font-medium leading-snug text-fg no-underline [overflow-wrap:anywhere] hover:underline">
                          {t.title}
                        </Link>
                        <span className="flex-none font-mono text-2xs text-fg-2">#{t.number}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-2">
                        {t.assignee ? (
                          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-surface-2 px-1.5 font-medium text-fg">
                            {agent?.emoji ? <span aria-hidden>{agent.emoji}</span> : <Icon name={t.assignee.startsWith("human:") ? "person" : "smart_toy"} className="ms-sm text-[13px]" />}
                            {agent?.name ?? label(t.assignee)}
                          </span>
                        ) : (
                          <span className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 ring-1 ring-inset ring-line">unassigned</span>
                        )}
                        {t.due && <span className="inline-flex items-center gap-0.5"><Icon name="event" className="ms-sm text-[13px]" /> {t.due}</span>}
                      </div>
                      {t.tags.length > 0 && <div className="flex flex-wrap gap-1">{t.tags.map((x) => <Tag key={x}>{x}</Tag>)}</div>}
                      {t.last && <div className="truncate text-2xs text-fg-2 opacity-80" title={t.last}>{t.last}</div>}
                    </article>
                  );
                })}
                {drag !== null && <div className="h-6" />}
              </div>
              <AddRemoteTask board={board} status={col.slug} onDone={(e) => { setError(e); r.reload(); }} />
            </section>
          );
        })}
      </div>
    </div>
  );
}

function AddRemoteTask({ board, status, onDone }: { board: string; status: string; onDone: (error: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const r = await api.request("remoteTasks.create", { board, body: { title: t, status } });
    setBusy(false);
    onDone(r.ok ? "" : failure(r));
    if (r.ok) setTitle("");
  };
  if (!open)
    return (
      <Button size="sm" variant="quiet" icon="add" className="m-1 justify-start" onClick={() => setOpen(true)}>
        task
      </Button>
    );
  return (
    <div className="flex items-center gap-1 p-1.5">
      <TextField
        autoFocus
        value={title}
        className="h-8 text-sm"
        placeholder="task title — Enter adds"
        aria-label={`new cloud task in ${status}`}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void create();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => !title.trim() && setOpen(false)}
      />
    </div>
  );
}

function RemoteTaskPage({ board, n }: { board: string; n: number }) {
  const r = useRemote("remoteTasks.get", { board, task: String(n) }, 8000);
  const b = useRemote("remoteBoards.get", { board }, 30_000);
  const agents = useApi("agents.list", {}, { interval: 60_000 });
  const [error, setError] = useState("");
  const [entry, setEntry] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const t = r.data?.task;
  if (!t) return r.error ? <OfflineState error={r.error} offline={r.offline} /> : <EmptyState>loading…</EmptyState>;

  const save = async (body: Record<string, unknown>) => {
    const res = await api.request("remoteTasks.save", { board, task: String(n), body });
    setError(res.ok ? "" : failure(res));
    r.reload();
  };
  const addLog = async () => {
    const e = entry.trim();
    if (!e) return;
    const res = await api.request("remoteTasks.log", { board, task: String(n), body: { entry: e } });
    setError(res.ok ? "" : failure(res));
    if (res.ok) setEntry("");
    r.reload();
  };
  const remove = async () => {
    const res = await api.request("remoteTasks.delete", { board, task: String(n) });
    if (!res.ok) return setError(failure(res));
    navigate(remoteBoardHref(board), { replace: true });
  };
  const people = b.data?.people ?? [];
  const team = (agents?.agents ?? []).filter((a) => !a.archived);

  return (
    <Page>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={remoteBoardHref(board)} className="text-sm text-accent">← {b.data?.board.title ?? board}</Link>
        <Tag tone="accent">cloud</Tag>
        {r.offline && <Tag tone="ask" title={r.error}>offline</Tag>}
        <span className="font-mono text-xs text-fg-2">#{t.number}</span>
        <span className="flex-1" />
        {confirmRemove ? (
          <>
            <Button size="sm" variant="danger" onClick={() => void remove()}>delete for everyone</Button>
            <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(false)}>cancel</Button>
          </>
        ) : (
          <IconButton size="sm" icon="delete" label="delete the task (no trash)" onClick={() => setConfirmRemove(true)} />
        )}
      </div>
      <TextField
        key={`title-${t.updatedAt}`}
        defaultValue={t.title}
        aria-label="task title"
        className="text-lg font-medium"
        onBlur={(e) => e.target.value.trim() && e.target.value !== t.title && void save({ title: e.target.value })}
      />
      {error && <Notice tone="bad">{error}</Notice>}
      <Panel>
        <FormStack className="px-[18px] py-3">
          <FieldRow>
            <Field label="column">
              <Select value={t.status} aria-label="column" onChange={(e) => void save({ status: e.target.value })}>
                {(b.data?.board.columns ?? [{ slug: t.status, title: t.status }]).map((c) => (
                  <option key={c.slug} value={c.slug}>{c.title}</option>
                ))}
              </Select>
            </Field>
            <Field label="assignee">
              <Select value={t.assignee ?? ""} aria-label="assignee" onChange={(e) => void save({ assignee: e.target.value || null })}>
                <option value="">unassigned</option>
                <optgroup label="people">
                  {people.map((p) => (
                    <option key={p.id} value={`human:${p.handle}`}>👤 {p.handle}</option>
                  ))}
                </optgroup>
                <optgroup label="agents">
                  {team.map((a) => (
                    <option key={a.slug} value={a.slug}>{a.emoji ? `${a.emoji} ` : ""}{a.name}</option>
                  ))}
                </optgroup>
                {t.assignee && !people.some((p) => `human:${p.handle}` === t.assignee) && !team.some((a) => a.slug === t.assignee) && <option value={t.assignee}>{label(t.assignee)}</option>}
              </Select>
            </Field>
            <Field label="due">
              <TextField type="date" value={t.due ?? ""} aria-label="due" onChange={(e) => void save({ due: e.target.value || null })} />
            </Field>
          </FieldRow>
          <Field label="tags">
            <TextField
              key={`tags-${t.updatedAt}`}
              defaultValue={t.tags.join(", ")}
              aria-label="tags"
              placeholder="comma separated"
              onBlur={(e) => {
                const tags = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                if (tags.join(",") !== t.tags.join(",")) void save({ tags });
              }}
            />
          </Field>
          <Field label="notes">
            <TextArea rows={6} value={notes ?? t.notes} aria-label="notes" onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== null && notes !== t.notes) void save({ notes }); setNotes(null); }} />
          </Field>
          <Hint>Assignees are the people on the workspace and your agents. Agents are not woken from a cloud board yet — they work on it through this machine, signed with their own name.</Hint>
        </FormStack>
      </Panel>
      <Panel title="log">
        <ol className="m-0 flex list-none flex-col gap-2 px-[18px] py-3">
          {t.log.map((l, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="text-xs text-fg-2" title={new Date(l.at).toISOString()}>{fmtAgo(new Date(l.at).toISOString())}</span>
              <span className="[overflow-wrap:anywhere]">{l.entry}</span>
              <span className="text-xs text-fg-2">{label(l.actor)}</span>
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-2 border-t border-line px-[18px] py-2.5">
          <TextField value={entry} aria-label="log entry" placeholder="add to the log — Enter" onChange={(e) => setEntry(e.target.value)} onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && (e.preventDefault(), void addLog())} />
          <Button size="sm" variant="quiet" icon="send" disabled={!entry.trim()} onClick={() => void addLog()}>log</Button>
        </div>
      </Panel>
    </Page>
  );
}

function NewRemoteBoard() {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    const r = await api.request("remoteBoards.create", { body: { title: t } });
    setBusy(false);
    if (!r.ok) return setError(failure(r));
    navigate(remoteBoardHref(r.data.board.slug), { replace: true });
  };
  return (
    <Page>
      <div className="flex items-center gap-3">
        <Icon name="cloud" className="text-[26px] text-fg-2" />
        <Title>new cloud board</Title>
      </div>
      <Panel>
        <form onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <FormStack className="max-w-[680px]">
            <Field label="title">
              <TextField value={title} aria-label="cloud board title" autoFocus placeholder="e.g. Launch" onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <FieldRow>
              <Button variant="primary" type="submit" icon="add" busy={busy} disabled={!title.trim() || busy}>create cloud board</Button>
              <Button variant="quiet" href="/boards">cancel</Button>
              {error && <span className="text-sm text-bad">{error}</span>}
            </FieldRow>
            <Hint>
              Kept in kraftwerk cloud, not in this repo: everyone on the workspace sees and edits it, from their machine or the cloud. Columns start as To do, In progress, Review, Done. Local boards stay single player.
            </Hint>
          </FormStack>
        </form>
      </Panel>
    </Page>
  );
}
