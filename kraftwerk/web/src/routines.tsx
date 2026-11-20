import { useEffect, useState } from "react";
import { api, failure, useApi, type ApiResult } from "./api";
import { refreshAttention } from "./attention";
import { ChatCard, startChat, useOpen } from "./chat-card";
import { Icon, Link, fmtWhen, navigate, useFeatures } from "./shared";
import { Button, EmptyState, Notice, Select, Tag, TextArea, TextField } from "./ui";

/**
 * A routine on Artifacts' right column and in the routines overview,
 * edited where it shows. A workspace routine (agents/routines.yml, owner
 * "_") is defined on its own: what to ask and when, the project it runs in
 * (none: the whole workspace) and who gets the prompt (none: the project's
 * assistant, or Ralv). An agent's own routine (agents/<slug>/routines.yml)
 * is edited the same way, except that it always asks its agent and has no
 * project — the agent's profile lists it too.
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
  // "custom (cron)" picked for a line the picker could also say in words: the line stays, the field shows.
  const [customCron, setCustomCron] = useState(false);
  // "change in a chat": what should change, asked of the agent behind the routine.
  const [ask, setAsk] = useState<string | null>(null);
  const open = useOpen();
  // The form follows the routine picked, not every poll: what is being typed stays.
  useEffect(() => {
    setForm(isNew ? BLANK : r ? formOf(r) : null);
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

  if (!form) return <EmptyState className="my-auto">loading…</EmptyState>;

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  // An agent's own routine always asks its agent and runs in no project; the workspace's names both.
  const agentOwn = owner !== WORKSPACE_ROUTINES;
  const team = (agents?.agents ?? []).filter((a) => !a.archived || a.slug === form.agent);
  const save = () =>
    act("save", async () => {
      const { runsOn, project, agent, ...rest } = form;
      // Untouched runner: left out, so the server keeps it (a new routine gets this machine).
      const runner = runsOn === undefined ? {} : { runsOn: runsOn.trim() || null };
      const res = agentOwn
        ? await api.request("agents.saveRoutine", { slug: owner, body: { ...rest, ...runner } })
        : await api.request("routines.save", { body: { ...rest, project: project || null, agent: agent || null, ...runner } });
      if (!res.ok) throw new Error(failure(res));
      setNote("saved");
      if (isNew) onOpen(`routines:${WORKSPACE_ROUTINES}:${res.data.id}`);
    });
  const adopt = () =>
    act("adopt", async () => {
      const res = agentOwn ? await api.request("agents.adoptRoutine", { slug: owner, id }) : await api.request("routines.adoptOne", { id });
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
      const res = agentOwn ? await api.request("agents.deleteRoutine", { slug: owner, id }) : await api.request("routines.delete", { id });
      if (!res.ok) throw new Error(failure(res));
      onOpen(undefined);
    });
  };

  // The routine's own agent (or, for a workspace routine, the project's assistant or Ralv) changes it with the CLI.
  const changeInChat = () =>
    act("chat", async () => {
      if (!r || !ask?.trim()) return;
      const res = await startChat({ who: agentOwn ? owner : undefined, project: r.project ?? undefined, text: routineChangeMessage(r, ask.trim()) });
      if ("error" in res) throw new Error(res.error);
      setAsk(null);
      open(res.href);
    });

  const read = readCron(form.schedule);
  const sched: Sched = customCron ? { ...read, kind: "custom" } : read;
  const setSched = (patch: Partial<Sched>) => {
    if (patch.kind === "custom") return setCustomCron(true);
    if (patch.kind) setCustomCron(false);
    // Leaving a line the words cannot say starts from the weekday default's time.
    set({ schedule: cronOf({ ...read, ...patch, kind: patch.kind ?? (read.kind === "custom" ? "weekdays" : read.kind) }) });
  };
  const QUIET = "h-8 w-auto max-w-[220px] rounded-full border-0 bg-transparent text-sm font-medium hover:bg-surface-2";
  return (
    // A routine is a message sent on a schedule: the chat window holds what is asked and of whom, the line inside it when.
    <div className="routine-form flex flex-col gap-3 p-3">
      <input
        value={form.name}
        aria-label="name"
        placeholder="Name the routine, e.g. Morning report"
        className="w-full border-0 bg-transparent p-0 font-[inherit] text-xl font-semibold text-fg shadow-none outline-none placeholder:font-normal placeholder:text-fg-2 focus:shadow-none focus:outline-none"
        onChange={(e) => set({ name: e.target.value })}
      />
      {r && <State r={r} />}
      <ChatCard
        label="what the routine asks"
        chip={
          <>
            <Icon name="schedule" className="ms-sm" /> {scheduleWords(form.schedule)}
          </>
        }
        chipTitle={`cron: ${form.schedule}`}
        value={form.prompt}
        onChange={(prompt) => set({ prompt })}
        inputLabel="prompt — what to ask on each run"
        placeholder="What to ask on each run, e.g. Check … and summarize what changed."
        onSend={() => void save()}
        sendLabel={isNew ? "add the routine" : "save"}
        sendIcon="check"
        busy={busy === "save"}
        disabled={!form.name.trim() || !form.prompt.trim() || !!busy}
        skills
        who={form.agent}
        hint={note || (form.agent ? "in a new session each time" : form.project ? "asks the project's assistant" : "asks Ralv")}
        controls={
          agentOwn ? (
            <Link href={`/agents/${encodeURIComponent(owner)}/info`} className="inline-flex h-8 items-center px-2 text-sm font-medium text-fg no-underline hover:text-accent" title="an agent's own routine always asks its agent — it lives on the agent's profile">
              {r?.agent ? routineWho(r) : owner}
            </Link>
          ) : (
          <>
            <Select aria-label="who" value={form.agent} onChange={(e) => set({ agent: e.target.value })} className={QUIET}>
              <option value="">{form.project ? "🧭 the project's assistant" : "🎩 Ralv"}</option>
              {team.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.emoji} {a.name}
                </option>
              ))}
            </Select>
            {features.projects && (
              <Select aria-label="runs in" value={form.project} onChange={(e) => set({ project: e.target.value })} className={QUIET} title={form.project ? "its runs are filed under the project" : "not tied to a project"}>
                <option value="">the whole workspace</option>
                {(projects?.projects ?? []).map((p) => (
                  <option key={p.slug} value={p.slug}>
                    📁 {p.title}
                  </option>
                ))}
                {form.project && !projects?.projects.some((p) => p.slug === form.project) && <option value={form.project}>📁 {form.project}</option>}
              </Select>
            )}
          </>
          )
        }
      >
        {/* When: in words, with the cron line for what the words cannot say. */}
        <div className="routine-when flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-line px-2.5 py-1.5 text-sm text-fg-2">
          <Select aria-label="repeats" value={sched.kind} onChange={(e) => setSched({ kind: e.target.value as Sched["kind"] })} className={QUIET}>
            <option value="weekdays">every weekday</option>
            <option value="daily">every day</option>
            <option value="weekly">every week</option>
            <option value="hourly">every hour</option>
            <option value="custom">custom (cron)</option>
          </Select>
          {sched.kind === "weekly" && (
            <Select aria-label="weekday" value={sched.day} onChange={(e) => setSched({ day: e.target.value })} className={QUIET}>
              {DAYS.map((d, i) => (
                <option key={d} value={String(i)}>
                  on {d}
                </option>
              ))}
            </Select>
          )}
          {(sched.kind === "weekdays" || sched.kind === "daily" || sched.kind === "weekly") && (
            <label className="inline-flex items-center gap-1.5 px-1">
              at
              <input type="time" aria-label="time" value={sched.time} className="h-8 rounded-control border border-line bg-surface px-2 font-[inherit] text-sm text-fg" onChange={(e) => e.target.value && setSched({ time: e.target.value })} />
            </label>
          )}
          {sched.kind === "hourly" && (
            <label className="inline-flex items-center gap-1.5 px-1">
              at minute
              <input type="number" min={0} max={59} aria-label="minute" value={sched.minute} className="h-8 w-16 rounded-control border border-line bg-surface px-2 font-[inherit] text-sm text-fg" onChange={(e) => setSched({ minute: String(Math.min(59, Math.max(0, Number(e.target.value) || 0))) })} />
            </label>
          )}
          {sched.kind === "custom" && (
            <TextField className="h-8 w-[180px] font-mono text-sm" aria-label="schedule (cron)" value={form.schedule} placeholder="0 9 * * 1-5" title="minute hour day month weekday, this machine's time" onChange={(e) => set({ schedule: e.target.value })} />
          )}
          <span className="flex-1" />
          <label className="inline-flex cursor-pointer items-center gap-1.5 px-1 text-fg" title="a paused routine keeps its schedule and fires nowhere">
            <input type="checkbox" className="accent-accent" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            enabled
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 px-1 text-fg" title="its runs stay off what remote members and paired devices see">
            <input type="checkbox" className="accent-accent" checked={form.private} onChange={(e) => set({ private: e.target.checked })} />
            private
          </label>
        </div>
      </ChatCard>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-fg-2">
        <label className="inline-flex min-w-0 items-center gap-1.5" title={`the one machine that fires it${identity ? ` — this machine is ${identity.identity}` : ""}; empty: no runner, it fires nowhere`}>
          runs on
          <TextField className="h-7 w-[200px] font-mono text-xs" aria-label="runs on" value={form.runsOn ?? identity?.identity ?? ""} placeholder="<handle>@<machine>" onChange={(e) => set({ runsOn: e.target.value })} />
        </label>
        <span className="flex-1" />
        {r && (
          <>
            {r.runner !== "here" && (
              <Button size="sm" variant="quiet" busy={busy === "adopt"} disabled={!!busy} onClick={() => void adopt()} title={`make ${identity?.identity ?? "this machine"} its runner and commit routines.yml`}>
                run here
              </Button>
            )}
            <Button size="sm" variant="quiet" icon="forum" disabled={!!busy} onClick={() => setAsk(ask === null ? "" : null)} title={`describe the change; ${agentOwn ? routineWho(r) : "an assistant"} makes it in a new chat`}>
              change in a chat
            </Button>
            <Button size="sm" icon="play_arrow" busy={busy === "run"} disabled={!!busy} onClick={() => void runNow()} title="start a run with the saved prompt, now">
              {busy === "run" ? "starting…" : "run now"}
            </Button>
            <Button size="sm" variant="quiet" icon="delete" disabled={!!busy} onClick={remove}>
              delete
            </Button>
          </>
        )}
      </div>
      {r && ask !== null && (
        <div className="routine-chat flex flex-col gap-2 rounded-card border border-line bg-surface p-2.5">
          <TextArea
            autoFocus
            rows={2}
            aria-label="what should change"
            placeholder={`What should change? ${agentOwn ? routineWho(r) : "The assistant"} updates the routine in a new chat, e.g. "run it at 7:00 and add Avia to the providers"`}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void changeInChat();
              if (e.key === "Escape") setAsk(null);
            }}
            className="text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="quiet" onClick={() => setAsk(null)}>
              cancel
            </Button>
            <Button size="sm" variant="primary" icon="send" busy={busy === "chat"} disabled={!ask.trim() || !!busy} onClick={() => void changeInChat()}>
              open the chat
            </Button>
          </div>
        </div>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}

