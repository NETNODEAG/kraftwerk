import { useEffect, useState } from "react";
import { api, failure, useApi, type ApiResult } from "./api";
import { refreshAttention } from "./attention";
import { Link, fmtWhen, navigate, useFeatures } from "./shared";
import { Button, EmptyState, Field, FieldRow, Hint, Notice, Select, Tag, TextArea, TextField } from "./ui";

/**
 * A routine on Artifacts' right column. A workspace routine
 * (agents/routines.yml, owner "_") is defined on its own and edited here:
 * what to ask and when, the project it runs in (none: the whole workspace)
 * and who gets the prompt (none: the project's assistant, or Ralv). An
 * agent's own routine (agents/<slug>/routines.yml) shows what it does and
 * runs from here; it is edited on the agent's profile, where it lives.
 */
export type ListedRoutine = ApiResult<"routines.list">["routines"][number];

/** The owner of the workspace's routines, as the API spells it. */
export const WORKSPACE_ROUTINES = "_";
/** The key of the "new routine" form in #/?open=routines:_:new. */
export const NEW_ROUTINE = "new";

/** Who gets the prompt, in a few words: the agent, else the project's assistant, else Ralv. */
export const routineWho = (r: Pick<ListedRoutine, "agent" | "project">): string =>
  r.agent ? `${r.agent.emoji ? `${r.agent.emoji} ` : ""}${r.agent.name}` : r.project ? "🧭 Assistant" : "🎩 Ralv";

/** When it fires next, or why it does not. */
export const routineWhen = (r: ListedRoutine): string =>
  !r.enabled ? "paused" : r.nextRunAt ? `next ${fmtWhen(r.nextRunAt)}` : r.runner === "unassigned" ? "no runner" : r.runner === "elsewhere" ? `runs on ${r.runsOn}` : r.schedule;

/** Where a run's chat opens: in its project, else with its agent, else with Ralv. */
export const runHref = (r: Pick<ListedRoutine, "agent" | "project">, chatId: string): string =>
  r.project ? `/projects/${encodeURIComponent(r.project)}/chat/${chatId}` : r.agent ? `/agents/${encodeURIComponent(r.agent.slug)}/chat/${chatId}` : `/agents/chats/${chatId}`;

interface Form {
  id?: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  project: string;
  agent: string;
  /** Untouched: undefined — the server keeps the runner (a new routine: this machine). */
  runsOn?: string;
  private: boolean;
}
const BLANK: Form = { name: "", schedule: "0 9 * * 1-5", prompt: "", enabled: true, project: "", agent: "", private: false };
const formOf = (r: ListedRoutine): Form => ({
  id: r.id,
  name: r.name,
  schedule: r.schedule,
  prompt: r.prompt,
  enabled: r.enabled,
  project: r.project ?? "",
  agent: r.agent?.slug ?? "",
  runsOn: r.runsOn ?? "",
  private: r.private ?? false,
});

function State({ r, error }: { r: ListedRoutine; error?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-2">
      <code>{r.schedule}</code>
      <span>· {routineWhen(r)}</span>
      {r.runner === "here" ? (
        <Tag title={`runs_on: ${r.runsOn} — this machine fires it`}>runs here</Tag>
      ) : r.runner === "unassigned" ? (
        <Tag tone={r.enabled ? "ask" : "neutral"} title="no runs_on — it fires on no machine until one adopts it">
          no runner
        </Tag>
      ) : (
        <Tag tone={r.retired ? "ask" : "neutral"} title={r.retired ? "a retired identity of this machine — it fires nowhere until reassigned" : "another machine fires it, not this one"}>
          runs on {r.runsOn}
        </Tag>
      )}
      {r.lastChatId ? <Link href={runHref(r, r.lastChatId)}>last run {fmtWhen(r.lastRunAt)}</Link> : <span>never ran</span>}
      {r.awaitingApproval && r.lastChatId && (
        <Tag href={runHref(r, r.lastChatId)} tone="bad" title="the last run asked for a permission nobody has answered yet">
          needs approval
        </Tag>
      )}
      {(error || r.lastError) && (
        <span title={error || r.lastError}>
          <Tag tone="bad">error</Tag>
        </span>
      )}
    </div>
  );
}

