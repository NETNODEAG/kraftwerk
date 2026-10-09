/** The composer: the message field with attachments, the / skill and @ mention menu, steering, and the channel poster's name. */
import { useEffect, useRef, useState } from "react";
import type {
  Agent,
  AgentCommand,
  Attachment,
  Channel,
  ChatScope,
  SkillInfo,
} from "../types";
import { api } from "../api";
import { Icon } from "../shared";
import { Button, cn, IconButton, Notice, TextField } from "../ui";
import { myName, setMyName, useSpeaker } from "./helpers";

export function Composer({
  id,
  busy,
  scope,
  channel,
  agentMap,
  commands = [],
  canSteer,
  account,
}: {
  id: string;
  busy: boolean;
  scope?: ChatScope;
  channel?: Channel;
  agentMap?: Map<string, Agent>;
  /** The agent's own slash commands, offered next to the skills. */
  commands?: AgentCommand[];
  /** A running turn can take a message (steering) instead of blocking the composer. */
  canSteer?: boolean;
  /** Whose account the agent runs on, named in the field's tooltip. */
  account?: string;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // "Max", "Ralv", "the assistant": the name without its emoji, for the placeholder.
  const name = useSpeaker()().replace(/^\S+\s(?=\S)/u, (m) => (/\p{Extended_Pictographic}/u.test(m) ? "" : m)).replace(/^The /, "the ");
  // Files dropped or pasted into the composer: uploaded right away (so a
  // screenshot shows while you type), sent with the next message.
  const [files, setFiles] = useState<Array<Attachment & { preview?: string }>>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);

  async function addFiles(list: FileList | File[]) {
    for (const f of Array.from(list)) {
      setUploading((n) => n + 1);
      try {
        const r = await api.request("chats.attach", {
          id,
          headers: { "content-type": f.type || "application/octet-stream", "x-file-name": encodeURIComponent(f.name || "pasted.png") },
          body: f,
        });
        if (typeof r.data !== "object" || !r.data) throw new Error("not json");
        if (!r.ok) setProblem(r.error ?? `upload failed (${r.status})`);
        else setFiles((prev) => [...prev, { ...r.data, ...(f.type.startsWith("image/") ? { preview: URL.createObjectURL(f) } : {}) }]);
      } catch {
        setProblem("upload failed");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [me, setMe] = useState(myName);
  const [editingMe, setEditingMe] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Channels never block the humans: an agent that is busy is woken again
  // when its turn ends. Ordinary chats take one message per turn — unless
  // the agent takes steering, then a message goes into the running turn.
  const steering = busy && !channel && !!canSteer;
  const locked = busy && !channel && !canSteer;

  // Skills the /-menu offers: all discovered ones, narrowed by the agent
  // member's allowlist when this is a agent session, plus the member's own
  // agent skills, which always apply and shadow shared ones (mirrors the server).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.request("skills.list");
        let list: SkillInfo[] = (r.ok ? r.data.skills : undefined) ?? [];
        if (scope?.kind === "agent") {
          const [m, own] = await Promise.all([
            api.call("agents.get", { slug: scope.slug }).catch(() => null),
            api.call("agents.skills", { slug: scope.slug }).catch(() => null),
          ]);
          if (m && Array.isArray(m.skills)) {
            const allowed = new Set(m.skills.map((n: string) => n.toLowerCase()));
            list = list.filter((s) => allowed.has(s.name.toLowerCase()));
          }
          const agentSkills: SkillInfo[] = own?.skills ?? [];
          const shadowed = new Set(agentSkills.map((s) => s.name.toLowerCase()));
          list = [...agentSkills, ...list.filter((s) => !shadowed.has(s.name.toLowerCase()))];
        }
        if (alive) setSkills(list);
      } catch {
        /* skills menu is optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // The menu is open while the draft is just "/<partial-name>".
  const slashQuery = /^\/([\w-]*)$/.exec(text)?.[1];
  const skillMatches =
    slashQuery !== undefined && !dismissed
      ? skills.filter((s) => s.name.toLowerCase().startsWith(slashQuery.toLowerCase()))
      : [];
  const skillNames = new Set(skills.map((s) => s.name.toLowerCase()));
  const commandMatches =
    slashQuery !== undefined && !dismissed
      ? commands.filter((c) => c.name.toLowerCase().startsWith(slashQuery.toLowerCase()) && !skillNames.has(c.name.toLowerCase()))
      : [];
  // Channels: "@partial" at the caret offers the members.
  const caret = taRef.current?.selectionStart ?? text.length;
  const atMatch = channel && !dismissed ? /(^|\s)@([a-z0-9-]*)$/i.exec(text.slice(0, caret)) : null;
  const mentionMatches =
    atMatch && channel
      ? channel.members.filter((m) => m.startsWith(atMatch[2].toLowerCase()) || (agentMap?.get(m)?.name ?? "").toLowerCase().startsWith(atMatch[2].toLowerCase()))
      : [];
  const allMatches: Array<{ id: string; label: string; hint?: string; src?: string; pick: () => void }> = [
    ...skillMatches.map((s) => ({
      id: `/${s.name}`,
      label: `/${s.name}`,
      hint: s.description,
      src: s.source,
      pick: () => {
        setText(`/${s.name} `);
        setSel(0);
      },
    })),
    ...commandMatches.map((c) => ({
      id: `/${c.name}`,
      label: `/${c.name}${c.hint ? ` ${c.hint}` : ""}`,
      hint: c.description,
      src: "agent",
      pick: () => {
        setText(`/${c.name} `);
        setSel(0);
      },
    })),
    ...mentionMatches.map((m) => ({
      id: `@${m}`,
      label: `${agentMap?.get(m)?.emoji ?? "🤖"} @${m}`,
      hint: agentMap?.get(m)?.name,
      pick: () => {
        const before = text.slice(0, caret).replace(/@[a-z0-9-]*$/i, `@${m} `);
        setText(before + text.slice(caret));
        setSel(0);
        requestAnimationFrame(() => {
          const el = taRef.current;
          if (el) el.selectionStart = el.selectionEnd = before.length;
        });
      },
    })),
  ];
  // Skills first, then the agent's own commands (there can be well over a hundred): keep the menu short.
  const matches = allMatches.slice(0, 15);
  const menuOpen = matches.length > 0;
  const selIdx = Math.min(sel, matches.length - 1);

  async function send() {
    const t = text.trim();
    if ((!t && files.length === 0) || locked || uploading > 0) return;
    const attachments = files.map(({ preview: _p, ...a }) => a);
    setText("");
    setFiles([]);
    setProblem(null);
    const body = { text: t, ...(attachments.length ? { attachments } : {}), ...(channel ? { from: me || "you" } : {}) };
    const r = await (steering ? api.request("chats.steer", { id, body }) : api.request("chats.message", { id, body })).catch(() => null);
    if (r && !r.ok) {
      setProblem(r.error ?? `not sent (${r.status})`);
      setText(t);
      setFiles(files);
    }
  }

  return (
    <div
      className="composer relative flex flex-none flex-wrap items-end border-t border-line pt-2.5 pb-1"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      {files.length > 0 && (
        <div className="flex basis-full flex-wrap gap-1.5 px-1 pb-1.5">
          {files.map((f) => (
            <span key={f.name} className={FILE_CHIP} title={`${f.name} · ${Math.round(f.size / 1024)} KB`}>
              {f.preview ? <img src={f.preview} alt={f.name} className="h-7 rounded" /> : <Icon name="attach_file" className="ms-sm" />}
              {f.name.replace(/^\d{8}-\d{6}-/, "")}
              <button
                type="button"
                className="inline-flex cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-fg"
                title="remove"
                aria-label={`remove ${f.name}`}
                onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))}
              >
                <Icon name="close" className="ms-sm" />
              </button>
            </span>
          ))}
          {uploading > 0 && <span className={FILE_CHIP}>uploading…</span>}
        </div>
      )}
      {channel && (
        <div className="composer-me flex basis-full items-center gap-1.5 px-1 pb-1 text-xs text-fg-2">
          posting as{" "}
          {editingMe ? (
            <TextField
              autoFocus
              className="h-7 w-48 text-xs"
              value={me}
              placeholder="your name"
              aria-label="your name"
              onChange={(e) => setMe(e.target.value)}
              onBlur={() => {
                setMyName(me.trim());
                setEditingMe(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
            />
          ) : (
            <button
              type="button"
              className="me-name inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-[inherit] font-semibold text-fg"
              onClick={() => setEditingMe(true)}
              title="change your name"
            >
              {me || "you"} <Icon name="edit" className="ms-sm" />
            </button>
          )}
        </div>
      )}
      {menuOpen && (
        <div className="skill-menu absolute inset-x-0 bottom-full z-5 mb-1.5 flex max-h-[46vh] flex-col overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-pop">
          {matches.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={cn(
                "flex cursor-pointer items-center gap-1.5 border-0 px-3.5 py-2 text-left text-sm whitespace-nowrap text-fg",
                i === selIdx ? "bg-surface-2" : "bg-transparent hover:bg-surface-2"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                s.pick();
              }}
            >
              <b className="max-w-[42%] flex-none truncate font-mono text-[12.5px] font-medium">{s.label}</b>
              {s.hint && <span className="min-w-0 flex-1 truncate text-xs text-fg-2">— {s.hint}</span>}
              {s.src && <span className="ml-auto flex-none text-[10.5px] tracking-[0.04em] text-fg-2 uppercase">{s.src}</span>}
            </button>
          ))}
        </div>
      )}
      {problem && (
        <div className="basis-full">
          <Notice tone="bad">{problem}</Notice>
        </div>
      )}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-end gap-0.5 rounded-[24px] border bg-surface py-[5px] pr-[5px] pl-3.5 transition-[border-color,box-shadow]",
          "focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_16%,transparent)]",
          dragging ? "border-dashed border-accent" : "border-line"
        )}
      >
        <textarea
          ref={taRef}
          value={text}
          className="max-h-[40vh] min-w-0 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-1.5 py-2 font-sans text-md leading-[1.5] text-fg shadow-none outline-none [field-sizing:content] placeholder:text-fg-2"
          placeholder={
            channel
              ? locked ? "the agents are working…" : "Message the channel…"
              : locked
                ? `${name} is working…`
                : steering
                  ? `Add to what ${name} is doing…`
                  : `Message ${name}…`
          }
          title={`${channel ? "Enter to send · Shift+Enter for a newline · @ mentions an agent · / for skills · drop or paste files" : "Enter to send · Shift+Enter for a newline · / for skills · drop or paste files"}${account ? `\nruns as ${account}` : ""}`}
          rows={Math.min(6, Math.max(1, text.split("\n").length))}
          onChange={(e) => {
            setText(e.target.value);
            setSel(0);
            setDismissed(false);
          }}
          onPaste={(e) => {
            // A screenshot from the clipboard arrives as a file item.
            const pasted = Array.from(e.clipboardData.items)
              .filter((it) => it.kind === "file")
              .map((it) => it.getAsFile())
              .filter((f): f is File => !!f);
            if (pasted.length) {
              e.preventDefault();
              void addFiles(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (menuOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                return setSel((selIdx + 1) % matches.length);
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                return setSel((selIdx - 1 + matches.length) % matches.length);
              }
              if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                return matches[selIdx].pick();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                return setDismissed(true);
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy && (
          <Button size="sm" variant="danger" icon="stop" className="mr-1 self-center" onClick={() => api.request("chats.cancel", { id }).catch(() => {})}>
            stop
          </Button>
        )}
        {!locked && <IconButton icon="attach_file" label="attach files (or drop / paste them)" className="size-9 rounded-full [&_.ms]:text-[20px]" onClick={() => fileRef.current?.click()} />}
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {!locked && (
          <button
            type="button"
            className="inline-grid size-9 flex-none cursor-pointer place-items-center rounded-full border-0 bg-accent p-0 text-on-accent transition-[filter,opacity] hover:enabled:brightness-110 active:enabled:scale-95 disabled:cursor-default disabled:opacity-30"
            disabled={(!text.trim() && files.length === 0) || uploading > 0}
            onClick={send}
            aria-label={steering ? "steer" : "send"}
            title={steering ? "steer: hand this into the running turn (Enter)" : "send (Enter)"}
          >
            <Icon name={steering ? "alt_route" : "send"} className="text-[19px]" />
          </button>
        )}
      </div>
    </div>
  );
}

const FILE_CHIP = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-2xs text-fg-2";
