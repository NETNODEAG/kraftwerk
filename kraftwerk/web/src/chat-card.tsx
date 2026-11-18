import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { api, failure, useApi } from "./api";
import { Icon, navigate, useFeatures } from "./shared";
import { cn, Notice, Select } from "./ui";
import type { Agent, Attachment, ChatAgentId, SkillInfo } from "./types";

/**
 * The chat window every "do something" starts from: what it is about as a
 * chip where the message starts, what to add beside it, and under them who
 * (or where) and the send button. A skill, a workflow, a task, a knowledge
 * bundle, an app, a routine and Home's composer all draw this one card, so
 * they all take the same things: "/" offers the skills, "@" picks the agent,
 * files can be dropped, pasted or attached, Enter sends.
 */
export const CARD = "rounded-[18px] border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_4px_16px_rgb(0_0_0/0.04)]";
export const CARD_CHIP = "mt-px inline-flex flex-none items-center gap-1 rounded-control bg-accent-soft px-2 py-0.5 text-sm font-medium text-on-accent-soft";
const FIELD =
  "block max-h-[40vh] w-full resize-none border-0 bg-transparent p-0 font-[inherit] text-base text-fg shadow-none outline-none focus:shadow-none focus:outline-none focus-visible:outline-none placeholder:text-fg-2 [field-sizing:content]";
export const CARD_SEND =
  "inline-grid size-8 flex-none cursor-pointer place-items-center rounded-full border-0 bg-accent p-0 text-on-accent transition-[filter] hover:enabled:brightness-110 disabled:cursor-default disabled:opacity-60";
const FILE_CHIP = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-2xs text-fg-2";

