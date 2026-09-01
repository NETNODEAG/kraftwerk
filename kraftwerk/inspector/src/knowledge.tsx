import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
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
    <div className="member-view">
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
        {data.concepts.length === 0 ? (
          <div className="viewer-note">
            No concepts yet — start a chat to author some, or write one with{" "}
            <code>kraftwerk knowledge put {name}/&lt;path&gt;</code>.
          </div>
        ) : (
          <div className="m3-list">
            {groupByFolder(data.concepts).map(({ folder, concepts }) => (
              <Fragment key={folder || "."}>
                {folder && <div className="m3-subhead">{folder}/</div>}
                {concepts.map((c) => (
                  <Link
                    key={c.id}
                    href={`/knowledge/${encodeURIComponent(name)}/${c.id}`}
                    className="m3-row m3-link"
                  >
                    <span className="m3-ico">{typeIcon(c.type)}</span>
                    <span className="m3-body">
                      <span className="m3-head">
                        {c.title}
                        {c.status !== "stable" && <span className={`chip ${c.status}`}>{c.status}</span>}
                        {c.stale && <span className="chip stale">stale</span>}
                        {c.error && (
                          <span className="chip stale" title={c.error}>
                            invalid
                          </span>
                        )}
                      </span>
                      <span className="m3-sub">
                        <code>{folder ? c.id.slice(folder.length + 1) : c.id}.md</code>
                        {" · "}
                        {c.type ?? "untyped"}
                      </span>
                    </span>
                    <TrustBadge tier={c.trustTier} />
                    <span className="m3-chev">›</span>
                  </Link>
                ))}
              </Fragment>
            ))}
          </div>
        )}
      </section>
      {data.log && <ActivityPanel name={name} log={data.log} />}
    </div>
  );
}

/** Leading icon per OKF concept type. */
function typeIcon(type?: string): string {
  switch ((type ?? "").toLowerCase()) {
    case "reference": return "▤";
    case "policy": return "§";
    case "guide": case "howto": return "➤";
    case "decision": return "⚖";
    default: return "◆";
  }
}

/* ---------- activity log ---------- */

interface LogEntry {
  kind: string;
  text: string;
}

/** Parse the OKF update log ("## YYYY-MM-DD" + "* **Kind**: ..." lines) into days. */
function parseLog(log: string): Array<{ date: string; entries: LogEntry[] }> {
  const days: Array<{ date: string; entries: LogEntry[] }> = [];
  for (const line of log.split("\n")) {
    const day = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (day) {
      days.push({ date: day[1], entries: [] });
      continue;
    }
    const entry = line.match(/^[*-]\s+\*\*([^*]+)\*\*:\s*(.*)$/);
    if (entry && days.length > 0) {
      days[days.length - 1].entries.push({ kind: entry[1].toLowerCase(), text: entry[2] });
    }
  }
  return days.filter((d) => d.entries.length > 0);
}