/**
 * The first message of a "change in a chat": the change asked for, the
 * routine as it is now, and how to change it — the CLI with the same id, so
 * the routine is updated in place, not added beside it.
 */
export function routineChangeMessage(r: ListedRoutine, change: string): string {
  const own = r.owner !== WORKSPACE_ROUTINES;
  return [
    `Change the routine "${r.name}" (id \`${r.id}\`, ${own ? `${r.agent?.name ?? r.owner}'s own routine` : "a workspace routine"}): ${change}`,
    "",
    `As it is now: schedule \`${r.schedule}\` (${scheduleWords(r.schedule)}), ${r.enabled ? "enabled" : "paused"}${r.project ? `, runs in project ${r.project}` : ""}${!own ? `, asks ${routineWho(r)}` : ""}. Its prompt:`,
    "",
    r.prompt
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n"),
    "",
    `Update it in place with \`npx kraftwerk routines add ${r.owner} --id ${r.id} --name "…" --schedule "…" --prompt "…"\` — the same id updates it (name, schedule and the whole prompt as they should be; project, agent and runner stay unless you pass them${r.enabled ? "" : "; --disabled keeps it paused"}); \`npx kraftwerk routines list ${r.owner}\` shows the result. If the request is unclear, ask me first. Then say in one or two sentences what changed.`,
  ].join("\n");
}

