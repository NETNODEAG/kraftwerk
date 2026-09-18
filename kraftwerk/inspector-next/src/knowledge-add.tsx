import { useState } from "react";
import { createBundle, getBundle, putPage } from "./api";
import { Modal } from "./modal";

/** The select's "new collection" choice: a value no real collection can have (names start with a letter or digit). */
const NEW = " new";

/** "Tone of voice: LinkedIn" → "tone-of-voice-linkedin": a file and folder name the knowledge format accepts. */
const slug = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Add a page of knowledge, to an existing collection or a new one. Unlike
 * workflows this is written directly: the API has a write path for pages,
 * and it records a person as the author.
 */
export function AddKnowledgeModal({ bundles, onClose, onAdded }: {
  bundles: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [bundle, setBundle] = useState(bundles[0] ?? NEW);
  const [newName, setNewName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const target = bundle === NEW ? slug(newName) : bundle;
  const id = slug(title);
  const complete = !!target && !!id && !!body.trim();

  const save = async () => {
    if (!complete) return;
    setSaving(true);
    setError("");
    try {
      if (bundle === NEW) {
        if (bundles.includes(target)) throw new Error(`"${target}" already exists — pick it from the list.`);
        await createBundle(target);
      } else if ((await getBundle(target)).concepts.some((p) => p.id === id)) {
        // Writing to an existing id replaces that page: adding must never do that.
        throw new Error(`"${target}" already has a page called "${title.trim()}". Choose another title.`);
      }
      // JSON strings are valid YAML strings, whatever the title contains.
      const frontmatter = [
        "type: Note",
        `title: ${JSON.stringify(title.trim())}`,
        ...(description.trim() ? [`description: ${JSON.stringify(description.trim())}`] : []),
      ];
      await putPage(target, id, `---\n${frontmatter.join("\n")}\n---\n\n${body.trim()}\n`);
      onAdded();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Add knowledge"
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <button type="button" className="quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!complete || saving}>
            {saving ? "Adding…" : "Add"}
          </button>
        </>
      }
    >
      <div className="modal-fields">
        <div className="field-row">
          <label className="field field-grow">
            <span>Collection</span>
            <select value={bundle} onChange={(e) => setBundle(e.target.value)}>
              {bundles.map((b) => (
                <option key={b}>{b}</option>
              ))}
              <option value={NEW}>New collection…</option>
            </select>
          </label>
          {bundle === NEW && (
            <label className="field field-grow">
              <span>Its name</span>
              <input value={newName} placeholder="e.g. Brand voice" onChange={(e) => setNewName(e.target.value)} />
              {newName && slug(newName) !== newName && <p className="field-hint">Saved as "{slug(newName)}"</p>}
            </label>
          )}
        </div>

        <label className="field">
          <span>Title</span>
          <input value={title} autoFocus placeholder="e.g. Tone of voice for LinkedIn" onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="field">
          <span>What it is about</span>
          <input value={description} placeholder="One line, optional" onChange={(e) => setDescription(e.target.value)} />
        </label>

        <label className="field">
          <span>Content</span>
          <p className="field-hint">Write or paste it here — plain text works, Markdown is understood. Agents read this when it is relevant to their work.</p>
          <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>

        {error && (
          <p className="panel-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
