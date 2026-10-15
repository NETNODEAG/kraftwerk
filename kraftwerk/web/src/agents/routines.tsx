import { useState } from "react";
import { api, failure, useApi, type ApiResult } from "../api";
import { refreshAttention, useAttention } from "../attention";
import { Link, navigate, fmtWhen } from "../shared";
import type { RoutineStatus } from "../types";
import { Button, Field, FieldRow, FormStack, Hint, Notice, Panel, PanelRow, PanelRows, Switch, Tag, TextArea, TextField } from "../ui";
import { SUB } from "./shared";

/**
 * Routines: prompts that message an agent on a cron schedule, managed on its
 * profile. Each names its runner (`runs_on: <handle>@<machine>`): it fires
 * only on that machine, and one without a runner fires nowhere until a
 * machine adopts it ("run here" / "run these here").
 */

interface RoutineForm {
  id?: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  /** Untouched: undefined — the server keeps the runner (a new routine: this machine). "": no runner. */
  runsOn?: string;
  private?: boolean;
}

/** An adopt's result in a line: what now runs here, and whether the commit that tells the other clones went through. */
type AdoptResult = ApiResult<"routines.adopt">;
function adoptOutcome(r: AdoptResult): { note: string; error: string } {
  const n = r.adopted.length;
  if (n === 0) return { note: "nothing to adopt — already running here", error: "" };
  const what = n === 1 ? `"${r.adopted[0].name}" runs` : `${n} routines run`;
  if (r.commit && !r.commit.ok) return { note: "", error: `${what} on ${r.runsOn} — routines.yml written, but not committed: ${r.commit.error ?? "git failed"}` };
  return { note: `${what} on ${r.runsOn} now${r.commit ? " — committed" : ""}`, error: "" };
}

/** Where a routine fires, seen from here: a quiet chip, a warning when it fires nowhere. */
function RunnerTag({ r }: { r: RoutineStatus }) {
  if (r.runner === "here") return <Tag title={`runs_on: ${r.runsOn} — this machine fires it`}>runs here</Tag>;
  if (r.runner === "unassigned")
    return (
      <Tag tone={r.enabled ? "ask" : "neutral"} title="no runs_on — it fires on no machine until one adopts it">
        no runner
      </Tag>
    );
  if (r.retired)
    return (
      <Tag tone="ask" title={`${r.runsOn} is a retired identity of this machine — it fires nowhere until reassigned`}>
        runs on {r.runsOn} · retired
      </Tag>
    );
  return <Tag title="another machine fires it, not this one">runs on {r.runsOn}</Tag>;
}

