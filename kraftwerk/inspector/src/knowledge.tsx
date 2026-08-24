import { useEffect, useState } from "react";
import type { BundleDetail, BundleInfo, ConceptDetail, KnowledgeIndex } from "./types";
import { createChatAndOpen } from "./chat";
import { Link, usePoll } from "./shared";

/**
 * Context & Knowledge: OKF bundles under the project's knowledge/ root.
 * Sidebar lists bundles; a bundle page lists its concepts with trust
 * tier / status / staleness; a concept page shows frontmatter (provenance,
 * sources, verification) plus the markdown body, with a human-verify
 * button and a "curate in chat" entry that opens a knowledge-scoped chat.
 */

export function KnowledgeScreen({ bundle, conceptId }: { bundle?: string; conceptId?: string }) {
  const data = usePoll<KnowledgeIndex>("/api/knowledge", false);
  const bundles = data?.bundles ?? [];

  return (
    <div className="runs-screen">
      <aside className="runs-side">
        <div className="side-head">
          <span className="microlabel">bundles</span>
          <span className="spacer" />
          <Link href="/knowledge" className="open-raw">
            + new
          </Link>
        </div>
        <div className="side-list">
          {bundles.map((b) => (
            <Link
              key={b.name}
              href={`/knowledge/${encodeURIComponent(b.name)}`}
              className={`side-row ${b.name === bundle ? "active" : ""}`}
            >
              <span className="lamp ok" />
              <div className="side-row-body">
                <div className="side-row-top">
                  <span className="side-wf">{b.name}</span>
                  <span className="side-when num">{b.concepts}</span>
                </div>
                <div className="side-row-sub">
                  <span className="side-req">
                    {b.okfVersion ? `okf ${b.okfVersion}` : "okf"}
                    {b.updatedAt ? ` · ${b.updatedAt.slice(0, 10)}` : ""}
                  </span>
                </div>
              </div>
            </Link>
          ))}
          {data && bundles.length === 0 && <div className="viewer-note">no bundles yet</div>}
        </div>
      </aside>
      <div className="runs-main">
        {bundle && conceptId ? (
          <ConceptView key={`${bundle}/${conceptId}`} bundle={bundle} conceptId={conceptId} />
        ) : bundle ? (
          <BundleView key={bundle} name={bundle} />
        ) : (
          <KnowledgeHome root={data?.root} />
        )}
      </div>
    </div>
  );
}

/* ---------- home / new bundle ---------- */

function KnowledgeHome({ root }: { root?: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    setError("");
    const res = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    const body = await res.json();
    setCreating(false);
    if (body.error) setError(body.error);
    else window.location.hash = `/knowledge/${encodeURIComponent(n)}`;
  }

  return (
    <div className="new-chat">
      <div className="page-head">
        <h1>context &amp; knowledge</h1>
      </div>
      <section className="panel new-chat-panel">
        <div className="panel-head">
          <span className="microlabel">what lives here</span>
        </div>
        <div className="know-intro">
          Curated knowledge as <b>OKF bundles</b> (Open Knowledge Format v0.2): plain markdown
          files with YAML frontmatter{root ? <> under <code>{root}</code></> : null}, readable by
          humans and agents, diffable in git. Agents write through{" "}
          <code>kraftwerk knowledge put</code> (provenance is stamped automatically); you raise a
          concept's trust tier by verifying it here.
        </div>
        <div className="panel-head">
          <span className="microlabel">new bundle</span>
        </div>
        <div className="know-newbundle">
          <input
            value={name}
            placeholder="bundle name, e.g. customer-support"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <button className="run-btn" disabled={!name.trim() || creating} onClick={create}>
            {creating ? "creating…" : "create"}
          </button>
        </div>
        {error && <div className="msg error">✕ {error}</div>}
      </section>
    </div>
  );
}

/* ---------- bundle ---------- */

function TrustBadge({ tier }: { tier: string }) {
  return <span className={`chip trust ${tier}`}>{tier}</span>;
}

function BundleView({ name }: { name: string }) {
  const data = usePoll<BundleDetail | { error: string }>(
    `/api/knowledge/${encodeURIComponent(name)}`,
    false
  );
  if (!data) return <div className="empty">loading…</div>;
  if ("error" in data) return <div className="empty">bundle not found</div>;

  return (
    <div>
      <div className="page-head">
        <h1>{name}</h1>
        <span className="count">{data.concepts.length} concepts</span>
        <span className="spacer" />
        <button
          className="run-btn"
          onClick={() => void createChatAndOpen("claude", { kind: "knowledge", bundle: name })}
        >
          curate in chat
        </button>
      </div>
      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">concepts</span>
        </div>
        {data.concepts.length === 0 ? (
          <div className="viewer-note">
            No concepts yet — start a chat to author some, or write one with{" "}
            <code>kraftwerk knowledge put {name}/&lt;path&gt;</code>.
          </div>
        ) : (
          <table className="know-table">
            <tbody>
              {groupByFolder(data.concepts).map(({ folder, concepts }) => (
                <FolderGroup key={folder || "."} name={name} folder={folder} concepts={concepts} />
              ))}
            </tbody>
          </table>
        )}
      </section>
      {data.log && (
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">log</span>
          </div>
          <div className="viewer-body">
            <pre>{data.log}</pre>
          </div>
        </section>
      )}
    </div>
  );
}

