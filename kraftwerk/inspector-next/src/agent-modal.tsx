import { useEffect, useState } from "react";
import { EFFORTS, getAgent, listKnowledge, listWorkflows, saveAgent, type AgentDetail, type Harness } from "./api";
import { Modal } from "./modal";

type Draft = Omit<AgentDetail, "slug"> & { slug?: string };

const BLANK: Draft = { name: "", emoji: "🤖", description: "", harness: "claude", workflows: [], knowledge: [], system: "" };

/** A set of names as checkboxes; names the agent holds that no longer exist stay listed, so a save never drops them silently. */
function Checks({ legend, hint, options, value, onChange }: {
  legend: string;
  hint: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const all = [...options, ...value.filter((v) => !options.includes(v))];
  return (
    <fieldset className="field">
      <legend>{legend}</legend>
      <p className="field-hint">{hint}</p>
      {all.length === 0 && <p className="field-hint">None in this workspace yet.</p>}
      <div className="checks">
        {all.map((name) => (
          <label key={name} className="check">
            <input
              type="checkbox"
              checked={value.includes(name)}
              onChange={(e) => onChange(e.target.checked ? [...value, name] : value.filter((v) => v !== name))}
            />
            {name}
            {!options.includes(name) && <span className="field-hint"> (not found)</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Create or edit an agent. `slug` undefined = a new agent. */
export function AgentModal({ slug, onClose, onSaved }: {
  slug: string | undefined;
  onClose: () => void;
  onSaved: (agent: AgentDetail, created: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(slug ? null : BLANK);
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [bundles, setBundles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  useEffect(() => {
    let alive = true;
    if (slug) getAgent(slug).then((a) => alive && setDraft(a)).catch((err: Error) => alive && setError(err.message));
    listWorkflows().then((d) => alive && setWorkflows(d.workflows.map((w) => w.slug))).catch(() => {});
    listKnowledge().then((d) => alive && setBundles(d.bundles.map((b) => b.name))).catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      onSaved(await saveAgent(draft), !slug);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={slug ? "Edit agent" : "New agent"}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <button type="button" className="quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!draft || saving || !draft.name.trim()}>
            {saving ? "Saving…" : slug ? "Save" : "Create agent"}
          </button>
        </>
      }
    >
      {!draft && !error && <p className="field-hint">Loading…</p>}

      {draft && (
        <div className="modal-fields">
          <div className="field-row">
            <label className="field field-emoji">
              <span>Icon</span>
              <input value={draft.emoji} maxLength={8} onChange={(e) => set({ emoji: e.target.value })} />
            </label>
            <label className="field field-grow">
              <span>Name</span>
              <input value={draft.name} required autoFocus={!slug} placeholder="e.g. Anna – SEO reviewer" onChange={(e) => set({ name: e.target.value })} />
            </label>
          </div>

          <label className="field">
            <span>What they do</span>
            <input value={draft.description ?? ""} placeholder="One line, shown where people pick an agent" onChange={(e) => set({ description: e.target.value })} />
          </label>

          <label className="field">
            <span>Role</span>
            <p className="field-hint">How this agent works and what it pays attention to — it reads this at the start of every session.</p>
            <textarea rows={6} value={draft.system} onChange={(e) => set({ system: e.target.value })} />
          </label>

          <Checks
            legend="Workflows"
            hint="The workflows this agent knows and may run."
            options={workflows}
            value={draft.workflows}
            onChange={(next) => set({ workflows: next })}
          />
          <Checks
            legend="Knowledge"
            hint="The knowledge this agent consults and keeps current."
            options={bundles}
            value={draft.knowledge}
            onChange={(next) => set({ knowledge: next })}
          />

          <details className="advanced">
            <summary>Advanced</summary>
            <div className="field-row">
              <label className="field">
                <span>Runs on</span>
                <select value={draft.harness} onChange={(e) => set({ harness: e.target.value as Harness })}>
                  <option>claude</option>
                  <option>codex</option>
                  <option>pi</option>
                </select>
              </label>
              <label className="field field-grow">
                <span>Model</span>
                <input value={draft.model ?? ""} placeholder="default" onChange={(e) => set({ model: e.target.value })} />
              </label>
              <label className="field">
                <span>Effort</span>
                <select value={draft.effort ?? ""} onChange={(e) => set({ effort: e.target.value || undefined })}>
                  <option value="">default</option>
                  {EFFORTS.map((e) => (
                    <option key={e}>{e}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </div>
      )}

      {error && (
        <p className="panel-error modal-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
