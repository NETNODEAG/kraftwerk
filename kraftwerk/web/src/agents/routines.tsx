import { useState } from "react";
import { api, failure, useApi } from "../api";
import { Link, navigate, fmtWhen } from "../shared";
import { Button, Field, FieldRow, FormStack, Hint, Notice, Panel, PanelRow, PanelRows, Switch, Tag, TextArea, TextField } from "../ui";
import { SUB } from "./shared";

/**
 * Routines: prompts that message an agent on a cron schedule, managed on its
 * profile.
 */

interface RoutineForm {
  id?: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
}

export function RoutinesPanel({ slug }: { slug: string }) {
  const data = useApi("agents.routines", { slug });
  const routines = data?.routines ?? [];
  const [form, setForm] = useState<RoutineForm | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function post(routine: RoutineForm): Promise<boolean> {
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
      {routines.length > 0 && (
        <PanelRows>
          {routines.map((r) => (
            <PanelRow
              key={r.id}
              icon="schedule"
              title={
                <>
                  {r.name}
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
          <div className="flex items-center gap-2.5">
            <Button
              variant="primary"
              disabled={!form.name.trim() || !form.prompt.trim()}
              onClick={async () => {
                if (await post(form)) setForm(null);
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
      {error && (
        <div className="px-[18px] pb-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Panel>
  );
}
