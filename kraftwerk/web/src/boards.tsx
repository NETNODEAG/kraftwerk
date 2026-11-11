import DOMPurify from "dompurify";
import { marked } from "marked";
import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { api, failure, useApi } from "./api";
import { FileBrowser } from "./files";
import { linkRefs } from "./refs";
import { fmtAgo, Icon, Link, navigate, useFeatures } from "./shared";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  EmptyState,
  Eyebrow,
  Field,
  FieldRow,
  FormStack,
  Hint,
  IconButton,
  ListRow,
  Notice,
  Page,
  Panel,
  Select,
  SideHead,
  SideList,
  SideNote,
  Tag,
  TextArea,
  TextField,
  Title,
} from "./ui";
import type { BoardSummary, Column, TaskSession, TaskSummary } from "./types";

/**
 * Boards and tasks: the work of a project (or of the whole workspace) as
 * columns of cards, each task a folder with task.md, log.md and its files
 * (src/core/boards.ts). A board is columns side by side with the tasks
 * dragged between them; a task is its page: fields, the markdown in the
 * editor, its files and its log. Workspace boards live at #/boards, a
 * project's under #/projects/<slug>/boards (projects.tsx mounts them).
 */

const DocEditor = lazy(() => import("./editor").then((m) => ({ default: m.DocEditor })));
const editorHelpers = () => import("./editor");

/** Where a board is: in a project, or at the workspace level. */
export interface BoardAt {
  project?: string;
  board: string;
}

const enc = encodeURIComponent;
/** The `?project=` a project's board needs on every call. */
const queryOf = (project?: string) => (project ? { project } : {});
export const boardHref = (at: BoardAt): string => (at.project ? `/projects/${enc(at.project)}/boards/${enc(at.board)}` : `/boards/${enc(at.board)}`);
export const taskHref = (at: BoardAt, task: string): string => `${boardHref(at)}/${enc(task)}`;

const byOrder = (a: TaskSummary, b: TaskSummary) => a.order - b.order || a.number - b.number;
const render = (md: string): string => (md.trim() ? linkRefs(DOMPurify.sanitize(marked.parse(md, { async: false }) as string)) : "");
const today = (): string => new Date().toISOString().slice(0, 10);
/** The column agents pick from (todo, else the second), and the first finished column — the same rule as the server's. */
const pickColumn = (columns: Column[]): Column | undefined => columns.find((c) => c.slug === "todo") ?? columns[1];
const doneColumn = (columns: Column[]): Column | undefined => columns.find((c) => c.done);

/* ---------- a board ---------- */

/** What a drop would do: into `status`, above `before` (null: at the end). */
type Over = { status: string; before: string | null };