/** Render one log line, turning "[title](/path.md)" into concept links. */
function logText(name: string, text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(\/?([^)]+?)\.md\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <Link key={m.index} href={`/knowledge/${encodeURIComponent(name)}/${m[2].replace(/^\//, "")}`}>
        {m[1]}
      </Link>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function ActivityPanel({ name, log }: { name: string; log: string }) {
  const days = parseLog(log);
  const [raw, setRaw] = useState(false);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">activity</span>
        <span className="spacer" />
        <button className="open-raw" onClick={() => setRaw(!raw)}>
          {raw ? "timeline" : "raw log"}
        </button>
      </div>
      {raw || days.length === 0 ? (
        <div className="viewer-body">
          <pre>{log}</pre>
        </div>
      ) : (
        <div className="know-log">
          {days.map((d) => (
            <Fragment key={d.date}>
              <div className="m3-subhead num">{d.date}</div>
              {d.entries.map((e, i) => (
                <div key={i} className="know-log-row">
                  <span className={`chip log-kind log-${e.kind}`}>{e.kind}</span>
                  <span className="know-log-text">{logText(name, e.text)}</span>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </section>
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

/* ---------- concept ---------- */

function ConceptView({ bundle, conceptId }: { bundle: string; conceptId: string }) {
  const [concept, setConcept] = useState<ConceptDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [view, setView] = useState<"rendered" | "source">("rendered");
  // Concept bodies are (often agent-)generated markdown — sanitize before injecting.
  const html = useMemo(
    () => (concept ? DOMPurify.sanitize(marked.parse(concept.body, { async: false })) : ""),
    [concept?.body]
  );

  const load = () => {
    fetch(`/api/knowledge/${encodeURIComponent(bundle)}/concept?id=${encodeURIComponent(conceptId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setConcept)
      .catch(() => setGone(true));
  };

  // Poll so agent-written updates appear without a manual refresh; paused while
  // editing, and state identity is kept when nothing changed to avoid re-renders.
  useEffect(() => {
    if (editing) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(
          `/api/knowledge/${encodeURIComponent(bundle)}/concept?id=${encodeURIComponent(conceptId)}`,
          { cache: "no-store" }
        );
        if (r.ok) {
          const c = (await r.json()) as ConceptDetail;
          if (alive) {
            setGone(false);
            setConcept((prev) => (JSON.stringify(prev) === JSON.stringify(c) ? prev : c));
          }
        } else if (r.status === 404 && alive) {
          setGone(true);
        }
      } catch {}
      if (alive) timer = setTimeout(tick, 6000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [bundle, conceptId, editing]);

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

  async function save() {
    setSaving(true);
    setSaveError("");
    const body = await fetch(`/api/knowledge/${encodeURIComponent(bundle)}/concept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: conceptId, content: draft }),
    })
      .then((r) => r.json())
      .catch(() => ({ error: "save failed" }));
    setSaving(false);
    if (body.error) setSaveError(body.error);
    else {
      setConcept(body);
      setEditing(false);
    }
  }

  if (gone) return <div className="empty">concept not found</div>;
  if (!concept) return <div className="empty">loading…</div>;

  return (
    <div className="member-view">
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
      {concept.error && <div className="msg error">✕ {concept.error}</div>}

      <div className="detail-cols">
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">content</span>
            <span className="spacer" />
            <span className="side-meta">
              {bundle}/{concept.id}.md
            </span>
            {editing ? (
              <>
                <button
                  className="open-raw"
                  onClick={() => {
                    setEditing(false);
                    setSaveError("");
                  }}
                >
                  cancel
                </button>
                <button className="open-raw" disabled={saving} onClick={save}>
                  {saving ? "saving…" : "✓ save"}
                </button>
              </>
            ) : (
              <button
                className="open-raw"
                onClick={() => {
                  setDraft(concept.raw);
                  setEditing(true);
                  setSaveError("");
                }}
              >
                ✎ edit
              </button>
            )}
          </div>
          {editing ? (
            <>
              <textarea
                className="concept-edit"
                value={draft}
                rows={Math.min(40, Math.max(18, draft.split("\n").length + 2))}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
              <div className="viewer-note">
                full file (frontmatter + markdown body) — saving stamps provenance as{" "}
                <code>human:user</code> and logs an update.
              </div>
            </>
          ) : (
            <>
              <div className="viewer-note md-toolbar">
                <div className="tabs">
                  <button className={view === "rendered" ? "active" : ""} onClick={() => setView("rendered")}>
                    rendered
                  </button>
                  <button className={view === "source" ? "active" : ""} onClick={() => setView("source")}>
                    source
                  </button>
                </div>
              </div>
              <div className="viewer-body">
                {view === "rendered" ? (
                  <div className="md-body concept-md" dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <pre>{concept.body.trim() || "(empty body)"}</pre>
                )}
              </div>
            </>
          )}
          {saveError && <div className="msg error">✕ {saveError}</div>}
        </section>

        <aside className="detail-rail">
          <section className="panel">
            <div className="panel-head">
              <span className="microlabel">about</span>
            </div>
            <div className="rail-list">
              <div className="rail-kv">
                <span className="microlabel">trust</span>
                <span className="v">
                  <TrustBadge tier={concept.trustTier} />
                </span>
              </div>
              <div className="rail-kv">
                <span className="microlabel">generated</span>
                <span className={`v ${concept.generated ? "" : "dim"}`}>
                  {concept.generated
                    ? `${concept.generated.by ?? "?"} · ${(concept.generated.at ?? "?").slice(0, 10)}`
                    : "not stamped"}
                </span>
              </div>
              <div className="rail-kv">
                <span className="microlabel">verified</span>
                {concept.verified.length === 0 ? (
                  <span className="v dim">never</span>
                ) : (
                  concept.verified.map((v, i) => (
                    <span key={i} className="v">
                      {v.by ?? "?"} · {(v.at ?? "?").slice(0, 10)}
                    </span>
                  ))
                )}
              </div>
              {concept.staleAfter && (
                <div className="rail-kv">
                  <span className="microlabel">stale after</span>
                  <span className={`v ${concept.stale ? "" : "dim"}`}>
                    {concept.staleAfter.slice(0, 10)}
                    {concept.stale && <span className="chip stale">stale</span>}
                  </span>
                </div>
              )}
              {concept.tags.length > 0 && (
                <div className="rail-kv">
                  <span className="microlabel">tags</span>
                  <span className="m3-chips">
                    {concept.tags.map((t) => (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          </section>

          {concept.sources.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <span className="microlabel">sources</span>
              </div>
              <div className="rail-list">
                {concept.sources.map((s, i) => (
                  <div key={i} className="rail-kv">
                    <span className="v">
                      {s.resource?.startsWith("http") ? (
                        <a href={s.resource} target="_blank" rel="noreferrer">
                          {s.title ?? s.resource}
                        </a>
                      ) : (
                        (s.title ?? s.resource ?? "?")
                      )}
                      {s.id && <span className="know-id">[^{s.id}]</span>}
                    </span>
                    <span className="v dim">
                      {[
                        s.author,
                        s.usage_count != null ? `${s.usage_count} uses` : null,
                        s.last_modified ? `mod ${s.last_modified.slice(0, 10)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