/* ---------- the schedule in words ---------- */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
interface Sched {
  kind: "weekdays" | "daily" | "weekly" | "hourly" | "custom";
  /** HH:MM, for the daily kinds. */
  time: string;
  /** 0 (Sunday) – 6, for "every week". */
  day: string;
  /** For "every hour". */
  minute: string;
}

/** A cron line as the picker's choices; what the picker cannot say is "custom" and stays the line it is. */
export function readCron(cron: string): Sched {
  const base: Sched = { kind: "custom", time: "09:00", day: "1", minute: "0" };
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return base;
  const [mi, h, dom, mon, dow] = f;
  const num = (x: string, max: number) => /^\d{1,2}$/.test(x) && Number(x) <= max;
  if (dom !== "*" || mon !== "*" || !num(mi, 59)) return base;
  if (h === "*" && dow === "*") return { ...base, kind: "hourly", minute: String(Number(mi)) };
  if (!num(h, 23)) return base;
  const time = `${h.padStart(2, "0")}:${mi.padStart(2, "0")}`;
  if (dow === "1-5") return { ...base, kind: "weekdays", time };
  if (dow === "*") return { ...base, kind: "daily", time };
  if (/^[0-7]$/.test(dow)) return { ...base, kind: "weekly", time, day: String(Number(dow) % 7) };
  return base;
}

/** The cron line of the picker's choices ("custom" is typed, not built). */
export function cronOf(s: Sched): string {
  const [h, m] = s.time.split(":").map((x) => String(Number(x) || 0));
  if (s.kind === "hourly") return `${Number(s.minute) || 0} * * * *`;
  if (s.kind === "daily") return `${m} ${h} * * *`;
  if (s.kind === "weekly") return `${m} ${h} * * ${s.day}`;
  return `${m} ${h} * * 1-5`;
}

/** "weekdays 09:00", "Mondays 08:30", "hourly at :15" — or the cron line itself. */
export function scheduleWords(cron: string): string {
  const s = readCron(cron);
  if (s.kind === "weekdays") return `weekdays ${s.time}`;
  if (s.kind === "daily") return `daily ${s.time}`;
  if (s.kind === "weekly") return `${DAYS[Number(s.day)]}s ${s.time}`;
  if (s.kind === "hourly") return `hourly at :${s.minute.padStart(2, "0")}`;
  return cron.trim() || "no schedule";
}