export function RoutinesPanel({ slug }: { slug: string }) {
  const [refresh, setRefresh] = useState(0);
  const data = useApi("agents.routines", { slug }, { refresh });
  const identity = useApi("identity.get", {}, { interval: 60_000 });
  const routines = data?.routines ?? [];
  const [form, setForm] = useState<RoutineForm | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState("");
  const [adopting, setAdopting] = useState("");
  // The fix is workspace-wide ("run these here" adopts every agent's), so the banner counts from attention.
  const runnerItems = (useAttention() ?? []).filter((i) => i.kind === "runner");
  const orphaned = runnerItems.flatMap((i) => i.routines ?? []);
  const hasRetired = runnerItems.some((i) => i.id.startsWith("runner:retired:")) || routines.some((r) => r.retired);
  const orphanedHere = routines.filter((r) => (r.runner === "unassigned" && r.enabled) || r.retired).length;
  const otherAgents = orphaned.filter((x) => x.agent !== slug).length;

  async function post(routine: Omit<RoutineForm, "runsOn"> & { runsOn?: string | null }): Promise<boolean> {
    setError("");
    const res = await api.request("agents.saveRoutine", { slug, body: routine });
    if (!res.ok) {
      setError(failure(res));
      return false;
    }
    return true;
  }

  async function runNow(id: string) {
    setBusyId(id);
    setError("");
    const res = await api.request("agents.runRoutine", { slug, id });
    setBusyId("");
    if (!res.ok) setError(failure(res));
    else if (res.data.chatId) navigate(`/agents/${encodeURIComponent(slug)}/chat/${res.data.chatId}`);
  }

  function adopted(r: AdoptResult) {
    const o = adoptOutcome(r);
    setNote(o.note);
    setError(o.error);
    setRefresh((n) => n + 1);
    refreshAttention();
  }

  async function adoptOne(id: string) {
    setAdopting(id);
    setError("");
    setNote("");
    const res = await api.request("agents.adoptRoutine", { slug, id });
    setAdopting("");
    if (!res.ok) setError(failure(res));
    else adopted(res.data);
  }

  async function adoptAll() {
    setAdopting("*");
    setError("");
    setNote("");
    const res = await api.request("routines.adopt", { body: { retired: hasRetired } });
    setAdopting("");
    if (!res.ok) setError(failure(res));
    else adopted(res.data);
  }

  async function remove(id: string) {
    if (!window.confirm(`Delete the scheduled prompt "${id}"?`)) return;
    await api.request("agents.deleteRoutine", { slug, id }).catch(() => {});
  }

  return (
    <Panel
      title="schedule — prompts that run on their own"
      actions={
        !form && (
          <Button size="sm" icon="add" onClick={() => setForm({ name: "", schedule: "0 9 * * 1-5", prompt: "", enabled: true })}>
            schedule a prompt
          </Button>
        )
      }
    >
      {routines.length === 0 && !form && (
        <Hint className="px-[18px] py-3 text-xs">
          none — a routine messages this agent on a schedule (cron, server local time) and each run
          opens a new session with the result.
        </Hint>
      )}
      {orphanedHere > 0 && (
        <PanelRow
          icon="event_busy"
          title={`${orphanedHere} routine${orphanedHere === 1 ? " fires" : "s fire"} nowhere`}
          action={
            <Button size="sm" icon="download_done" busy={adopting === "*"} onClick={() => void adoptAll()}>
              {adopting === "*" ? "adopting…" : "run these here"}
            </Button>
          }
        >
          <span className={SUB}>
            {hasRetired ? "no runner, or a retired identity" : "no runner"} — makes <code>{identity?.identity ?? "this machine"}</code> the runner
            {otherAgents > 0 ? ` of these and ${otherAgents} on other agents` : ""} and commits routines.yml
          </span>
        </PanelRow>
      )}
      {routines.length > 0 && (
        <PanelRows>
          {routines.map((r) => (
            <PanelRow
              key={r.id}
              icon="schedule"
              title={
                <>
                  {r.name}
                  <RunnerTag r={r} />
                  {r.lastError && (
                    <span title={r.lastError}>
                      <Tag tone="bad">error</Tag>
                    </span>
                  )}
                  {r.awaitingApproval && r.lastChatId && (
                    <Tag
                      href={`/agents/${encodeURIComponent(slug)}/chat/${r.lastChatId}`}
                      tone="bad"
                      title="the last run asked for a permission nobody has answered yet"
                    >
                      needs approval
                    </Tag>
                  )}
                </>
              }
              action={
                <>
                  {r.runner !== "here" && (
                    <Button
                      size="sm"
                      variant="quiet"
                      busy={adopting === r.id}
                      title={`make ${identity?.identity ?? "this machine"} its runner and commit routines.yml`}
                      onClick={() => void adoptOne(r.id)}
                    >
                      {adopting === r.id ? "adopting…" : "run here"}
                    </Button>
                  )}
                  <Button size="sm" icon="play_arrow" busy={busyId === r.id} onClick={() => runNow(r.id)}>
                    {busyId === r.id ? "starting…" : "run"}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      setForm({
                        id: r.id,
                        name: r.name,
                        schedule: r.schedule,
                        prompt: r.prompt,
                        enabled: r.enabled,
                        runsOn: r.runsOn ?? "",
                        private: r.private ?? false,
                      })
                    }
                  >
                    edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void remove(r.id)}>
                    delete
                  </Button>
                  <Switch checked={r.enabled} label={r.enabled ? "enabled — click to pause" : "paused — click to enable"} onChange={() =>
                      void post({
                        id: r.id,
                        name: r.name,
                        schedule: r.schedule,
                        prompt: r.prompt,
                        enabled: !r.enabled,
                      })
                    } />
                </>
              }
            >
              <span className={SUB}>
                <code>{r.schedule}</code>
                {!r.enabled
                  ? " · paused"
                  : r.nextRunAt
                    ? ` · next ${fmtWhen(r.nextRunAt)}`
                    : ""}
                {" · "}
                {r.lastChatId ? (
                  <Link href={`/agents/${encodeURIComponent(slug)}/chat/${r.lastChatId}`}>
                    last run {fmtWhen(r.lastRunAt)}
                  </Link>
                ) : (
                  "never ran"
                )}
              </span>
            </PanelRow>
          ))}
        </PanelRows>
      )}
      {form && (
        <FormStack className="max-w-[680px]">
          <FieldRow>
            <Field label="name" className="flex-1">
              <TextField value={form.name} placeholder="e.g. Morning report" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="schedule (cron)" className="w-[200px] max-[900px]:w-auto">
              <TextField className="font-mono" value={form.schedule} placeholder="0 9 * * 1-5" onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
            </Field>
            <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-fg">
              <input type="checkbox" className="accent-accent" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              enabled
            </label>
          </FieldRow>
          <Field label="prompt — what to ask this agent on each run">
            <TextArea rows={5} value={form.prompt} placeholder="Check ... and summarize what changed." onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          </Field>
          <FieldRow>
            <Field label="runs on — the one machine that fires it" className="flex-1">
              <TextField
                className="font-mono"
                value={form.runsOn ?? identity?.identity ?? ""}
                placeholder="<handle>@<machine> — empty: no runner"
                onChange={(e) => setForm({ ...form, runsOn: e.target.value })}
              />
            </Field>
            <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-fg" title="stored in routines.yml; nothing reads it yet">
              <input type="checkbox" className="accent-accent" checked={form.private ?? false} onChange={(e) => setForm({ ...form, private: e.target.checked })} />
              private
            </label>
          </FieldRow>
          {identity && (
            <Hint>
              This machine is <code>{identity.identity}</code>. Empty: no runner — it fires nowhere.
            </Hint>
          )}
          <div className="flex items-center gap-2.5">
            <Button
              variant="primary"
              disabled={!form.name.trim() || !form.prompt.trim()}
              onClick={async () => {
                const { runsOn, ...rest } = form;
                // Untouched runner: left out, so the server keeps it (a new routine gets this machine).
                const body = runsOn === undefined ? rest : { ...rest, runsOn: runsOn.trim() || null };
                if (await post(body)) setForm(null);
              }}
            >
              {form.id ? "save" : "add to the schedule"}
            </Button>
            <Button variant="quiet" onClick={() => (setForm(null), setError(""))}>
              cancel
            </Button>
          </div>
        </FormStack>
      )}
      {(error || note) && (
        <div className="px-[18px] pb-3">
          {error ? <Notice tone="bad">{error}</Notice> : <Notice>{note}</Notice>}
        </div>
      )}
    </Panel>
  );
}
