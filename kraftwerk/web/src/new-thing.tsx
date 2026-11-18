import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, failure, useApi } from "./api";
import { ChatCard, OpenHere, ProjectSelect, WhoSelect, startChat, useOpen, useProjectChoices } from "./chat-card";
import { NewEntityForm, type EntityKind } from "./entities";
import { RunForm } from "./run-launcher";
import { Icon } from "./shared";
import { Button, Field, FieldRow, FormStack, IconButton, Select, TextField } from "./ui";

const enc = encodeURIComponent;

/**
 * Making a new thing happens in a window over where you are: Home's "+" on
 * a kind opens it, and the palette's commands draw the same forms. A chat,
 * a workflow, a skill, a run and a task are asked for in the chat window;
 * a board, a knowledge bundle, a contact, a place and an event need a name.
 */
export type NewKind = "chats" | "workflows" | "skills" | "runs" | "tasks" | "boards" | "knowledge" | EntityKind;
export const NEW_KINDS = new Set<string>(["chats", "workflows", "skills", "runs", "tasks", "boards", "knowledge", "contacts", "places", "events"]);

const TITLES: Record<NewKind, string> = {
  chats: "New chat",
  workflows: "New workflow",
  skills: "New skill",
  runs: "Run a workflow",
  tasks: "New task",
  boards: "New board",
  knowledge: "New knowledge bundle",
  contacts: "New contact",
  places: "New place",
  events: "New event",
};

export function Modal({ label, title, onClose, children }: { label: string; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".palette-backdrop")) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-40 flex animate-fade items-start justify-center bg-black/38 px-4 pt-[12vh] pb-4" onMouseDown={onClose}>
      <div role="dialog" aria-label={label} className="relative flex w-[min(600px,100%)] animate-modal flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-modal" onMouseDown={(e) => e.stopPropagation()}>
        <IconButton icon="close" label="close (esc)" className="absolute top-3 right-3 rounded-full" onClick={onClose} />
        <h2 className="m-0 text-base font-semibold text-fg">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The window for a new thing of a kind. `onMade` gets where the new thing
 * shows (Home opens it in its preview); a chat or a run started here opens
 * through the screen's own `OpenHere`, or at its route.
 */
export function NewThingModal({ kind, project, onClose, onMade }: { kind: NewKind; project?: string; onClose: () => void; onMade: (key: string, href: string) => void }) {
  const outer = useOpen();
  return (
    <Modal label={TITLES[kind].toLowerCase()} title={TITLES[kind]} onClose={onClose}>
      <OpenHere.Provider
        value={(href) => {
          onClose();
          outer(href);
          return true;
        }}
      >
        {kind === "chats" && <QuickChat project={project} />}
        {kind === "workflows" && <MakeCard what="workflow" />}
        {kind === "skills" && <MakeCard what="skill" />}
        {kind === "runs" && <QuickRun />}
        {kind === "tasks" && <QuickTask project={project} onMade={(t) => (onClose(), onMade(`tasks:${t.project ?? ""}:${t.board}:${t.slug}`, t.href))} />}
        {kind === "boards" && <NewBoardForm project={project} onCancel={onClose} onMade={(board) => (onClose(), onMade(`boards:${project ?? ""}:${board}`, `${project ? `/projects/${enc(project)}` : ""}/boards/${enc(board)}`))} />}
        {kind === "knowledge" && <NewBundleForm onCancel={onClose} onMade={(name) => (onClose(), onMade(`knowledge:${name}`, `/knowledge/${enc(name)}`))} />}
        {(kind === "contacts" || kind === "places" || kind === "events") && <NewEntityForm kind={kind} onCancel={onClose} onCreated={(slug) => (onClose(), onMade(`${kind}:${slug}`, `/${kind}/${enc(slug)}`))} />}
      </OpenHere.Provider>
    </Modal>
  );
}

/** A new chat: the message, who gets it and in which project, send. Opened in a project, that one is picked. */
export function QuickChat({ project: here }: { project?: string }) {
  const agents = useApi("agents.list", {});
  const projects = useProjectChoices();
  const open = useOpen();
  const [who, setWho] = useState("");
  const [project, setProject] = useState(here ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const roster = (agents?.agents ?? []).filter((a) => !a.archived);
  return (
    <ChatCard
      label="new chat"
      value={text}
      onChange={setText}
      autoFocus
      inputLabel="message"
      placeholder="Ask anything — / for skills, @ for an agent"
      sendLabel="start chat"
      busy={busy}
      error={error}
      skills
      who={who}
      onWho={setWho}
      attach
      controls={
        <>
          <WhoSelect value={who} onChange={setWho} agents={roster} byDefault={project ? "🧭 Assistant (default)" : undefined} />
          <ProjectSelect value={project} onChange={setProject} projects={projects} />
        </>
      }
      hint={project && project === here ? "a chat in this project" : undefined}
      onSend={async (files) => {
        setBusy(true);
        setError("");
        const r = await startChat({ who: who || undefined, project: project || undefined, harness: projects.find((p) => p.slug === project)?.harness, text, files });
        setBusy(false);
        if ("error" in r) return setError(r.error), false;
        open(r.href);
      }}
    />
  );
}

/** A new workflow or skill is made by asking Ralv for it: say what it should do, the request is worded around it. */
export function MakeCard({ what }: { what: "workflow" | "skill" }) {
  const open = useOpen();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <ChatCard
      label={`new ${what}`}
      chip={
        <>
          <Icon name={what === "workflow" ? "account_tree" : "extension"} className="ms-sm" /> new {what}
        </>
      }
      chipTitle={`Ralv builds the ${what} from what you describe`}
      value={text}
      onChange={setText}
      autoFocus
      inputLabel={`what the ${what} should do`}
      placeholder={what === "workflow" ? "Describe what it should do, step by step if you know" : "Describe what the skill is for and when to use it"}
      sendLabel={`ask Ralv to make the ${what}`}
      busy={busy}
      disabled={!text.trim()}
      error={error}
      attach
      hint="Ralv makes it in a chat"
      onSend={async (files) => {
        setBusy(true);
        setError("");
        const ask =
          what === "workflow"
            ? `Create a new workflow in this workspace. What it should do:\n\n${text.trim()}`
            : `Create a new skill in this workspace's skills folder. What it is for:\n\n${text.trim()}`;
        const r = await startChat({ text: ask, files });
        setBusy(false);
        if ("error" in r) return setError(r.error), false;
        open(r.href);
      }}
    />
  );
}

