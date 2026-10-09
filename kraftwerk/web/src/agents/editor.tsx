import { useEffect, useState, type ReactNode } from "react";
import { api, failure, useApi } from "../api";
import { EFFORTS, navigate, useFeatures } from "../shared";
import { Button, Checkbox, cn, EmptyState, Field, FieldRow, FormStack, Hint, Notice, Page, Panel, Select, TextArea, TextField, Title } from "../ui";
import { Checks, CODE_AREA } from "./shared";

/**
 * The full agent editor: identity, role and connections, for new and
 * existing agents.
 */

const EMOJI_PRESETS = ["🤖", "🧑‍💻", "🎧", "🛠️", "📊", "✍️", "🔍", "🧹", "📦", "🚀"];

export function AgentEditor({ slug }: { slug?: string }) {
  const [form, setForm] = useState<{
    name: string;
    emoji: string;
    description: string;
    harness: string;
    model: string;
    effort: string;
    group: string;
    system: string;
    workflows: string[];
    knowledge: string[];
    vibeables: string[];
    skillsAll: boolean;
    skills: string[];
  } | null>(slug ? null : defaults());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const wfData = useApi("workflows.list", {});
  const available = wfData?.workflows ?? [];
  const kData = useApi("knowledge.list", {});
  const bundles = kData?.bundles ?? [];
  const features = useFeatures();
  const vData = useApi("vibeables.list", features.vibeables ? {} : null);
  const vibeables = vData?.vibeables ?? [];
  const sData = useApi("skills.list", {});
  const allSkills = sData?.skills ?? [];

  useEffect(() => {
    if (!slug) return;
    api
      .call("agents.get", { slug })
      .then((m) =>
        setForm({
          name: m.name,
          emoji: m.emoji,
          description: m.description ?? "",
          harness: m.harness,
          model: m.model ?? "",
          effort: m.effort ?? "",
          group: m.group ?? "",
          system: m.system,
          workflows: m.workflows,
          knowledge: m.knowledge ?? [],
          vibeables: m.vibeables ?? [],
          skillsAll: m.skills === undefined,
          skills: m.skills ?? [],
        })
      )
      .catch(() => setError("agent not found"));
  }, [slug]);

  function defaults() {
    return {
      name: "",
      emoji: "🤖",
      description: "",
      harness: "claude",
      model: "",
      effort: "",
      group: "",
      system: "",
      workflows: [] as string[],
      knowledge: [] as string[],
      vibeables: [] as string[],
      skillsAll: true,
      skills: [] as string[],
    };
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    // skillsAll = no allowlist: omit the skills key entirely.
    const payload = { ...form, skills: form.skillsAll ? undefined : form.skills };
    const res = slug ? await api.request("agents.save", { slug, body: payload }) : await api.request("agents.create", { body: payload });
    setSaving(false);
    if (!res.ok) setError(failure(res));
    else navigate(`/agents/${encodeURIComponent(res.data.slug)}/info`);
  }

  async function remove() {
    if (!slug || !window.confirm(`Move agent "${slug}" to the trash?`)) return;
    await api.request("agents.delete", { slug }).catch(() => {});
    navigate("/agents");
  }

  if (!form) return <EmptyState>{error || "loading…"}</EmptyState>;
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  // Connect or disconnect one item of a list field.
  const toggleIn = (key: "workflows" | "knowledge" | "vibeables" | "skills", name: string, on: boolean) =>
    set({ [key]: on ? [...form[key], name] : form[key].filter((n) => n !== name) });

  return (
    <Page width="narrow">
      <Title>{slug ? `edit ${slug}` : "new agent"}</Title>
      <Panel>
        <FormStack className="max-w-[680px]">
          <FieldRow>
            <Field label="name" className="flex-1">
              <TextField value={form.name} placeholder="e.g. Max" onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="emoji" className="w-[90px] max-[900px]:w-auto">
              <TextField value={form.emoji} onChange={(e) => set({ emoji: e.target.value })} />
            </Field>
          </FieldRow>
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_PRESETS.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={form.emoji === e}
                className={cn(
                  "cursor-pointer rounded-xl border px-2.5 py-1.5 text-base transition-colors",
                  form.emoji === e ? "border-transparent bg-accent-soft" : "border-line bg-transparent hover:bg-surface-2"
                )}
                onClick={() => set({ emoji: e })}
              >
                {e}
              </button>
            ))}
          </div>
          <FieldRow>
            <Field label="description" className="flex-1">
              <TextField value={form.description} placeholder="one line: what this agent is for" onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <Field label="group" className="w-[180px] max-[900px]:w-auto">
              <TextField value={form.group} placeholder="none" onChange={(e) => set({ group: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="harness" className="w-[140px] max-[900px]:w-auto">
              <Select value={form.harness} onChange={(e) => set({ harness: e.target.value })}>
                <option value="claude">claude</option>
                <option value="codex">codex</option>
                <option value="pi">pi</option>
              </Select>
            </Field>
            <Field label="model" className="flex-1">
              <TextField className="font-mono" value={form.model} placeholder="harness default — e.g. sonnet, gpt-5.6-sol" onChange={(e) => set({ model: e.target.value })} />
            </Field>
            <Field label="effort" className="w-[140px] max-[900px]:w-auto">
              <Select value={form.effort} onChange={(e) => set({ effort: e.target.value })}>
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>
                    {ef || "default"}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <Field label="system prompt — the agent's role">
            <TextArea
              className={CODE_AREA}
              rows={10}
              value={form.system}
              placeholder={"You are the ... for this project. Your job is ..."}
              onChange={(e) => set({ system: e.target.value })}
            />
          </Field>
          <ConnectField label="connected workflows — autoloaded into the agent's context; it can run them">
            {available.map((w) => (
              <Checkbox key={w.slug} checked={form.workflows.includes(w.slug)} onChange={(on) => toggleIn("workflows", w.slug, on)} hint={w.description} mono>{w.slug}</Checkbox>
            ))}
            {available.length === 0 && <Hint className="py-1.5 px-0">no workflows in this project</Hint>}
          </ConnectField>
          <ConnectField label="connected knowledge — OKF bundles the agent consults and maintains">
            {bundles.map((b) => (
              <Checkbox key={b.name} checked={form.knowledge.includes(b.name)} onChange={(on) => toggleIn("knowledge", b.name, on)} hint={`${b.concepts} concepts`} mono>{b.name}</Checkbox>
            ))}
            {bundles.length === 0 && <Hint className="py-1.5 px-0">no knowledge bundles in this project</Hint>}
          </ConnectField>
          {(features.vibeables || form.vibeables.length > 0) && (
            <ConnectField label="apps — small apps the agent builds and maintains" linkKind="vibeables">
              {vibeables.map((v) => (
                <Checkbox key={v.slug} checked={form.vibeables.includes(v.slug)} onChange={(on) => toggleIn("vibeables", v.slug, on)} hint={v.dev ? "dev" : "static"} mono>{v.slug}</Checkbox>
              ))}
              {form.vibeables
                .filter((slug) => !vibeables.some((v) => v.slug === slug))
                .map((slug) => (
                  <Checkbox key={slug} checked onChange={() => toggleIn("vibeables", slug, false)} hint="not found in this workspace" mono>{slug}</Checkbox>
                ))}
              {!features.vibeables && <Hint className="py-1.5 px-0">vibeables are off in this workspace's settings</Hint>}
              {features.vibeables && vibeables.length === 0 && <Hint className="py-1.5 px-0">no vibeables in this workspace yet</Hint>}
            </ConnectField>
          )}
          <ConnectField label="connected skills — workspace skill packages (see the skills tab); invoked with /name in sessions">
            <Checkbox checked={form.skillsAll} onChange={(on) => set({ skillsAll: on })} hint="every discovered skill, including future ones" mono>all skills</Checkbox>
            {!form.skillsAll &&
              allSkills.map((s) => (
                <Checkbox key={s.name} checked={form.skills.includes(s.name)} onChange={(on) => toggleIn("skills", s.name, on)} hint={s.description} mono>{`/${s.name}`}</Checkbox>
              ))}
            {!form.skillsAll && allSkills.length === 0 && <Hint className="py-1.5 px-0">no skills found (.claude/skills, project or user)</Hint>}
          </ConnectField>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex items-center gap-2.5">
            <Button variant="primary" busy={saving} disabled={!form.name.trim()} onClick={save}>
              {saving ? "saving…" : slug ? "save" : "create"}
            </Button>
            <span className="flex-1" />
            {slug && (
              <Button variant="danger" icon="delete" onClick={remove}>
                delete agent
              </Button>
            )}
          </div>
        </FormStack>
      </Panel>
    </Page>
  );
}

/** A labelled checklist in the editor: what the agent is connected to. */
function ConnectField({ label, linkKind, children }: { label: string; linkKind?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5" data-link-kind={linkKind}>
      <span className="text-sm font-semibold text-fg">{label}</span>
      <Checks>{children}</Checks>
    </div>
  );
}
