import { useEffect, useState } from "react";
import { getBundle, getPage, listKnowledge, type KnowledgePage, type TrustTier } from "./api";
import { EditIcon } from "./icons";
import { AddKnowledgeModal } from "./knowledge-add";
import { Markdown } from "./markdown";
import { Modal } from "./modal";

interface Bundle {
  name: string;
  pages: number;
  updatedAt?: string;
}

/** Who stands behind a page, in words a reader outside the project understands. */
const TRUST: Record<TrustTier, { text: string; tone: "ok" | "live" | "muted" }> = {
  "human-reviewed": { text: "reviewed by a person", tone: "ok" },
  "machine-confirmed": { text: "confirmed by an agent", tone: "live" },
  unverified: { text: "not reviewed yet", tone: "muted" },
};

/** One page in the bundle's modal: its body is fetched when it is first unfolded. */
function Page({ page }: { page: KnowledgePage }) {
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState("");
  const trust = TRUST[page.trustTier] ?? TRUST.unverified;

  const load = () => {
    if (body !== null) return;
    getPage(page.bundle, page.id)
      .then((p) => setBody(p.body))
      .catch((err: Error) => setError(err.message));
  };

  return (
    <li>
      <details onToggle={(e) => e.currentTarget.open && load()}>
        <summary>
          <span className="step-name">{page.title}</span>
          <span className={`step-kind kn-tone tone-${trust.tone}`}>
            {trust.text}
            {page.stale && " · out of date"}
          </span>
        </summary>
        <div className="kn-body">
          {error && <p className="wf-error">{error}</p>}
          {body === null && !error && <p className="field-hint">Loading…</p>}
          {body !== null && <Markdown text={body} />}
        </div>
      </details>
    </li>
  );
}

/**
 * A bundle's modal, shaped like a workflow's: what is there, then what should
 * change. The change goes to the chat — agents write knowledge through the
 * kraftwerk CLI, which records who wrote what.
 */
function BundleModal({ bundle, onClose, onRequestChange }: {
  bundle: Bundle;
  onClose: () => void;
  onRequestChange: (change: string) => void;
}) {
  const [pages, setPages] = useState<KnowledgePage[] | null>(null);
  const [error, setError] = useState("");
  const [change, setChange] = useState("");

  useEffect(() => {
    let alive = true;
    getBundle(bundle.name)
      .then((b) => alive && setPages(b.concepts))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [bundle.name]);

  return (
    <Modal
      title={bundle.name}
      onClose={onClose}
      onSubmit={() => change.trim() && onRequestChange(change.trim())}
      footer={
        <>
          <button type="button" className="quiet" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="primary" disabled={!change.trim()}>
            Request change
          </button>
        </>
      }
    >
      <div className="modal-fields">
        {error && (
          <p className="panel-error modal-error" role="alert">
            {error}
          </p>
        )}
        {!pages && !error && <p className="field-hint">Loading…</p>}
        {pages && (
          <div className="field">
            <span>Pages</span>
            {pages.length === 0 && <p className="field-hint">No pages yet.</p>}
            {pages.length > 0 && (
              <ul className="steps">
                {pages.map((p) => (
                  <Page key={p.id} page={p} />
                ))}
              </ul>
            )}
          </div>
        )}

        <label className="field">
          <span>What should change?</span>
          <p className="field-hint">Describe what to add, correct or remove, and the open conversation makes the change.</p>
          <textarea
            rows={3}
            value={change}
            placeholder="e.g. Add a page about our tone of voice for LinkedIn posts."
            onChange={(e) => setChange(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

function BundleCard({ bundle, onEdit }: { bundle: Bundle; onEdit: (change: string) => void }) {
  const [editing, setEditing] = useState(false);
  const updated = bundle.updatedAt && new Date(bundle.updatedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

  return (
    <li className="wf kn">
      <div className="wf-head">
        <h3>{bundle.name}</h3>
        <div className="wf-actions">
          <button className="icon" title="Edit" aria-label={`Edit ${bundle.name}`} onClick={() => setEditing(true)}>
            <EditIcon />
          </button>
        </div>
      </div>
      <p className="wf-desc">
        {bundle.pages} {bundle.pages === 1 ? "page" : "pages"}
        {updated && ` · updated ${updated}`}
      </p>
      {editing && (
        <BundleModal
          bundle={bundle}
          onClose={() => setEditing(false)}
          onRequestChange={(change) => {
            setEditing(false);
            onEdit(change);
          }}
        />
      )}
    </li>
  );
}

/** The knowledge tab: one card per bundle, built like a workflow's card. */
export function Knowledge({ onEdit }: {
  /** A change asked for in a bundle's modal: its name, its absolute folder, the change in words. */
  onEdit: (bundle: string, folder: string, change: string) => void;
}) {
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    listKnowledge()
      .then((d) => {
        if (!alive) return;
        setRoot(d.root ?? "");
        setBundles(d.bundles.map((b) => ({ name: b.name, pages: b.concepts, updatedAt: b.updatedAt })));
      })
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <>
      {error && (
        <div className="panel-error" role="alert">
          {error}
        </div>
      )}
      <ul className="wf-list">
        <li>
          <button className="add-card kn-add" onClick={() => setAdding(true)}>
            <span aria-hidden>＋</span> Add knowledge
          </button>
        </li>
        {bundles?.length === 0 && <li className="panel-empty">This workspace has no knowledge yet.</li>}
        {bundles?.map((b) => (
          <BundleCard key={b.name} bundle={b} onEdit={(change) => onEdit(b.name, root ? `${root}/${b.name}` : b.name, change)} />
        ))}
      </ul>
      {adding && (
        <AddKnowledgeModal
          bundles={bundles?.map((b) => b.name) ?? []}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}