export function BoardPage({ project, board }: BoardAt) {
  const at: BoardAt = { project, board };
  const query = queryOf(project);
  const data = useApi("boards.get", { board, query }, { interval: 5000 });
  // The agents, for the cards: an assignee shows as "🐻 Max", not a bare slug.
  const agents = useApi("agents.list", {}, { interval: 60_000 });
  const who = (slug: string) => (agents?.agents ?? []).find((a) => a.slug === slug);
  // The server's items, with a move shown at once; the next push takes over.
  const [local, setLocal] = useState<TaskSummary[] | null>(null);
  const serverKey = JSON.stringify(data?.items ?? null);
  useEffect(() => setLocal(null), [serverKey]);
  const items = local ?? data?.items ?? [];
  const [error, setError] = useState("");
  const [rules, setRules] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [q, setQ] = useState("");
  const [assignee, setAssignee] = useState("");
  const [tag, setTag] = useState("");
  /** null = the default: finished cards hidden when a done column holds more than 10. */
  const [showDone, setShowDone] = useState<boolean | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<Over | null>(null);

  const columns = data?.columns ?? [];
  const known = new Set(columns.map((c) => c.slug));
  const orphans = items.filter((t) => !known.has(t.status));
  const lanes: { col: Column; tasks: TaskSummary[] }[] = [
    ...columns.map((col) => ({ col, tasks: items.filter((t) => t.status === col.slug).sort(byOrder) })),
    ...(orphans.length ? [{ col: { slug: "", label: "No column" }, tasks: orphans.sort(byOrder) }] : []),
  ];
  const assignees = [...new Set(items.map((t) => t.assignee).filter((a): a is string => !!a))].sort();
  const tags = [...new Set(items.flatMap((t) => t.tags))].sort();
  const manyDone = lanes.some((l) => l.col.done && l.tasks.length > 10);
  const doneShown = showDone ?? !manyDone;
  const needle = q.trim().toLowerCase();
  const visible = (t: TaskSummary): boolean =>
    (!needle || `${t.title} ${t.slug} ${t.assignee ?? ""} ${t.tags.join(" ")}`.toLowerCase().includes(needle)) && (!assignee || t.assignee === assignee) && (!tag || t.tags.includes(tag));
  const filtering = !!needle || !!assignee || !!tag;
  const notes = useMemo(() => render(data?.notes ?? ""), [data?.notes]);

  const move = async (slug: string, status: string, before: string | null) => {
    const t = items.find((x) => x.slug === slug);
    if (!t || !status || before === slug) return;
    const lane = items.filter((x) => x.status === status && x.slug !== slug).sort(byOrder);
    const idx = before ? lane.findIndex((x) => x.slug === before) : -1;
    const next = [...lane];
    next.splice(idx < 0 ? lane.length : idx, 0, { ...t, status });
    // Onto its own place: nothing to do.
    if (t.status === status && next.map((x) => x.slug).join() === items.filter((x) => x.status === status).sort(byOrder).map((x) => x.slug).join()) return;
    const orders = new Map(next.map((x, i) => [x.slug, (i + 1) * 10]));
    setLocal(items.map((x) => (orders.has(x.slug) ? { ...x, status, order: orders.get(x.slug)! } : x)));
    setError("");
    const r = await api.request("tasks.move", { board, task: slug, query, body: { status, ...(before ? { before } : {}) } });
    if (!r.ok) {
      setError(failure(r));
      setLocal(null);
    }
  };
  const end = () => {
    setDrag(null);
    setOver(null);
  };
  /** The card: drags, and takes a drop above or below itself. */
  const cardProps = (t: TaskSummary, lane: TaskSummary[]) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", t.slug);
      setDrag(t.slug);
    },
    onDragEnd: end,
    onDragOver: (e: DragEvent) => {
      if (!drag || !t.status || !known.has(t.status)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      const lower = e.clientY > r.top + r.height / 2;
      const i = lane.findIndex((x) => x.slug === t.slug);
      const before = lower ? (lane[i + 1]?.slug ?? null) : t.slug;
      if (over?.status !== t.status || over.before !== before) setOver({ status: t.status, before });
    },
    onDrop: (e: DragEvent) => {
      if (!drag || !over) return;
      e.preventDefault();
      e.stopPropagation();
      const { status, before } = over;
      end();
      void move(drag, status, before);
    },
  });
  /** The column's body: a drop at the end. */
  const laneProps = (col: Column) => ({
    onDragOver: (e: DragEvent) => {
      if (!drag || !col.slug) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over?.status !== col.slug || over.before !== null) setOver({ status: col.slug, before: null });
    },
    onDrop: (e: DragEvent) => {
      if (!drag || !over) return;
      e.preventDefault();
      const { status, before } = over;
      end();
      void move(drag, status, before);
    },
  });
  const line = (status: string, before: string | null) =>
    drag && over && over.status === status && over.before === before ? (
      <div className="relative h-0" aria-hidden>
        <div className="absolute inset-x-1 -top-1 h-0.5 rounded-full bg-accent" />
      </div>
    ) : null;

  const remove = async () => {
    const r = await api.request("boards.delete", { board, query });
    if (!r.ok) return setError(failure(r));
    navigate(project ? `/projects/${enc(project)}` : "/boards", { replace: true });
  };

  if (!data) return <EmptyState>loading…</EmptyState>;

  return (
    <div className="chat-main flex min-h-0 flex-col gap-3">
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2">
        <Icon name="view_kanban" className="text-[26px] text-fg-2" />
        <Title>{data.title}</Title>
        <Tag title="tasks on the board">{data.tasks} {data.tasks === 1 ? "task" : "tasks"}</Tag>
        <Badge n={data.review} title="waiting for review" />
        {data.agent && <Tag tone="accent" title="tasks entering todo without an assignee go to this agent">→ {data.agent}</Tag>}
        <span className="flex-1" />
        {data.notes.trim() && (
          <Button size="sm" variant="quiet" icon={rules ? "expand_less" : "gavel"} aria-expanded={rules} onClick={() => setRules((v) => !v)}>
            rules
          </Button>
        )}
        <IconButton size="sm" icon="settings" label="board settings: columns, default agent, rules" href={`${boardHref(at)}/settings`} />
        {!project &&
          (confirmRemove ? (
            <>
              <Button size="sm" variant="danger" onClick={() => void remove()}>move to trash</Button>
              <Button size="sm" variant="quiet" onClick={() => setConfirmRemove(false)}>cancel</Button>
            </>
          ) : (
            <IconButton size="sm" icon="delete" label="move the board, tasks and all, to the trash" onClick={() => setConfirmRemove(true)} />
          ))}
      </div>
      {data.configError && <Notice tone="bad">board.md: {data.configError} — the columns show defaults; fix the file by hand.</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {rules && (
        <Panel title="rules" className="flex-none">
          {notes ? <div className="md-body px-[18px] py-3 text-sm" dangerouslySetInnerHTML={{ __html: notes }} /> : <Hint className="px-[18px] py-3">no rules yet — the body of board.md</Hint>}
        </Panel>
      )}

      <div className="flex flex-none flex-wrap items-center gap-2">
        <TextField value={q} className="h-8 w-auto min-w-[180px] text-sm" placeholder="filter tasks…" aria-label="filter tasks" onChange={(e) => setQ(e.target.value)} />
        {assignees.length > 0 && (
          <Select className="h-8 w-auto text-sm" value={assignee} aria-label="assignee" onChange={(e) => setAssignee(e.target.value)}>
            <option value="">anyone</option>
            {assignees.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
        )}
        {tags.length > 0 && (
          <Select className="h-8 w-auto text-sm" value={tag} aria-label="tag" onChange={(e) => setTag(e.target.value)}>
            <option value="">any tag</option>
            {tags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        )}
        {filtering && (
          <Button size="sm" variant="quiet" icon="close" onClick={() => { setQ(""); setAssignee(""); setTag(""); }}>
            clear
          </Button>
        )}
        <span className="flex-1" />
        {lanes.some((l) => l.col.done && l.tasks.length > 0) && (
          <Checkbox checked={doneShown} onChange={setShowDone} className="text-xs">show finished</Checkbox>
        )}
      </div>

      {/* The columns side by side; a narrow window scrolls them sideways. */}
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto overflow-y-hidden pb-2">
        {lanes.map(({ col, tasks }) => {
          const shown = col.done && !doneShown ? [] : tasks.filter(visible);
          const exceeded = col.limit !== undefined && tasks.length > col.limit;
          return (
            <section key={col.slug || "~"} className="flex max-h-full min-w-[208px] max-w-[360px] flex-1 basis-0 flex-col rounded-card border border-line bg-surface-2" aria-label={col.label} data-column={col.slug || undefined}>
              <div className="flex flex-none items-center gap-2 px-3 pt-2.5 pb-1.5">
                <Eyebrow className="truncate text-fg">{col.label}</Eyebrow>
                <span className={cn("text-2xs font-semibold tabular-nums", exceeded ? "rounded-full bg-ask-soft px-1.5 text-on-ask-soft" : "text-fg-2")} title={col.limit !== undefined ? `${tasks.length} of a limit of ${col.limit}` : `${tasks.length} tasks`}>
                  {tasks.length}
                  {col.limit !== undefined && `/${col.limit}`}
                </span>
                {col.review && <Icon name="rate_review" className="ms-sm text-fg-2" />}
                {col.done && <Icon name="check_circle" className="ms-sm text-fg-2" />}
              </div>
              <div className="flex min-h-[48px] flex-col gap-1.5 overflow-y-auto px-2 pb-1" {...laneProps(col)}>
                {shown.map((t) => (
                  <Fragment key={t.slug}>
                    {line(col.slug, t.slug)}
                    <TaskCard at={at} task={t} agent={t.assignee ? who(t.assignee) : undefined} dragging={drag === t.slug} {...cardProps(t, tasks)} />
                  </Fragment>
                ))}
                {line(col.slug, null)}
                {col.done && !doneShown && tasks.length > 0 && <SideNote className="px-1 py-1.5">{tasks.length} finished, hidden</SideNote>}
                {/* While dragging, room to drop under the last card. */}
                {drag && <div className="h-6" />}
              </div>
              {col.slug && !data.configError && <AddTask at={at} status={col.slug} onError={setError} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** One card of the board: the title (a link to the task), its number, who (always: an unassigned task says so), when, files, tags and the last line of its log. */
function TaskCard({ at, task: t, agent, dragging, ...drag }: { at: BoardAt; task: TaskSummary; agent?: { name: string; emoji: string }; dragging: boolean } & Record<string, unknown>) {
  const overdue = !!t.due && t.due.slice(0, 10) < today();
  return (
    <article
      {...drag}
      className={cn("flex cursor-grab flex-col gap-1 rounded-card border border-line bg-surface px-2.5 py-2 active:cursor-grabbing", dragging && "opacity-40")}
      data-task={t.slug}
    >
      <div className="flex items-start gap-2">
        <Link href={taskHref(at, t.slug)} className="min-w-0 flex-1 text-sm font-medium leading-snug text-fg no-underline [overflow-wrap:anywhere] hover:underline">
          {t.title}
        </Link>
        <span className="flex-none font-mono text-2xs text-fg-2">#{t.number}</span>
      </div>
      {t.configError && <span className="text-2xs text-bad">unreadable frontmatter</span>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-2">
        {t.assignee ? (
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-surface-2 px-1.5 font-medium text-fg" title={`assigned to ${agent ? `${agent.name} (${t.assignee})` : t.assignee}`}>
            {agent?.emoji ? <span aria-hidden>{agent.emoji}</span> : <Icon name="person" className="ms-sm text-[13px]" />}
            {agent?.name ?? t.assignee}
          </span>
        ) : (
          <span className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-fg-2 ring-1 ring-inset ring-line" title="nobody is assigned">
            <Icon name="person_off" className="ms-sm text-[13px]" /> unassigned
          </span>
        )}
        {t.due && (
          <span className={cn("inline-flex items-center gap-0.5", overdue && "text-bad")} title={overdue ? "overdue" : "due"}>
            <Icon name="event" className="ms-sm text-[13px]" /> {t.due}
          </span>
        )}
        {t.files > 0 && (
          <span className="inline-flex items-center gap-0.5" title="files in the task folder">
            <Icon name="attach_file" className="ms-sm text-[13px]" /> {t.files}
          </span>
        )}
        {t.stale && <Tag tone="ask" title="assigned, in a work column, and nothing logged for a while">stale</Tag>}
      </div>
      {t.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {t.tags.map((x) => (
            <Tag key={x}>{x}</Tag>
          ))}
        </div>
      )}
      {t.lastLog && (
        <div className="truncate text-2xs text-fg-2 opacity-80" title={t.lastLog}>
          {t.lastLog}
        </div>
      )}
    </article>
  );
}

/** "+ task" under a column: a title, Enter creates it there, the field stays for the next. */
function AddTask({ at, status, onError }: { at: BoardAt; status: string; onError: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const r = await api.request("tasks.create", { board: at.board, query: queryOf(at.project), body: { title: t, status } });
    setBusy(false);
    if (!r.ok) return onError(failure(r));
    onError("");
    setTitle("");
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
        aria-label={`new task in ${status}`}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void create();
          }
          if (e.key === "Escape") {
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => !title.trim() && setOpen(false)}
      />
      <IconButton size="sm" icon="close" label="close" onClick={() => { setOpen(false); setTitle(""); }} />
    </div>
  );
}

/* ---------- a task ---------- */

interface LogLine {
  day: string;
  time: string;
  text: string;
  actor?: string;
}

/** log.md (`## YYYY-MM-DD` days, `* HH:MM text (actor)` lines, newest first) as a list. */
const REF_ICONS: Record<string, string> = { presentations: "slideshow", contacts: "person", places: "location_on", events: "event", projects: "folder", knowledge: "menu_book", workflows: "account_tree", agents: "smart_toy", repos: "source", vibeables: "web", boards: "view_kanban", tasks: "task_alt" };

/**
 * What the task points at (its `refs:` — presentation:town-hall, contact:anna-meier …): one chip per
 * target opening its page, a missing one struck through; decks are linked from a list of them. The
 * agent working the task gets the same list in its context (taskContext), a deck with its folder.
 */
function TaskLinks({ refs, busy, onChange }: { refs: string[]; busy: boolean; onChange: (refs: string[]) => void }) {
  const features = useFeatures();
  const decks = useApi("presentations.list", features.presentations ? { query: { all: "1" } } : null, { interval: 30_000 });
  const [resolved, setResolved] = useState<{ kind: string; token: string; found: boolean; label?: string; href: string }[]>([]);
  const key = refs.join(",");
  useEffect(() => {
    if (!refs.length) return setResolved([]);
    let alive = true;
    void api.request("refs.resolve", { body: { tokens: refs } }).then((r) => alive && r.ok && setResolved(r.data.refs));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const unlinked = (decks?.presentations ?? []).filter((d) => !refs.includes(`presentation:${d.name}`));
  if (!refs.length && !features.presentations) return null;
  return (
    <Field label="links" hint="what this task is about: its agent gets them with the task">
      <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label="links">
        {refs.map((token) => {
          const r = resolved.find((x) => x.token === token);
          return (
            <span key={token} role="listitem" className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2 pr-1 text-xs">
              <Icon name={REF_ICONS[r?.kind ?? ""] ?? "link"} className="ms-sm text-fg-2" />
              {r?.found ? (
                <Link href={r.href} className="min-w-0 truncate text-fg no-underline hover:underline" title={token}>
                  {r.label || token}
                </Link>
              ) : (
                <span className={cn("min-w-0 truncate", r && "text-fg-2 line-through")} title={r ? `${token} — not found` : token}>{token}</span>
              )}
              <IconButton icon="close" label={`unlink ${token}`} size="sm" disabled={busy} onClick={() => onChange(refs.filter((x) => x !== token))} />
            </span>
          );
        })}
        {features.presentations && unlinked.length > 0 && (
          <Select value="" aria-label="link a presentation" className="h-7 w-auto text-xs" disabled={busy} onChange={(e) => e.target.value && onChange([...refs, e.target.value])}>
            <option value="">+ link a presentation…</option>
            {unlinked.map((d) => (
              <option key={`${d.project ?? ""}/${d.name}`} value={`presentation:${d.name}`}>
                {d.title}{d.project ? ` · ${d.project}` : ""}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Field>
  );
}

export function parseLog(md: string): LogLine[] {
  const out: LogLine[] = [];
  let day = "";
  for (const line of md.split("\n")) {
    const h = /^##\s+(\S+)/.exec(line);
    if (h) {
      day = h[1];
      continue;
    }
    const m = /^[*-]\s+(\d{1,2}:\d{2})\s+(.*)$/.exec(line);
    if (!m) continue;
    let text = m[2].trim();
    let actor: string | undefined;
    const a = /\s\(([^()]+)\)$/.exec(text);
    if (a) {
      actor = a[1];
      text = text.slice(0, a.index).trim();
    }
    out.push({ day, time: m[1], text, ...(actor ? { actor } : {}) });
  }
  return out;
}

export function TaskPage({ project, board, task }: BoardAt & { task: string }) {
  const at: BoardAt = { project, board };
  const query = queryOf(project);
  const detail = useApi("tasks.get", { board, task, query }, { interval: 5000 });
  const boardData = useApi("boards.get", { board, query }, { interval: 15_000 });
  const agents = useApi("agents.list", {}, { interval: 30_000 });
  const columns = boardData?.columns ?? [];
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** A line for the log, sent with the next status or assignee change. */
  const [message, setMessage] = useState("");
  // Edited in place; null = showing the server's value.
  const [title, setTitle] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [tags, setTags] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [filesAt, setFilesAt] = useState<{ dir: string; file?: string }>({ dir: "" });

  const save = async (body: { title?: string; status?: string; assignee?: string | null; due?: string | null; tags?: string[]; refs?: string[] }) => {
    setBusy(true);
    setError("");
    const msg = message.trim();
    const r = await api.request("tasks.save", { board, task, query, body: { ...body, ...(msg && (body.status || body.assignee !== undefined) ? { message: msg } : {}) } });
    setBusy(false);
    if (!r.ok) return setError(failure(r));
    if (msg && (body.status || body.assignee !== undefined)) setMessage("");
  };
  const move = async (status: string, msg?: string) => {
    setBusy(true);
    setError("");
    const r = await api.request("tasks.move", { board, task, query, body: { status, ...(msg ? { message: msg } : {}) } });
    setBusy(false);
    if (!r.ok) return setError(failure(r));
    setMessage("");
  };
  const log = async () => {
    const entry = comment.trim();
    if (!entry) return;
    setBusy(true);
    setError("");
    const r = await api.request("tasks.log", { board, task, query, body: { entry } });
    setBusy(false);
    if (!r.ok) return setError(failure(r));
    setComment("");
  };
  const remove = async () => {
    const r = await api.request("tasks.delete", { board, task, query });
    if (!r.ok) return setError(failure(r));
    navigate(boardHref(at), { replace: true });
  };
  /** A chat in the project (Ralv for a workspace board) whose first message points the agent at the task. */
  const workOn = async () => {
    if (!detail) return;
    setBusy(true);
    setError("");
    const scope = project ? { kind: "project", slug: project } : { kind: "general" };
    // Tagged with the task: the chat gets the task block in its context and shows up in the task's sessions.
    const r = await api.request("chats.create", { body: { agent: "claude", scope, task: detail.ref } });
    if (!r.ok) {
      setBusy(false);
      return setError(failure(r));
    }
    const id = r.data.id;
    const show = `npx kraftwerk tasks show ${detail.number}${project ? ` --project ${project}` : ""} --board ${board}`;
    const text = `Work on task ${detail.number} ${detail.title} (task:${detail.slug} on board ${board}): read it with \`${show}\``;
    const m = await api.request("chats.message", { id, body: { text } });
    setBusy(false);
    if (!m.ok) return setError(failure(m));
    navigate(project ? `/projects/${enc(project)}/chat/${id}` : `/agents/chats/${id}`);
  };

  /* The notes in the editor, saved ~1 s after the last change (knowledge.tsx does the same for a page). */
  const [doc, setDoc] = useState<{ key: number; body: string } | null>(null);
  const [state, setState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [markdown, setMarkdown] = useState<string | null>(null);
  const lastNotesRef = useRef<string | null>(null);
  const latestRef = useRef<string | null>(null);
  const touchedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const notes = detail?.notes;
  useEffect(() => {
    if (notes === undefined || notes === lastNotesRef.current || latestRef.current !== null || savingRef.current || markdown !== null) return;
    let alive = true;
    void editorHelpers().then(({ unwrapParagraphs }) => {
      if (!alive) return;
      lastNotesRef.current = notes;
      touchedRef.current = false;
      setDoc((d) => ({ key: (d?.key ?? 0) + 1, body: unwrapParagraphs(notes) }));
    });
    return () => {
      alive = false;
    };
  }, [notes, markdown]);
  async function flush(): Promise<void> {
    if (savingRef.current) await savingRef.current;
    const body = latestRef.current;
    if (body === null) return;
    latestRef.current = null;
    setState("saving");
    const run = (async () => {
      const r = await api.request("tasks.save", { board, task, query, body: { notes: body }, keepalive: true });
      if (r.ok) {
        lastNotesRef.current = r.data.notes;
        setError("");
        setState(latestRef.current === null ? "saved" : "unsaved");
      } else {
        setError(failure(r));
        setState("error");
        if (latestRef.current === null) latestRef.current = body;
      }
    })();
    savingRef.current = run;
    await run;
    savingRef.current = null;
  }
  function schedule(body: string): void {
    if (!touchedRef.current) return;
    latestRef.current = body;
    setState("unsaved");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), 1000);
  }
  useEffect(() => {
    const onUnload = () => {
      if (latestRef.current !== null) void flush();
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (latestRef.current !== null) void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** The whole file's body as text, with an explicit save (what the editor cannot show). */
  const saveMarkdown = async () => {
    if (markdown === null) return;
    setBusy(true);
    const r = await api.request("tasks.save", { board, task, query, body: { notes: markdown } });
    setBusy(false);
    if (!r.ok) return setError(failure(r));
    lastNotesRef.current = null; // the editor restarts from the saved text
    setMarkdown(null);
  };

  const lines = useMemo(() => parseLog(detail?.log ?? ""), [detail?.log]);
  const sessions: TaskSession[] = detail?.sessions ?? [];
  // A log actor is "<agent>/<harness>" for an agent's session, "kraftwerk-chat/<harness>" for a project chat; the newest session of that agent is where it worked.
  const sessionOf = (actor: string): TaskSession | undefined => {
    const [slug, harness] = actor.split("/");
    return sessions.find((s) => s.agent === slug) ?? (slug === "kraftwerk-chat" && harness ? sessions.find((s) => s.agent === harness) : undefined);
  };
  const team = (agents?.agents ?? []).filter((a) => !a.archived);

  if (!detail) return <EmptyState>loading…</EmptyState>;
  const pick = pickColumn(columns);
  const done = doneColumn(columns);
  const column = columns.find((c) => c.slug === detail.status);
  const commit = (field: "title" | "due" | "tags", value: string | null) => {
    if (value === null) return;
    if (field === "title") {
      const t = value.trim();
      if (t && t !== detail.title) void save({ title: t });
      setTitle(null);
    } else if (field === "due") {
      const d = value.trim();
      if (d !== (detail.due ?? "")) void save({ due: d || null });
      setDue(null);
    } else {
      const list = value.split(",").map((x) => x.trim()).filter(Boolean);
      if (list.join(",") !== detail.tags.join(",")) void save({ tags: list });
      setTags(null);
    }
  };
  const onEnter = (fn: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fn();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="chat-main flex min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2">
        <Link href={boardHref(at)} className="inline-flex items-center gap-1 text-sm text-fg-2 no-underline hover:text-fg" title="back to the board">
          <Icon name="arrow_back" className="ms-sm" /> {boardData?.title ?? board}
        </Link>
        <span className="font-mono text-sm text-fg-2">#{detail.number}</span>
        <TextField
          value={title ?? detail.title}
          aria-label="task title"
          className="h-auto min-w-[240px] flex-1 border-0 bg-transparent px-0 text-xl font-semibold shadow-none"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => commit("title", title)}
          onKeyDown={onEnter(() => commit("title", title))}
        />
      </div>
      <div className="flex flex-none flex-wrap items-center gap-2 text-sm text-fg-2">
        <code className="font-mono text-xs">task:{detail.slug}</code>
        <span>created {detail.created}</span>
        {detail.updatedAt && <span>· changed {fmtAgo(detail.updatedAt)}</span>}
        {detail.stale && <Tag tone="ask">stale</Tag>}
        {detail.configError && <Tag tone="bad" title={detail.configError}>unreadable frontmatter</Tag>}
      </div>
      {sessions.length > 0 && (
        <div className="flex flex-none flex-wrap items-center gap-2 text-sm text-fg-2" aria-label="sessions">
          <span>worked on in</span>
          {sessions.map((s) => (
            <Link key={s.id} href={s.href} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-fg no-underline hover:bg-surface-2" title={s.title || s.id}>
              {s.emoji && <span>{s.emoji}</span>}
              {s.name ?? s.agent}
              <span className="text-fg-2">· {s.busy ? "working" : fmtAgo(s.updatedAt)}</span>
            </Link>
          ))}
        </div>
      )}
      {error && <Notice tone="bad">{error}</Notice>}

      {/* Two columns on a wide screen: the task (fields, text, files) left, the log right — the log is what agents and people keep reading. */}
      <div className="grid flex-none grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <Panel title="task" className="flex-none" actions={state !== "saved" && <span className={cn("text-xs", state === "error" ? "text-bad" : "text-fg-2")}>{state === "saving" ? "saving…" : state === "unsaved" ? "unsaved" : "not saved"}</span>}>
        <FormStack className="pb-3">
          <FieldRow>
            <Field label="status">
              <Select value={column ? detail.status : ""} aria-label="status" disabled={busy || !columns.length} onChange={(e) => e.target.value && void save({ status: e.target.value })}>
                {!column && <option value="">{detail.status || "no column"}</option>}
                {columns.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="assignee">
              <Select value={detail.assignee ?? ""} aria-label="assignee" disabled={busy} onChange={(e) => void save({ assignee: e.target.value || null })}>
                <option value="">unassigned</option>
                {detail.assignee && !team.some((a) => a.slug === detail.assignee) && <option value={detail.assignee}>{detail.assignee}</option>}
                {team.map((a) => (
                  <option key={a.slug} value={a.slug}>{a.emoji ? `${a.emoji} ` : ""}{a.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="due">
              <TextField type="date" value={due ?? detail.due ?? ""} aria-label="due date" className="w-auto" onChange={(e) => setDue(e.target.value)} onBlur={() => commit("due", due)} onKeyDown={onEnter(() => commit("due", due))} />
            </Field>
            <Field label="tags" className="flex-1">
              <TextField value={tags ?? detail.tags.join(", ")} placeholder="comma-separated" aria-label="tags" onChange={(e) => setTags(e.target.value)} onBlur={() => commit("tags", tags)} onKeyDown={onEnter(() => commit("tags", tags))} />
            </Field>
          </FieldRow>
          <TaskLinks refs={detail.refs} busy={busy} onChange={(refs) => void save({ refs })} />
          <Field label="note for the log" hint="sent with the next status or assignee change">
            <TextField value={message} placeholder="why, or what to look at (optional)" aria-label="note for the log" onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <FieldRow>
            <Button variant="primary" icon="chat" busy={busy} onClick={() => void workOn()} title={project ? "start a chat in the project about this task" : "start a chat with Ralv about this task"}>
              work on this
            </Button>
            {pick && detail.status !== pick.slug && (
              <Button
                icon="undo"
                disabled={busy}
                onClick={() => {
                  const msg = message.trim() || (window.prompt(`Back to ${pick.label} — a line for the log (optional)`, "") ?? "");
                  void move(pick.slug, msg.trim() || undefined);
                }}
              >
                back to {pick.label}
              </Button>
            )}
            {done && detail.status !== done.slug && (
              <Button icon="check" disabled={busy} onClick={() => void move(done.slug, message.trim() || undefined)}>
                {done.label.toLowerCase()}
              </Button>
            )}
            <span className="flex-1" />
            {confirmRemove ? (
              <>
                <Button variant="danger" onClick={() => void remove()}>move to trash</Button>
                <Button variant="quiet" onClick={() => setConfirmRemove(false)}>cancel</Button>
              </>
            ) : (
              <Button variant="quiet" icon="delete" title="move the task folder to the trash" onClick={() => setConfirmRemove(true)}>
                remove
              </Button>
            )}
          </FieldRow>
        </FormStack>
        {markdown !== null ? (
          <div className="border-t border-line">
            <TextArea value={markdown} aria-label="task markdown" rows={14} className="rounded-none border-0 font-mono text-[13px]" onChange={(e) => setMarkdown(e.target.value)} />
            <div className="flex items-center gap-2 border-t border-line px-[18px] py-2">
              <Button size="sm" variant="primary" busy={busy} onClick={() => void saveMarkdown()}>save</Button>
              <Button size="sm" variant="quiet" onClick={() => { setMarkdown(null); lastNotesRef.current = null; }}>cancel</Button>
              <Hint>the body of task.md as text; the frontmatter (status, assignee, …) is the fields above</Hint>
            </div>
          </div>
        ) : (
          <div
            className="task-doc border-t border-line"
            onPointerDownCapture={() => (touchedRef.current = true)}
            onKeyDownCapture={() => (touchedRef.current = true)}
            onPasteCapture={() => (touchedRef.current = true)}
            onDropCapture={() => (touchedRef.current = true)}
          >
            {doc ? (
              <Suspense fallback={<Hint className="px-[18px] py-2">loading the editor…</Hint>}>
                <DocEditor key={doc.key} markdown={doc.body} autoFocus={false} onChange={schedule} onError={() => setMarkdown(detail.notes)} />
              </Suspense>
            ) : (
              <Hint className="px-[18px] py-2">loading…</Hint>
            )}
            <div className="flex items-center gap-2 px-[18px] py-1.5">
              <Hint className="flex-1">what the task is, saved as you type</Hint>
              <Button size="sm" variant="quiet" icon="code" onClick={() => setMarkdown(detail.notes)}>
                markdown
              </Button>
            </div>
          </div>
        )}
      </Panel>

        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0">
      <Panel title="files" className="flex-none" actions={<Hint>the task's folder: drop files on the list</Hint>}>
        <div className="px-2 py-1">
          <FileBrowser key={detail.ref} compact scope={`task:${detail.ref}`} dir={filesAt.dir} file={filesAt.file} onOpen={(dir, file) => setFilesAt({ dir, file })} />
        </div>
      </Panel>

        <Panel title="log" className="min-w-0 flex-none">
        <div className="flex items-center gap-2 px-[18px] pt-3">
          <TextField value={comment} placeholder="a comment, a question, what was done…" aria-label="log entry" disabled={busy} onChange={(e) => setComment(e.target.value)} onKeyDown={onEnter(() => void log())} />
          <Button size="sm" icon="send" busy={busy} disabled={!comment.trim()} onClick={() => void log()}>
            log
          </Button>
        </div>
        {lines.length === 0 ? (
          <Hint className="px-[18px] py-3">nothing logged yet</Hint>
        ) : (
          <ol className="m-0 flex list-none flex-col px-[18px] py-3">
            {lines.map((l, i) => (
              <Fragment key={i}>
                {(i === 0 || lines[i - 1].day !== l.day) && <Eyebrow className={cn("pb-1", i > 0 && "pt-3")}>{l.day}</Eyebrow>}
                <li className="flex items-baseline gap-3 border-l border-line py-1 pl-3 text-sm">
                  <span className="w-11 flex-none font-mono text-2xs text-fg-2">{l.time}</span>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{l.text}</span>
                  {l.actor &&
                    (() => {
                      const s = sessionOf(l.actor);
                      return s ? (
                        <Link href={s.href} className="flex-none text-2xs text-fg-2 underline decoration-dotted hover:text-fg" title={`open the session ${s.name ?? s.agent} worked in`}>
                          {l.actor}
                        </Link>
                      ) : (
                        <span className="flex-none text-2xs text-fg-2">{l.actor}</span>
                      );
                    })()}
                </li>
              </Fragment>
            ))}
          </ol>
        )}
      </Panel>
        </div>
      </div>
    </div>
  );
}

/* ---------- board settings ---------- */

type ColumnRow = { slug: string; label: string; limit: string; review: boolean; done: boolean };

export function BoardSettings({ project, board }: BoardAt) {
  const at: BoardAt = { project, board };
  const query = queryOf(project);
  const agents = useApi("agents.list", {}, { interval: 30_000 });
  const [loaded, setLoaded] = useState<BoardSummary | null>(null);
  const [gone, setGone] = useState("");
  const [title, setTitle] = useState("");
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [agent, setAgent] = useState("");
  const [staleAfter, setStaleAfter] = useState("");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.request("boards.get", { board, query }).then((r) => {
      if (!alive) return;
      if (!r.ok) return setGone(failure(r));
      const d = r.data;
      setLoaded(d);
      setTitle(d.title);
      setColumns(d.columns.map((c) => ({ slug: c.slug, label: c.label, limit: c.limit === undefined ? "" : String(c.limit), review: !!c.review, done: !!c.done })));
      setAgent(d.agent ?? "");
      setStaleAfter(d.staleAfter ?? "");
      setNotes(d.notes);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, project]);

  const touch = () => {
    setDirty(true);
    setSaved(false);
    setError("");
  };
  const setCol = (i: number, patch: Partial<ColumnRow>) => {
    setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    touch();
  };
  const moveCol = (i: number, d: -1 | 1) => {
    setColumns((cs) => {
      const j = i + d;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    touch();
  };
  const save = async () => {
    setSaving(true);
    setError("");
    const body = {
      title: title.trim(),
      columns: columns.map((c) => ({
        slug: c.slug.trim(),
        label: c.label.trim() || c.slug.trim(),
        ...(c.limit.trim() ? { limit: Number(c.limit) } : {}),
        ...(c.review ? { review: true } : {}),
        ...(c.done ? { done: true } : {}),
      })),
      agent: agent || null,
      staleAfter: staleAfter.trim() || null,
      notes,
    };
    const r = await api.request("boards.save", { board, query, body });
    setSaving(false);
    if (!r.ok) return setError(failure(r));
    setLoaded(r.data);
    setDirty(false);
    setSaved(true);
  };

  if (gone) return <EmptyState icon="view_kanban">{gone}</EmptyState>;
  if (!loaded) return <EmptyState>loading…</EmptyState>;
  const team = (agents?.agents ?? []).filter((a) => !a.archived);

  return (
    <div className="chat-main flex min-h-0 flex-col gap-3 overflow-y-auto">
      <Page className="animate-none">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={boardHref(at)} className="inline-flex items-center gap-1 text-sm text-fg-2 no-underline hover:text-fg">
            <Icon name="arrow_back" className="ms-sm" /> {loaded.title}
          </Link>
          <Title>board settings</Title>
          <span className="flex-1" />
          {error && <span className="text-sm text-bad">{error}</span>}
          {saved && !dirty && <span className="text-sm text-fg-2">saved</span>}
          <Button variant="primary" icon="save" busy={saving} disabled={!dirty || saving || !title.trim() || columns.length === 0} onClick={() => void save()}>
            save
          </Button>
        </div>
        {loaded.configError && <Notice tone="bad">board.md: {loaded.configError} — the values below are defaults; saving overwrites the file.</Notice>}

        <Panel title="board">
          <FormStack className="max-w-[760px]">
            <Field label="title">
              <TextField value={title} aria-label="board title" onChange={(e) => { setTitle(e.target.value); touch(); }} />
            </Field>
            <FieldRow>
              <Field label="default agent" hint="a task entering the pick column without an assignee goes to this agent, which is woken" className="flex-1">
                <Select value={agent} aria-label="default agent" onChange={(e) => { setAgent(e.target.value); touch(); }}>
                  <option value="">none</option>
                  {agent && !team.some((a) => a.slug === agent) && <option value={agent}>{agent}</option>}
                  {team.map((a) => (
                    <option key={a.slug} value={a.slug}>{a.emoji ? `${a.emoji} ` : ""}{a.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="stale after" hint="a task in a work column with nothing logged for this long is marked stale (default 1d)">
                <TextField value={staleAfter} placeholder="1d" aria-label="stale after" className="w-[120px]" onChange={(e) => { setStaleAfter(e.target.value); touch(); }} />
              </Field>
            </FieldRow>
          </FormStack>
        </Panel>

        <Panel title="columns" actions={<Button size="sm" variant="quiet" icon="add" onClick={() => { setColumns((cs) => [...cs, { slug: "", label: "", limit: "", review: false, done: false }]); touch(); }}>column</Button>}>
          <div className="flex flex-col divide-y divide-line">
            {columns.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 px-[18px] py-2" data-column-row={i}>
                <TextField value={c.slug} placeholder="slug" aria-label={`column ${i + 1} slug`} className="h-8 w-[130px] font-mono text-xs" onChange={(e) => setCol(i, { slug: e.target.value })} />
                <TextField value={c.label} placeholder="label" aria-label={`column ${i + 1} label`} className="h-8 w-[160px] text-sm" onChange={(e) => setCol(i, { label: e.target.value })} />
                <TextField value={c.limit} placeholder="limit" inputMode="numeric" aria-label={`column ${i + 1} limit`} className="h-8 w-[70px] text-sm" onChange={(e) => setCol(i, { limit: e.target.value.replace(/\D/g, "") })} />
                <Checkbox checked={c.review} onChange={(on) => setCol(i, { review: on })} className="text-xs">review</Checkbox>
                <Checkbox checked={c.done} onChange={(on) => setCol(i, { done: on })} className="text-xs">done</Checkbox>
                <span className="flex-1" />
                <IconButton size="sm" icon="arrow_upward" label={`move column ${c.label || c.slug || i + 1} up`} disabled={i === 0} onClick={() => moveCol(i, -1)} />
                <IconButton size="sm" icon="arrow_downward" label={`move column ${c.label || c.slug || i + 1} down`} disabled={i === columns.length - 1} onClick={() => moveCol(i, 1)} />
                <IconButton size="sm" icon="close" label={`remove column ${c.label || c.slug || i + 1}`} onClick={() => { setColumns((cs) => cs.filter((_, j) => j !== i)); touch(); }} />
              </div>
            ))}
          </div>
          <Hint className="px-[18px] py-3">
            In order, left to right. The first column is where drafts sit; agents pick from <code>todo</code> (else the second column); a <b>review</b> column waits for a human and counts as attention; a <b>done</b> column is finished work. Tasks in a removed column keep their status and show under "No column".
          </Hint>
        </Panel>

        <Panel title="rules">
          <FormStack>
            <TextArea value={notes} aria-label="rules" rows={8} className="font-mono text-[13px]" placeholder="What the board is for and the rules agents follow — Markdown, the body of board.md" onChange={(e) => { setNotes(e.target.value); touch(); }} />
            <Hint>
              Everything here is <code>board.md</code> in <code title={loaded.path}>{loaded.path}</code>: frontmatter (title, columns, agent, stale_after) and these rules as its body. The file can be edited by hand just as well.
            </Hint>
          </FormStack>
        </Panel>
      </Page>
    </div>
  );
}

/* ---------- workspace boards ---------- */

/** #/boards, #/boards/new, #/boards/<board>, #/boards/<board>/settings, #/boards/<board>/<task>. */
/**
 * The boards page: the workspace's boards (#/boards/…) or a project's
 * (#/projects/<slug>/boards/…) — a full-width page either way, since a
 * board needs the room its columns take. Left: the boards of this place;
 * right: the board, a task or the board's settings.
 */
export function BoardsScreen({ seg, project }: { seg: string[]; project?: string }) {
  const board = seg[0] && seg[0] !== "new" ? decodeURIComponent(seg[0]) : undefined;
  const creating = seg[0] === "new";
  const sub = seg[1] ? decodeURIComponent(seg[1]) : undefined;
  const data = useApi("boards.list", project ? { query: { project } } : {}, { interval: 10_000 });
  const boards = data?.boards ?? [];
  const base = project ? `/projects/${enc(project)}/boards` : "/boards";
  const at = (b: string): BoardAt => ({ ...(project ? { project } : {}), board: b });

  let main: React.ReactNode;
  if (data && !data.enabled)
    main = (
      <EmptyState icon="view_kanban">
        {data.error && !/are off/.test(data.error) ? <span className="text-bad">{data.error}</span> : <>Boards are off. Turn them on in <a href="#/settings">settings</a> or add a <code>boards:</code> block to kraftwerk.yml.</>}
      </EmptyState>
    );
  else if (!data) main = <EmptyState>loading…</EmptyState>;
  else if (data.error) main = <EmptyState icon="view_kanban"><span className="text-bad">{data.error}</span></EmptyState>;
  else if (creating) main = <NewBoard root={data.root} project={project} />;
  else if (!board && project) main = boards.length === 0 ? <ProjectBoardsLanding slug={project} /> : <Redirect to={boardHref(at(boards[0].board))} />;
  else if (!board && boards.length === 0) main = <NewBoard root={data.root} />;
  else if (board && sub === "settings") main = <BoardSettings key={`${project ?? ""}/${board}/settings`} {...at(board)} />;
  else if (board && sub) main = <TaskPage key={`${project ?? ""}/${board}/${sub}`} {...at(board)} task={sub} />;
  else if (board) main = <BoardPage key={`${project ?? ""}/${board}`} {...at(board)} />;
  else
    main = (
      <EmptyState icon="view_kanban" action={<Button variant="primary" icon="add" href={`${base}/new`}>new board</Button>}>
        Workspace boards: the work that belongs to no project, as columns of tasks. A project's boards live with the project.
      </EmptyState>
    );

  return (
    <div className="runs-screen">
      <aside className="runs-side">
        <SideHead title={project ? `${project} · boards` : "boards"} count={data?.enabled ? boards.length : undefined} action={data?.enabled && <Button size="sm" variant="quiet" icon="add" href={`${base}/new`}>new</Button>} />
        <SideList label="boards">
          {boards.map((b) => (
            <ListRow
              key={b.board}
              href={boardHref(at(b.board))}
              active={b.board === board}
              size="sm"
              leading={<Icon name="view_kanban" className="ms-sm" />}
              title={b.title}
              titleExtra={<Badge n={b.review} title="waiting for review" />}
              sub={b.configError ? "unreadable board.md" : `${b.tasks} ${b.tasks === 1 ? "task" : "tasks"}`}
              subTone={b.configError ? "bad" : "plain"}
              meta={b.updatedAt && <span title={b.updatedAt}>{fmtAgo(b.updatedAt)}</span>}
            />
          ))}
          {data && !data.enabled && <SideNote>{data.error}</SideNote>}
          {data?.enabled && boards.length === 0 && <SideNote>no {project ? "" : "workspace "}boards yet</SideNote>}
          {project && (
            <SideNote>
              <Link href={`/projects/${enc(project)}`} className="text-accent">← back to the project</Link>
            </SideNote>
          )}
        </SideList>
      </aside>
      <div className="runs-main">{main}</div>
    </div>
  );
}

/** Go somewhere else as soon as this renders (a bare boards route that has a board to show). */
function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return <EmptyState>opening the board…</EmptyState>;
}

function NewBoard({ root, project }: { root?: string; project?: string }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    const r = await api.request("boards.create", { body: { title: t, ...(project ? { project } : {}) } });
    setBusy(false);
    if (!r.ok) return setError(failure(r));
    navigate(boardHref({ ...(project ? { project } : {}), board: r.data.board }), { replace: true });
  };
  return (
    <Page>
      <div className="flex items-center gap-3">
        <Icon name="view_kanban" className="text-[26px] text-fg-2" />
        <Title>new board</Title>
      </div>
      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <FormStack className="max-w-[680px]">
            <Field label="title">
              <TextField value={title} aria-label="board title" autoFocus placeholder="e.g. Marketing" onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <FieldRow>
              <Button variant="primary" type="submit" icon="add" busy={busy} disabled={!title.trim() || busy}>
                create board
              </Button>
              <Button variant="quiet" href={project ? `/projects/${enc(project)}/boards` : "/boards"}>cancel</Button>
              {error && <span className="text-sm text-bad">{error}</span>}
            </FieldRow>
            <Hint>
              One folder {project ? <>under the project's <code>boards/</code></> : <>under <code title={root}>{root ?? "the boards root"}</code></>} with board.md and a tasks/ folder; the columns start as Draft, Todo, In progress, Review, Done and are changed in the board's settings.
            </Hint>
          </FormStack>
        </form>
      </Panel>
    </Page>
  );
}

/** A project's bare #/projects/<slug>/boards: the default board, created on first use, then its page. */
export function ProjectBoardsLanding({ slug }: { slug: string }) {
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.request("boards.ensure", { body: { project: slug } }).then((r) => {
      if (!alive) return;
      if (r.ok) navigate(`/projects/${enc(slug)}/boards/${enc(r.data.board)}`, { replace: true });
      else setError(failure(r));
    });
    return () => {
      alive = false;
    };
  }, [slug]);
  if (error)
    return (
      <EmptyState icon="view_kanban">
        <span className="text-bad">{error}</span>
      </EmptyState>
    );
  return <EmptyState>opening the board…</EmptyState>;
}

/**
 * The context column's glance at a board. The board row first (title, the
 * review badge, how many tasks); then the pipeline — every column as a pill
 * with its count, so the shape of the board is one line, the busy columns in
 * ink and the empty ones faint; then only the columns that hold something,
 * each task a card with its number, title, agent and due date. Empty columns
 * take no vertical space: with one task on the board, that task is what
 * you see. Everything links into the board.
 */
export function BoardGlance({ project, board }: BoardAt) {
  const at: BoardAt = { project, board };
  const data = useApi("boards.get", { board, query: queryOf(project) }, { interval: 10_000 });
  const agents = useApi("agents.list", {}, { interval: 60_000 });
  if (!data) return null;
  const known = new Set(data.columns.map((c) => c.slug));
  const lanes = [...data.columns, ...(data.items.some((t) => !known.has(t.status)) ? [{ slug: "", label: "No column" } as Column] : [])];
  const groups = lanes.map((c) => ({ col: c, tasks: data.items.filter((t) => (c.slug ? t.status === c.slug : !known.has(t.status))).sort(byOrder) }));
  const who = (slug: string) => (agents?.agents ?? []).find((a) => a.slug === slug);
  const n = data.tasks;
  return (
    <section className="flex flex-col gap-2.5 pb-3" aria-label={`board ${data.title}`}>
      <ListRow
        href={boardHref(at)}
        size="sm"
        leading={<Icon name="view_kanban" className="ms-sm" />}
        title={data.title}
        titleExtra={<Badge n={data.review} title="waiting for review" />}
        meta={n === 0 ? "empty" : `${n} task${n === 1 ? "" : "s"}`}
      />
      {/* The pipeline: one pill per column, left to right as on the board. */}
      <div className="flex flex-wrap gap-1 px-2.5" aria-label="columns">
        {groups.map(({ col: c, tasks }) => {
          const over = c.limit !== undefined && tasks.length > c.limit;
          return (
            <Link
              key={c.slug || "~"}
              href={boardHref(at)}
              title={`${c.label}: ${tasks.length}${c.limit !== undefined ? ` of ${c.limit}` : ""}`}
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-full px-2 text-2xs font-medium no-underline transition-colors",
                tasks.length === 0 && "bg-transparent text-fg-2 ring-1 ring-inset ring-line hover:text-fg",
                tasks.length > 0 && !c.review && !over && "bg-surface-2 text-fg hover:bg-accent-soft hover:text-on-accent-soft",
                tasks.length > 0 && c.review && !over && "bg-ask-soft text-on-ask-soft",
                over && "bg-bad-soft text-on-bad-soft",
              )}
            >
              {c.label}
              <span className="font-semibold tabular-nums">{tasks.length}</span>
            </Link>
          );
        })}
      </div>
      {n === 0 && (
        <p className="m-0 px-2.5 text-xs text-fg-2">
          Nothing on the board yet. <Link href={boardHref(at)} className="text-accent">Add a task</Link>
        </p>
      )}
      {groups
        .filter(({ tasks }) => tasks.length > 0)
        .map(({ col: c, tasks }) => {
          const max = c.done ? 3 : 8;
          return (
            <div key={c.slug || "~"} className="flex flex-col gap-1 px-2.5">
              <div className="flex items-baseline gap-1.5 pt-0.5">
                <Eyebrow className={cn(c.review && "text-on-ask-soft")}>{c.label}</Eyebrow>
                <span className="text-2xs tabular-nums text-fg-2">{tasks.length}</span>
              </div>
              {tasks.slice(0, max).map((t) => {
                const a = t.assignee ? who(t.assignee) : undefined;
                return (
                  <Link
                    key={t.slug}
                    href={taskHref(at, t.slug)}
                    className={cn("flex min-w-0 items-center gap-2 rounded-control border border-line bg-surface px-2 py-1.5 text-xs text-fg no-underline transition-colors hover:border-accent hover:bg-surface-2", c.done && "opacity-70")}
                  >
                    <span className="flex-none font-mono text-2xs text-fg-2">#{t.number}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                    {t.due && <span className="flex-none text-2xs tabular-nums text-fg-2">{t.due.slice(5)}</span>}
                    {t.stale && <Icon name="hourglass_bottom" className="ms-sm flex-none text-[13px] text-on-ask-soft" />}
                    {t.assignee && (
                      <span className="flex-none text-2xs text-fg-2" title={a ? `${a.name} (${t.assignee})` : t.assignee}>
                        {a?.emoji ? a.emoji : t.assignee}
                      </span>
                    )}
                  </Link>
                );
              })}
              {tasks.length > max && (
                <Link href={boardHref(at)} className="px-1 text-2xs text-fg-2 no-underline hover:text-fg">
                  {tasks.length - max} more in {c.label}
                </Link>
              )}
            </div>
          );
        })}
    </section>
  );
}