/** Run a workflow from anywhere: which one, then its launcher. */
function QuickRun() {
  const wfs = useApi("workflows.list", {});
  const list = (wfs?.workflows ?? []).filter((w) => !w.error);
  const [slug, setSlug] = useState("");
  const picked = list.find((w) => w.slug === slug) ?? list[0];
  if (wfs && list.length === 0) return <p className="m-0 text-sm text-fg-2">There is no workflow to run yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      <Field label="workflow">
        <Select aria-label="workflow" value={picked?.slug ?? ""} onChange={(e) => setSlug(e.target.value)}>
          {list.map((w) => (
            <option key={w.slug} value={w.slug}>
              {w.name || w.slug}
            </option>
          ))}
        </Select>
      </Field>
      {picked && <RunForm key={picked.slug} slug={picked.slug} usesRequest={picked.usesRequest} />}
    </div>
  );
}

/** A new task: its title and the board it goes on. */
export function QuickTask({ project, onMade }: { project?: string; onMade?: (t: { project?: string; board: string; slug: string; href: string }) => void }) {
  const boards = useApi("boards.list", { query: { all: "1" } });
  const open = useOpen();
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = (boards?.boards ?? []).filter((b) => !project || b.project === project);
  const keyOf = (b: { project?: string; board: string }) => `${b.project ?? ""}/${b.board}`;
  const picked = list.find((b) => keyOf(b) === at) ?? list[0];
  return (
    <ChatCard
      label="new task"
      chip={
        <>
          <Icon name="task_alt" className="ms-sm" /> task
        </>
      }
      value={title}
      onChange={(t) => setTitle(t.replace(/\n/g, " "))}
      autoFocus
      minRows={1}
      inputLabel="task title"
      placeholder="What needs doing?"
      sendLabel="add task"
      sendIcon="add"
      busy={busy}
      disabled={!title.trim() || !picked}
      error={error || (boards && list.length === 0 ? "There is no board yet: make one first (New board)." : "")}
      controls={
        list.length > 0 && (
          <Select aria-label="board" value={picked ? keyOf(picked) : ""} onChange={(e) => setAt(e.target.value)} className="h-8 w-auto max-w-[260px] rounded-full border-0 bg-transparent text-sm font-medium hover:bg-surface-2">
            {list.map((b) => (
              <option key={keyOf(b)} value={keyOf(b)}>
                {b.project && !project ? `${b.project} · ` : ""}
                {b.title}
              </option>
            ))}
          </Select>
        )
      }
      hint="lands in the board's todo column"
      onSend={async () => {
        if (!picked) return false;
        setBusy(true);
        setError("");
        const r = await api.request("tasks.create", { board: picked.board, query: picked.project ? { project: picked.project } : {}, body: { title: title.trim() } });
        setBusy(false);
        if (!r.ok) return setError(failure(r)), false;
        const href = `${picked.project ? `/projects/${enc(picked.project)}` : ""}/boards/${enc(picked.board)}/${enc(r.data.slug)}`;
        if (onMade) onMade({ project: picked.project, board: picked.board, slug: r.data.slug, href });
        else open(href);
      }}
    />
  );
}

function NewBoardForm({ project, onMade, onCancel }: { project?: string; onMade: (board: string) => void; onCancel: () => void }) {
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
    onMade(r.data.board);
  };
  return (
    <NameForm label="title" inputLabel="board title" placeholder="e.g. Marketing" value={title} onChange={setTitle} submit="create board" busy={busy} error={error} onSubmit={create} onCancel={onCancel} hint="Starts with the columns Draft, Todo, In progress, Review and Done; change them in the board's settings." />
  );
}

function NewBundleForm({ onMade, onCancel }: { onMade: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError("");
    const r = await api.request("knowledge.create", { body: { name: n } });
    setBusy(false);
    if (!r.ok) return setError(failure(r));
    onMade(n);
  };
  return <NameForm label="name" inputLabel="bundle name" placeholder="e.g. customer-support" value={name} onChange={setName} submit="create bundle" busy={busy} error={error} onSubmit={create} onCancel={onCancel} hint="A folder of pages agents read and keep up to date." />;
}

function NameForm(p: { label: string; inputLabel: string; placeholder: string; value: string; onChange: (v: string) => void; submit: string; busy: boolean; error: string; hint: string; onSubmit: () => void; onCancel: () => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit();
      }}
    >
      <FormStack>
        <Field label={p.label} hint={p.hint}>
          <TextField autoFocus value={p.value} aria-label={p.inputLabel} placeholder={p.placeholder} disabled={p.busy} onChange={(e) => p.onChange(e.target.value)} />
        </Field>
        <FieldRow>
          <Button variant="primary" type="submit" icon="add" busy={p.busy} disabled={!p.value.trim() || p.busy}>
            {p.submit}
          </Button>
          <Button variant="quiet" onClick={p.onCancel}>
            cancel
          </Button>
          {p.error && <span className="text-sm text-bad">{p.error}</span>}
        </FieldRow>
      </FormStack>
    </form>
  );
}