export function RoutinePreview({ owner, id, onOpen }: { owner: string; id: string; onOpen: (key: string | undefined) => void }) {
  const features = useFeatures();
  const data = useApi("routines.list", {}, { interval: 30_000 });
  const agents = useApi("agents.list", {}, { interval: 60_000 });
  const projects = useApi("projects.list", features.projects ? {} : null, { interval: 60_000 });
  const identity = useApi("identity.get", {}, { interval: 60_000 });
  const isNew = owner === WORKSPACE_ROUTINES && id === NEW_ROUTINE;
  const r = isNew ? undefined : data?.routines.find((x) => x.owner === owner && x.id === id);
  const [form, setForm] = useState<Form | null>(isNew ? BLANK : null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  // The form follows the routine picked, not every poll: what is being typed stays.
  useEffect(() => {
    setForm(isNew ? BLANK : r && owner === WORKSPACE_ROUTINES ? formOf(r) : null);
    setError("");
    setNote("");
  }, [owner, id, !!r]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isNew && !r) return <EmptyState className="my-auto">{data ? "That routine is gone." : "loading…"}</EmptyState>;

  async function act(what: string, fn: () => Promise<void>) {
    setBusy(what);
    setError("");
    setNote("");
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  const runNow = () =>
    act("run", async () => {
      const res = owner === WORKSPACE_ROUTINES ? await api.request("routines.run", { id }) : await api.request("agents.runRoutine", { slug: owner, id });
      if (!res.ok) throw new Error(failure(res));
      if (r && res.data.chatId) navigate(runHref(r, res.data.chatId));
    });

  // An agent's own routine: what it does, run it; it is edited where it lives.
  if (r && owner !== WORKSPACE_ROUTINES) {
    return (
      <div className="routine-view flex flex-col gap-3 p-3">
        <State r={r} error={error} />
        <p className="m-0 text-sm text-fg">
          Asks <strong>{routineWho(r)}</strong>:
        </p>
        <pre className="m-0 rounded-lg border border-line bg-surface-2 p-3 font-sans text-sm whitespace-pre-wrap text-fg">{r.prompt}</pre>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon="play_arrow" busy={busy === "run"} onClick={() => void runNow()}>
            {busy === "run" ? "starting…" : "run now"}
          </Button>
          <Button size="sm" icon="edit" href={`/agents/${encodeURIComponent(owner)}/info`} title="this routine is the agent's own: it is edited on the agent's profile">
            edit on {r.agent?.name ?? owner}'s profile
          </Button>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    );
  }
  if (!form) return <EmptyState className="my-auto">loading…</EmptyState>;

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const team = (agents?.agents ?? []).filter((a) => !a.archived || a.slug === form.agent);
  const save = () =>
    act("save", async () => {
      const { runsOn, project, agent, ...rest } = form;
      const res = await api.request("routines.save", {
        // Untouched runner: left out, so the server keeps it (a new routine gets this machine).
        body: { ...rest, project: project || null, agent: agent || null, ...(runsOn === undefined ? {} : { runsOn: runsOn.trim() || null }) },
      });
      if (!res.ok) throw new Error(failure(res));
      setNote("saved");
      if (isNew) onOpen(`routines:${WORKSPACE_ROUTINES}:${res.data.id}`);
    });
  const adopt = () =>
    act("adopt", async () => {
      const res = await api.request("routines.adoptOne", { id });
      if (!res.ok) throw new Error(failure(res));
      const c = res.data.commit;
      if (c && !c.ok) throw new Error(`runs on ${res.data.runsOn} — routines.yml written, but not committed: ${c.error ?? "git failed"}`);
      setNote(`runs on ${res.data.runsOn} now${c ? " — committed" : ""}`);
      set({ runsOn: res.data.runsOn });
      refreshAttention();
    });
  const remove = () => {
    if (!window.confirm(`Delete the routine "${form.name}"?`)) return;
    void act("delete", async () => {
      const res = await api.request("routines.delete", { id });
      if (!res.ok) throw new Error(failure(res));
      onOpen(undefined);
    });
  };

  return (
    <form
      className="routine-form flex flex-col gap-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {r && <State r={r} />}
      <Field label="name">
        <TextField value={form.name} placeholder="e.g. Morning report" onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <FieldRow className="items-start">
        <Field label="runs in" className="min-w-[180px] flex-1" hint={form.project ? "its runs are filed under the project" : "not tied to a project"}>
          <Select aria-label="runs in" value={form.project} onChange={(e) => set({ project: e.target.value })}>
            <option value="">the whole workspace</option>
            {(projects?.projects ?? []).map((p) => (
              <option key={p.slug} value={p.slug}>
                📁 {p.title}
              </option>
            ))}
            {form.project && !projects?.projects.some((p) => p.slug === form.project) && <option value={form.project}>📁 {form.project}</option>}
          </Select>
        </Field>
        <Field label="who" className="min-w-[180px] flex-1" hint={form.agent ? "gets the prompt in a new session" : form.project ? "the project's own assistant" : "the workspace's general assistant"}>
          <Select aria-label="who" value={form.agent} onChange={(e) => set({ agent: e.target.value })}>
            <option value="">{form.project ? "🧭 the project's assistant" : "🎩 Ralv"}</option>
            {team.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.emoji} {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="schedule (cron)" className="min-w-[160px] flex-1" hint="minute hour day month weekday, this machine's time">
          <TextField className="font-mono" value={form.schedule} placeholder="0 9 * * 1-5" onChange={(e) => set({ schedule: e.target.value })} />
        </Field>
        <label className="flex h-9 cursor-pointer items-center gap-2 self-end pb-6 text-sm text-fg">
          <input type="checkbox" className="accent-accent" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          enabled
        </label>
      </FieldRow>
      <Field label="prompt — what to ask on each run">
        <TextArea rows={6} value={form.prompt} placeholder="Check ... and summarize what changed." onChange={(e) => set({ prompt: e.target.value })} />
      </Field>
      <FieldRow>
        <Field label="runs on — the one machine that fires it" className="min-w-[180px] flex-1">
          <TextField
            className="font-mono"
            value={form.runsOn ?? identity?.identity ?? ""}
            placeholder="<handle>@<machine> — empty: no runner"
            onChange={(e) => set({ runsOn: e.target.value })}
          />
        </Field>
        <label className="flex h-9 cursor-pointer items-center gap-2 self-end text-sm text-fg" title="its runs stay off what remote members and paired devices see">
          <input type="checkbox" className="accent-accent" checked={form.private} onChange={(e) => set({ private: e.target.checked })} />
          private
        </label>
      </FieldRow>
      {identity && (
        <Hint>
          This machine is <code>{identity.identity}</code>. Empty: no runner — it fires nowhere.
        </Hint>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" busy={busy === "save"} disabled={!form.name.trim() || !form.prompt.trim() || !!busy}>
          {isNew ? "add the routine" : "save"}
        </Button>
        {r && (
          <>
            <Button icon="play_arrow" busy={busy === "run"} disabled={!!busy} onClick={() => void runNow()} title="start a run with the saved prompt, now">
              {busy === "run" ? "starting…" : "run now"}
            </Button>
            {r.runner !== "here" && (
              <Button variant="quiet" busy={busy === "adopt"} disabled={!!busy} onClick={() => void adopt()} title={`make ${identity?.identity ?? "this machine"} its runner and commit routines.yml`}>
                run here
              </Button>
            )}
            <span className="flex-1" />
            <Button variant="danger" disabled={!!busy} onClick={remove}>
              delete
            </Button>
          </>
        )}
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : note ? <Notice>{note}</Notice> : null}
    </form>
  );
}