/** Group concepts by their directory within the bundle, root first. */
function groupByFolder(concepts: BundleDetail["concepts"]) {
  const groups = new Map<string, BundleDetail["concepts"]>();
  for (const c of concepts) {
    const folder = c.id.includes("/") ? c.id.slice(0, c.id.lastIndexOf("/")) : "";
    (groups.get(folder) ?? groups.set(folder, []).get(folder)!).push(c);
  }
  return [...groups.keys()]
    .sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map((folder) => ({ folder, concepts: groups.get(folder)! }));
}

function FolderGroup({
  name,
  folder,
  concepts,
}: {
  name: string;
  folder: string;
  concepts: BundleDetail["concepts"];
}) {
  return (
    <>
      {folder && (
        <tr className="know-folder-row">
          <td colSpan={4}>
            <span className="know-folder">▸ {folder}/</span>
          </td>
        </tr>
      )}
      {concepts.map((c) => (
        <tr key={c.id}>
          <td className={folder ? "know-indent" : undefined}>
            <Link href={`/knowledge/${encodeURIComponent(name)}/${c.id}`}>
              <b>{c.title}</b>{" "}
              <span className="know-id">{folder ? c.id.slice(folder.length + 1) : c.id}.md</span>
            </Link>
          </td>
          <td className="know-type">{c.type ?? "?"}</td>
          <td>
            <TrustBadge tier={c.trustTier} />
          </td>
          <td className="know-flags">
            {c.status !== "stable" && <span className={`chip ${c.status}`}>{c.status}</span>}
            {c.stale && <span className="chip stale">stale</span>}
            {c.error && (
              <span className="chip stale" title={c.error}>
                invalid
              </span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

/* ---------- concept ---------- */

function ConceptView({ bundle, conceptId }: { bundle: string; conceptId: string }) {
  const [concept, setConcept] = useState<ConceptDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const load = () => {
    fetch(`/api/knowledge/${encodeURIComponent(bundle)}/concept?id=${encodeURIComponent(conceptId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setConcept)
      .catch(() => setGone(true));
  };
  useEffect(load, [bundle, conceptId]);

  async function verify() {
    setVerifying(true);
    await fetch(`/api/knowledge/${encodeURIComponent(bundle)}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: conceptId }),
    }).catch(() => {});
    setVerifying(false);
    load();
  }

  if (gone) return <div className="empty">concept not found</div>;
  if (!concept) return <div className="empty">loading…</div>;

  return (
    <div>
      <div className="detail-head">
        <h1>{concept.title}</h1>
        {concept.type && <span className="chip agent">{concept.type}</span>}
        <TrustBadge tier={concept.trustTier} />
        {concept.status !== "stable" && (
          <span className={`chip ${concept.status}`}>{concept.status}</span>
        )}
        {concept.stale && <span className="chip stale">stale since {concept.staleAfter?.slice(0, 10)}</span>}
        <span className="spacer" />
        <button
          className="open-raw"
          onClick={() => void createChatAndOpen("claude", { kind: "knowledge", bundle })}
        >
          curate in chat
        </button>
        <button className="run-btn" disabled={verifying} onClick={verify}>
          {verifying ? "verifying…" : "✓ verify (human)"}
        </button>
      </div>
      <div className="know-sub">
        <span className="rid">
          {bundle}/{concept.id}.md
        </span>
        {concept.tags.map((t) => (
          <span key={t} className="chip">
            {t}
          </span>
        ))}
      </div>
      {concept.error && <div className="msg error">✕ {concept.error}</div>}

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">provenance &amp; trust</span>
        </div>
        <div className="know-meta">
          <div>
            <span className="microlabel">generated</span>
            <span>
              {concept.generated
                ? `${concept.generated.by ?? "?"} · ${concept.generated.at ?? "?"}`
                : "— (not stamped)"}
            </span>
          </div>
          <div>
            <span className="microlabel">verified</span>
            <span>
              {concept.verified.length === 0
                ? "never"
                : concept.verified.map((v, i) => (
                    <span key={i} className="know-verify-entry">
                      {v.by ?? "?"} · {v.at ?? "?"}
                    </span>
                  ))}
            </span>
          </div>
          {concept.staleAfter && (
            <div>
              <span className="microlabel">stale after</span>
              <span>{concept.staleAfter}</span>
            </div>
          )}
        </div>
        {concept.sources.length > 0 && (
          <>
            <div className="panel-head">
              <span className="microlabel">sources</span>
            </div>
            <table className="know-table">
              <tbody>
                {concept.sources.map((s, i) => (
                  <tr key={i}>
                    <td>
                      {s.resource?.startsWith("http") ? (
                        <a href={s.resource} target="_blank" rel="noreferrer">
                          {s.title ?? s.resource}
                        </a>
                      ) : (
                        <span>{s.title ?? s.resource ?? "?"}</span>
                      )}
                      {s.id && <span className="know-id">[^{s.id}]</span>}
                    </td>
                    <td className="know-type">{s.author ?? ""}</td>
                    <td className="know-type">
                      {s.usage_count != null ? `${s.usage_count} uses` : ""}
                    </td>
                    <td className="know-type">
                      {s.last_modified ? `mod ${s.last_modified.slice(0, 10)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">content</span>
        </div>
        <div className="viewer-body">
          <pre>{concept.body.trim() || "(empty body)"}</pre>
        </div>
      </section>
    </div>
  );
}