export function ChatCard({
  label,
  className,
  chip,
  chipTitle,
  value,
  onChange,
  inputLabel,
  placeholder,
  minRows = 2,
  noInput,
  onSend,
  sendLabel,
  sendIcon = "arrow_upward",
  busy,
  disabled,
  controls,
  hint,
  error,
  skills,
  who,
  onWho,
  attach,
  inputRef,
  autoFocus,
  children,
}: {
  /** Names the card (the section's aria-label). */
  label: string;
  className?: string;
  /** What the message starts with: a skill's command, a workflow, a task. */
  chip?: ReactNode;
  chipTitle?: string;
  value: string;
  onChange: (text: string) => void;
  inputLabel: string;
  placeholder?: string;
  minRows?: 1 | 2;
  /** Said in place of the field when there is nothing to add. */
  noInput?: string;
  /** Send: gets the files attached here. Answer false to keep them (it failed). */
  onSend: (files: File[]) => void | boolean | Promise<void | boolean>;
  sendLabel: string;
  sendIcon?: string;
  busy?: boolean;
  disabled?: boolean;
  /** The bottom line, left: who it goes to, where it runs. */
  controls?: ReactNode;
  /** Beside the send button. */
  hint?: ReactNode;
  error?: string | null;
  /** "/" at the start offers the skills (the ones `who` may use). */
  skills?: boolean;
  /** The agent picked for the chat, if any. */
  who?: string;
  /** "@name" picks who the chat is with. */
  onWho?: (slug: string) => void;
  /** Files can be attached; they go along with the first message. */
  attach?: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
  autoFocus?: boolean;
  /** Under the card's two lines, inside it (a routine's schedule). */
  children?: ReactNode;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Array<{ file: File; preview?: string }>>([]);
  const [dragging, setDragging] = useState(false);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const agents = useApi("agents.list", skills || onWho ? {} : null, { interval: 30_000 });
  const roster = (agents?.agents ?? []).filter((a) => !a.archived);
  const all = useSkills(!!skills);
  const allowed = who ? roster.find((a) => a.slug === who)?.skills : undefined;
  const offered = allowed ? all.filter((s) => allowed.some((n) => n.toLowerCase() === s.name.toLowerCase())) : all;

  const caret = own.current?.selectionStart ?? value.length;
  const slash = skills && !dismissed ? /^\/([\w-]*)$/.exec(value)?.[1] : undefined;
  const at = onWho && !dismissed ? /(^|\s)@([a-z0-9-]*)$/i.exec(value.slice(0, caret)) : null;
  const matches: Array<{ id: string; label: string; hint?: string; pick: () => void }> = [
    ...(slash !== undefined
      ? offered
          .filter((s) => s.name.toLowerCase().startsWith(slash.toLowerCase()))
          .map((s) => ({ id: `/${s.name}`, label: `/${s.name}`, hint: s.description, pick: () => onChange(`/${s.name} `) }))
      : []),
    ...(at
      ? roster
          .filter((a) => a.slug.startsWith(at[2].toLowerCase()) || a.name.toLowerCase().startsWith(at[2].toLowerCase()))
          .map((a) => ({
            id: `@${a.slug}`,
            label: `${a.emoji || "🤖"} ${a.name}`,
            hint: a.description,
            // Picking an agent is choosing who gets the message: the token leaves the text.
            pick: () => {
              onWho?.(a.slug);
              onChange(value.slice(0, caret).replace(/@[a-z0-9-]*$/i, "") + value.slice(caret));
            },
          }))
      : []),
  ].slice(0, 12);
  const selIdx = Math.min(sel, matches.length - 1);

  const add = (list: FileList | File[]) =>
    setFiles((prev) => [...prev, ...Array.from(list).map((file) => ({ file, ...(file.type.startsWith("image/") ? { preview: URL.createObjectURL(file) } : {}) }))]);
  const send = async () => {
    if (busy || disabled) return;
    const kept = (await onSend(files.map((f) => f.file))) === false;
    if (!kept) setFiles([]);
  };

  return (
    <section className={cn("chat-card flex flex-col gap-2", className)} aria-label={label}>
      <div
        className={cn(CARD, "relative focus-within:border-line-strong", dragging && "border-dashed border-accent")}
        onDragOver={(e) => {
          if (!attach || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!attach || !e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
      >
        <div className="flex items-start gap-2 px-4 pt-3.5 pb-1">
          {chip && (
            <code className={CARD_CHIP} title={chipTitle}>
              {chip}
            </code>
          )}
          {noInput !== undefined ? (
            <span className="min-h-[48px] flex-1 text-base text-fg-2">{noInput}</span>
          ) : (
            <textarea
              ref={(el) => {
                own.current = el;
                if (typeof inputRef === "function") inputRef(el);
                else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = el;
              }}
              rows={minRows}
              value={value}
              autoFocus={autoFocus}
              aria-label={inputLabel}
              placeholder={placeholder}
              title={[skills && "/ for skills", onWho && "@ picks an agent", attach && "drop or paste files", "Enter sends · Shift+Enter for a newline"].filter(Boolean).join(" · ")}
              className={cn(FIELD, minRows === 1 ? "min-h-[28px]" : "min-h-[48px]")}
              onChange={(e) => {
                onChange(e.target.value);
                setSel(0);
                setDismissed(false);
              }}
              onPaste={(e) => {
                if (!attach) return;
                const pasted = Array.from(e.clipboardData.items)
                  .filter((it) => it.kind === "file")
                  .map((it) => it.getAsFile())
                  .filter((f): f is File => !!f);
                if (pasted.length) {
                  e.preventDefault();
                  add(pasted);
                }
              }}
              onKeyDown={(e) => {
                if (matches.length > 0) {
                  if (e.key === "ArrowDown") return e.preventDefault(), setSel((selIdx + 1) % matches.length);
                  if (e.key === "ArrowUp") return e.preventDefault(), setSel((selIdx - 1 + matches.length) % matches.length);
                  if (e.key === "Tab" || e.key === "Enter") return e.preventDefault(), matches[selIdx].pick();
                  if (e.key === "Escape") return e.preventDefault(), e.stopPropagation(), setDismissed(true);
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
          )}
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-1.5">
            {files.map((f, i) => (
              <span key={`${f.file.name}-${i}`} className={FILE_CHIP} title={`${f.file.name} · ${Math.round(f.file.size / 1024)} KB`}>
                {f.preview ? <img src={f.preview} alt={f.file.name} className="h-7 rounded" /> : <Icon name="attach_file" className="ms-sm" />}
                {f.file.name}
                <button
                  type="button"
                  className="inline-flex cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-fg"
                  aria-label={`remove ${f.file.name}`}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Icon name="close" className="ms-sm" />
                </button>
              </span>
            ))}
          </div>
        )}
        {children}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 pb-2.5">
          {controls}
          <span className="flex-1" />
          {hint && <span className="card-hint truncate text-xs text-fg-2 max-[800px]:hidden">{hint}</span>}
          {attach && (
            <>
              <button
                type="button"
                aria-label="attach files"
                title="attach files (or drop / paste them)"
                className="inline-grid size-8 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg"
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="attach_file" className="ms-sm" />
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) add(e.target.files);
                  e.target.value = "";
                }}
              />
            </>
          )}
          <button type="button" aria-label={sendLabel} title={`${sendLabel} (Enter)`} className={CARD_SEND} disabled={busy || disabled} onClick={() => void send()}>
            <Icon name={busy ? "progress_activity" : sendIcon} className="ms-sm" />
          </button>
        </div>
        {matches.length > 0 && (
          <div className="card-menu absolute inset-x-0 top-full z-20 mt-1.5 flex max-h-[40vh] flex-col overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-pop" role="listbox">
            {matches.map((m, i) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={i === selIdx}
                className={cn("flex cursor-pointer items-center gap-1.5 border-0 px-3.5 py-2 text-left text-sm whitespace-nowrap text-fg", i === selIdx ? "bg-surface-2" : "bg-transparent hover:bg-surface-2")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  m.pick();
                }}
              >
                <b className="max-w-[42%] flex-none truncate font-mono text-[12.5px] font-medium">{m.label}</b>
                {m.hint && <span className="min-w-0 flex-1 truncate text-xs text-fg-2">— {m.hint}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
    </section>
  );
}

/** The skills of the workspace, for the "/" menu; fetched once per card that offers them. */
function useSkills(on: boolean): SkillInfo[] {
  const [list, setList] = useState<SkillInfo[]>([]);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void api
      .request("skills.list")
      .then((r) => alive && setList((r.ok ? r.data.skills : undefined) ?? []))
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [on]);
  return list;
}

/** Who the chat is with: the default (Ralv, a project's assistant) or one of the agents, as the card's quiet select. */
export function WhoSelect({
  value,
  onChange,
  agents,
  byDefault = "🎩 Ralv (default)",
  label = "chat with",
}: {
  value: string;
  onChange: (slug: string) => void;
  agents: Pick<Agent, "slug" | "name" | "emoji">[];
  byDefault?: string;
  label?: string;
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-auto max-w-[240px] rounded-full border-0 bg-transparent text-sm font-medium hover:bg-surface-2">
      <option value="">{byDefault}</option>
      {agents.map((a) => (
        <option key={a.slug} value={a.slug}>
          {a.emoji || "🤖"} {a.name}
        </option>
      ))}
    </Select>
  );
}

/** The projects a new chat can be filed under: all but the archived ones; empty while projects are switched off. */
export function useProjectChoices(): { slug: string; title: string; harness: ChatAgentId }[] {
  const features = useFeatures();
  const projects = useApi("projects.list", features.projects ? {} : null, { interval: 60_000 });
  return (projects?.projects ?? []).filter((p) => p.status !== "archived");
}

/** Which project the chat belongs to, beside who it is with; nothing to pick, nothing shown. */
export function ProjectSelect({
  value,
  onChange,
  projects,
  label = "in project",
}: {
  value: string;
  onChange: (slug: string) => void;
  projects: { slug: string; title: string }[];
  label?: string;
}) {
  if (!projects.length) return null;
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-auto max-w-[200px] rounded-full border-0 bg-transparent text-sm font-medium hover:bg-surface-2">
      <option value="">no project</option>
      {projects.map((p) => (
        <option key={p.slug} value={p.slug}>
          📁 {p.title}
        </option>
      ))}
    </Select>
  );
}

const enc = encodeURIComponent;

/** Where a chat opens: in its project, with its agent, or with Ralv. */
export const chatHref = (id: string, o: { who?: string; project?: string }): string =>
  o.project ? `/projects/${enc(o.project)}/chat/${id}` : o.who ? `/agents/${enc(o.who)}/chat/${id}` : `/agents/chats/${id}`;

/** The chat a route shows, if it is a chat's route. */
export function chatIdOf(href: string): string | undefined {
  const [path] = href.split("?");
  const m = /^\/agents\/chats\/([^/]+)$/.exec(path) ?? /^\/(?:agents|projects)\/[^/]+\/chat\/([^/]+)$/.exec(path);
  return m && m[1] !== "new" ? m[1] : undefined;
}

/**
 * Start a chat with its first message: create it, upload what was attached,
 * send. Without `scope` the chat is with the agent picked, else the
 * project's assistant, else Ralv.
 */
export async function startChat(o: {
  who?: string;
  project?: string;
  scope?: Record<string, unknown>;
  /** The harness of a project's assistant; an agent brings its own. */
  harness?: ChatAgentId;
  task?: string;
  text?: string;
  files?: File[];
}): Promise<{ id: string; href: string } | { error: string }> {
  const scope = o.scope ?? (o.who ? { kind: "agent", slug: o.who } : o.project ? { kind: "project", slug: o.project } : { kind: "kraftwerk" });
  const filed = scope.kind === "agent" && o.project ? { project: o.project } : {};
  const created = await api.request("chats.create", { body: { agent: scope.kind === "project" ? (o.harness ?? "claude") : "claude", scope, ...(o.task ? { task: o.task } : {}), ...filed } as never });
  if (!created.ok) return { error: failure(created) };
  const id = created.data.id;
  const sent = await sendFirst(id, o.text, o.files);
  if (sent) return { error: sent };
  return { id, href: chatHref(id, { who: scope.kind === "agent" ? (scope.slug as string) : undefined, project: o.project }) };
}

/** A new chat's first message, with what was attached to it; answers what went wrong, if anything. */
export async function sendFirst(id: string, message?: string, files: File[] = []): Promise<string | undefined> {
  const attachments: Attachment[] = [];
  for (const f of files) {
    const r = await api
      .request("chats.attach", { id, headers: { "content-type": f.type || "application/octet-stream", "x-file-name": enc(f.name || "pasted.png") }, body: f })
      .catch(() => null);
    if (!r?.ok || typeof r.data !== "object" || !r.data) return `${f.name}: upload failed`;
    attachments.push(r.data as Attachment);
  }
  const text = message?.trim() ?? "";
  if (!text && !attachments.length) return undefined;
  const sent = await api.request("chats.message", { id, body: { text, ...(attachments.length ? { attachments } : {}) } });
  return sent.ok ? undefined : failure(sent);
}

/**
 * Where a screen shows what was just started on it without leaving: Home's
 * preview column takes a chat or a run (artifacts.tsx), a page without a
 * column for conversations opens the chat in a panel beside it
 * (chat-aside.tsx). The handler answers true when it took the route.
 */
export const OpenHere = createContext<((href: string) => boolean) | null>(null);

/** Open what was just started: beside the screen it was started on where there is a place for it, else at its route. */
export function useOpen(): (href: string) => void {
  const here = useContext(OpenHere);
  return (href) => {
    if (!here?.(href)) navigate(href);
  };
}
