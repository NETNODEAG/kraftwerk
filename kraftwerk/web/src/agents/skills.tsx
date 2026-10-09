import { useState } from "react";
import { api, useApi } from "../api";
import { Button, Field, FormStack, Hint, IconButton, Notice, Panel, PanelRow, PanelRows, TextArea, TextField } from "../ui";
import { SUB, CODE_AREA } from "./shared";

/**
 * The agent's own skills (agents/<slug>/skills, private to this agent),
 * listed and edited on its profile.
 */

// Frontmatter without a name: the folder name is the skill name, so a
// rename in the form never fights the file contents.
const AGENT_SKILL_TEMPLATE = `---
description: What this skill is for (one line)
---

Instructions this agent follows when the skill applies or is invoked with /<name>.
`;

export function AgentSkillsPanel({ slug }: { slug: string }) {
  const data = useApi("agents.skills", { slug });
  const skills = data?.skills ?? [];
  const [form, setForm] = useState<{ name: string; content: string; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function edit(name: string): Promise<void> {
    setError("");
    const r = await api.request("agents.skill", { slug, name }).catch(() => null);
    if (!r) return void setError("could not load skill");
    if (!r.ok || !r.data || typeof r.data !== "object") return void setError(r.error ?? "could not load skill");
    setForm({ name, content: r.data.content ?? "", isNew: false });
  }

  async function save(): Promise<void> {
    if (!form) return;
    setSaving(true);
    setError("");
    const res = await api.request("agents.saveSkill", { slug, body: { name: form.name, content: form.content } });
    setSaving(false);
    if (!res.ok || !res.data || typeof res.data !== "object") setError(res.error ?? "save failed");
    else setForm(null);
  }

  async function remove(name: string): Promise<void> {
    if (!window.confirm(`Move skill "/${name}" of this agent to the trash?`)) return;
    await api.request("agents.deleteSkill", { slug, name }).catch(() => {});
    if (form?.name === name) setForm(null);
  }

  return (
    <Panel
      title="own skills — only this agent"
      actions={
        !form && (
          <Button
            size="sm"
            icon="add"
            onClick={() => {
              setForm({ name: "", content: AGENT_SKILL_TEMPLATE, isNew: true });
              setError("");
            }}
          >
            new skill
          </Button>
        )
      }
    >
      {skills.length === 0 && !form && (
        <Hint className="px-[18px] py-3 text-xs">
          none — skills in <code>agents/{slug}/skills/</code> are private to this agent; skills for
          every agent live in the workspace skills folder.
        </Hint>
      )}
      {skills.length > 0 && !form && (
        <PanelRows>
          {skills.map((s) => (
            <PanelRow
              key={s.name}
              icon="extension"
              title={`/${s.name}`}
              action={
                <>
                  <Button size="sm" icon="edit" onClick={() => void edit(s.name)}>
                    edit
                  </Button>
                  <IconButton icon="delete" label={`delete /${s.name}`} variant="danger" size="sm" onClick={() => void remove(s.name)} />
                </>
              }
            >
              <span className={SUB}>{s.description || <code>SKILL.md</code>}</span>
            </PanelRow>
          ))}
        </PanelRows>
      )}
      {form && (
        <FormStack className="max-w-[680px]">
          <Field label="name — invoked as /<name>">
            <TextField
              className="font-mono"
              value={form.name}
              placeholder="e.g. report-html"
              disabled={!form.isNew}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="SKILL.md — frontmatter (description) + the instructions">
            <TextArea
              className={CODE_AREA}
              rows={Math.min(28, Math.max(12, form.content.split("\n").length + 2))}
              value={form.content}
              spellCheck={false}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </Field>
          <div className="flex items-center gap-2.5">
            <Button variant="primary" busy={saving} disabled={!form.name.trim()} onClick={() => void save()}>
              {saving ? "saving…" : "save"}
            </Button>
            <Button variant="quiet" disabled={saving} onClick={() => setForm(null)}>
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
