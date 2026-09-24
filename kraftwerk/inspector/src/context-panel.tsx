import { useEffect, useState } from "react";
import { Icon, Lamp, Link, LocalNav, fmtAgo, useExpertMode, useFeatures, usePoll } from "./shared";
import { BundleView } from "./knowledge";
import { VibePane } from "./vibeables";
import { WorkflowView } from "./workflow-view";
import { BROWSE_EVENT, ContextBrowser } from "./context-browser";
import type { AgentDetail, ChannelView, KnowledgeIndex, ProjectDetail, RunListItem, VibeablesView, WorkflowSummary } from "./types";

/** What the middle column talks to, read off its route. */
type Context =
  | { kind: "general" }
  | { kind: "agent"; slug: string }
  | { kind: "project"; slug: string }
  | { kind: "channel"; slug: string };

export function contextOf(chatPath: string): Context {
  const seg = chatPath.split("/").filter(Boolean);
  const slug = seg[1] ? decodeURIComponent(seg[1]) : "";
  if (seg[0] === "projects" && slug && slug !== "new") return { kind: "project", slug };
  if (seg[0] === "channels" && slug && slug !== "new") return { kind: "channel", slug };
  if ((seg[0] === "agents" || seg[0] === "team") && slug && slug !== "new" && slug !== "chats") return { kind: "agent", slug };
  return { kind: "general" };
}

/** The names a conversation is linked to; null while they load. `found` marks a link whose target is gone. */
interface Links {
  title: string;
  workflows: { slug: string; found: boolean }[];
  knowledge: { slug: string; found: boolean }[];
  vibeables?: { slug: string; found: boolean }[];
  repos?: { slug: string; found: boolean }[];
  agents?: { slug: string; found: boolean; label?: string }[];
  records?: ProjectDetail["records"];
  /** Where the links are edited. */
  editHref?: string;
  /** Everything the workspace has, not a selection. */
  all?: boolean;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const present = (slugs: string[], have: Set<string>) => slugs.map((slug) => ({ slug, found: have.has(slug) }));

/**
 * The right column: what the current conversation works with. An agent's
 * linked workflows and knowledge, a project's links and systems of record,
 * a channel's members' links put together, and for the general chat the
 * whole workspace. Every row leads to the global page of the thing.
 */
export function ContextPanel({ chatPath, workspace }: {
  chatPath: string;
  /** The workspace's name and icon (kraftwerk.yml): the sign of the general chat and the dashboard. */
  workspace: { name: string; icon: string };
}) {
  const ctx = contextOf(chatPath);
  const key = `${ctx.kind}:${"slug" in ctx ? ctx.slug : ""}`;
  const features = useFeatures();
  const expert = useExpertMode();
  const wfs = usePoll<{ root: string; workflows: WorkflowSummary[] }>("/api/workflows", false, 15_000);
  const runs = usePoll<{ runs: RunListItem[] }>("/api/runs", false, 6000);
  const know = usePoll<KnowledgeIndex>("/api/knowledge", false, 15_000);
  const vibes = usePoll<VibeablesView>(features.vibeables ? "/api/vibeables" : "", false, 15_000);
  const [links, setLinks] = useState<Links | null>(null);
  const [version, setVersion] = useState(0);
  // One category at a time, as tabs; remembered per browser.
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem("kw-ctx-tab") || "workflows";
    } catch {
      return "workflows";
    }
  });
  const [browserTabs, setBrowserTabs] = useState(0);
  // A link opened from the chat brings the browser to the front.
  useEffect(() => {
    const onBrowse = () => pickTab("browser");
    window.addEventListener(BROWSE_EVENT, onBrowse);
    return () => window.removeEventListener(BROWSE_EVENT, onBrowse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pickTab = (id: string) => {
    setTab(id);
    try {
      localStorage.setItem("kw-ctx-tab", id);
    } catch {}
  };
  const showVibeables = features.vibeables && !!(links?.all || links?.vibeables);
  const showRepos = features.repos && !!links?.repos;
  const tabs: { id: string; label: string; count?: number; allHref?: string }[] = [
    { id: "workflows", label: "workflows", count: links?.workflows.length, allHref: "/workflows" },
    { id: "knowledge", label: "knowledge", count: links?.knowledge.length, allHref: "/knowledge" },
    ...(showVibeables ? [{ id: "vibeables", label: "vibeables", count: links?.all ? vibes?.vibeables.length : links?.vibeables?.length, allHref: "/vibeables" }] : []),
    ...(showRepos ? [{ id: "repos", label: "repositories", count: links?.repos?.length, allHref: "/repos" }] : []),
    ...(links?.agents ? [{ id: "agents", label: "agents", count: links.agents.length, allHref: "/agents" }] : []),
    ...(links?.records && links.records.length > 0 ? [{ id: "records", label: "records", count: links.records.length }] : []),
    { id: "browser", label: "browser", count: browserTabs },
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : "workflows";
  const active = tabs.find((t) => t.id === current);

  // What is open in a category: a route path the embedded screen renders
  // (/knowledge/<bundle>/<page>, /workflows/<slug>[/tab], /vibeables/<slug>);
  // null = the list. Its links stay inside the column (LocalNav).
  const [open, setOpen] = useState<Record<string, string | null>>({});
  useEffect(() => setOpen({}), [key]);
  const openPath = open[current] ?? null;
  const show = (path: string) => setOpen((o) => ({ ...o, [current]: path }));
  const back = () => setOpen((o) => ({ ...o, [current]: null }));
  const takeLink = (prefix: string) => (href: string) => {
    if (!href.startsWith(prefix)) return false;
    setOpen((o) => ({ ...o, [current]: href }));
    return true;
  };
  const openRow = (path: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    show(path);
  };

  // Links change when an agent or project is edited: reload with the route and every 15s.
  useEffect(() => {
    const t = setInterval(() => setVersion((v) => v + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    const wfSlugs = new Set((wfs?.workflows ?? []).map((w) => w.slug));
    const bundleNames = new Set((know?.bundles ?? []).map((b) => b.name));
    (async () => {
      let next: Links | null = null;
      if (ctx.kind === "agent") {
        const a = await getJson<AgentDetail>(`/api/agents/${encodeURIComponent(ctx.slug)}`);
        if (a) next = { title: `${a.emoji ? `${a.emoji} ` : ""}${a.name}`, workflows: present(a.workflows, wfSlugs), knowledge: present(a.knowledge, bundleNames), editHref: `/agents/${encodeURIComponent(ctx.slug)}/edit` };
      } else if (ctx.kind === "project") {
        const p = await getJson<ProjectDetail>(`/api/projects/${encodeURIComponent(ctx.slug)}`);
        if (p) next = { title: `📁 ${p.title}`, workflows: p.links.workflows, knowledge: p.links.knowledge, vibeables: p.links.vibeables, repos: p.links.repos, agents: p.links.agents, records: p.records, editHref: `/projects/${encodeURIComponent(ctx.slug)}/info` };
      } else if (ctx.kind === "channel") {
        const d = await getJson<{ channels: ChannelView[] }>("/api/channels");
        const c = d?.channels.find((x) => x.slug === ctx.slug);
        if (c) {
          const members = (await Promise.all(c.members.map((m) => getJson<AgentDetail>(`/api/agents/${encodeURIComponent(m)}`)))).filter((a): a is AgentDetail => !!a);
          const union = (pick: (a: AgentDetail) => string[]) => [...new Set(members.flatMap(pick))];
          next = {
            title: `#${c.slug}`,
            workflows: present(union((a) => a.workflows), wfSlugs),
            knowledge: present(union((a) => a.knowledge), bundleNames),
            agents: c.members.map((m) => ({ slug: m, found: members.some((a) => a.slug === m), label: members.find((a) => a.slug === m)?.name })),
            editHref: `/channels/${encodeURIComponent(ctx.slug)}/edit`,
          };
        }
      } else {
        next = {
          title: `${workspace.icon ? `${workspace.icon} ` : ""}${workspace.name || "workspace"}`,
          workflows: present([...wfSlugs], wfSlugs),
          knowledge: present([...bundleNames], bundleNames),
          all: true,
        };
      }
      if (alive) setLinks(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, wfs, know, workspace.name, workspace.icon]);

  const wfOf = (slug: string) => wfs?.workflows.find((w) => w.slug === slug);
  const lastRun = (w: WorkflowSummary | undefined) => (w ? runs?.runs.find((r) => r.workflow === (w.name ?? w.slug) || r.workflow === w.slug) : undefined);
  const bundleOf = (name: string) => know?.bundles.find((b) => b.name === name);
  const vibeOf = (slug: string) => vibes?.vibeables.find((v) => v.slug === slug);

  const empty = (what: string) => (
    <div className="ctx-empty">
      {links?.all ? `No ${what} in this workspace yet.` : `No ${what} linked.`}
      {links?.editHref && expert && !links.all && (
        <>
          {" "}
          <Link href={links.editHref}>Edit the links</Link>.
        </>
      )}
    </div>
  );


  return (
    <aside className="ctx" aria-label="Context">
      <div className="ctx-head">
        <span className="ctx-title" title={links?.title}>{links ? links.title : "…"}</span>
      </div>
      <div className="ctx-tabs" role="tablist" aria-label="Categories">
        {tabs.map((t) => (
          <button key={t.id} role="tab" className="ctx-tab" aria-selected={t.id === current} onClick={() => pickTab(t.id)}>
            {t.label}
            {t.count !== undefined && <span className="ctx-tab-n num">{t.count}</span>}
          </button>
        ))}
      </div>
      {openPath && (
        <div className="ctx-open-head">
          <button className="open-raw" onClick={back} aria-label="Back to the list">
            <Icon name="arrow_back" className="ms-sm" /> {active?.label}
          </button>
          <span className="spacer" />
          <Link href={openPath} className="ctx-all" title="Open as a page">
            page <Icon name="open_in_new" className="ms-sm" />
          </Link>
        </div>
      )}
      {openPath && current === "knowledge" && (
        <div className="ctx-body ctx-embed">
          <LocalNav.Provider value={takeLink("/knowledge/")}>
            {(() => {
              const seg = openPath.split("/").filter(Boolean);
              const bundle = decodeURIComponent(seg[1] ?? "");
              const conceptId = seg.length > 2 ? seg.slice(2).map(decodeURIComponent).join("/") : undefined;
              return <BundleView key={bundle} name={bundle} conceptId={conceptId} />;
            })()}
          </LocalNav.Provider>
        </div>
      )}
      {openPath && current === "workflows" && (
        <div className="ctx-body ctx-embed">
          <LocalNav.Provider value={takeLink("/workflows/")}>
            {(() => {
              const seg = openPath.split("/").filter(Boolean);
              const tab = seg[2] === "details" || seg[2] === "runs" ? seg[2] : "overview";
              return <WorkflowView key={seg[1]} slug={decodeURIComponent(seg[1] ?? "")} tab={tab} />;
            })()}
          </LocalNav.Provider>
        </div>
      )}
      {openPath && current === "vibeables" && (
        <div className="ctx-body ctx-embed ctx-embed-vibe">
          <VibePane key={openPath} slug={decodeURIComponent(openPath.split("/").filter(Boolean)[1] ?? "")} />
        </div>
      )}
      <div className="ctx-body ctx-embed ctx-browser" hidden={current !== "browser"}>
        <ContextBrowser key={key} storeKey={key} onTabs={setBrowserTabs} />
      </div>
      <div className="ctx-body" role="tabpanel" hidden={current === "browser" || (!!openPath && ["knowledge", "workflows", "vibeables"].includes(current))}>
        {active?.allHref && (
          <div className="ctx-section-head">
            <span className="spacer" />
            <Link href={active.allHref} className="ctx-all">
              all {active.label} <Icon name="arrow_forward" className="ms-sm" />
            </Link>
          </div>
        )}

        {current === "workflows" && (
          <>
            {links && links.workflows.length === 0 && empty("workflows")}
            {links?.workflows.map(({ slug, found }) => {
              const w = wfOf(slug);
              const last = lastRun(w);
              return (
                <Link key={slug} href={`/workflows/${encodeURIComponent(slug)}`} className={`ctx-row${found ? "" : " missing"}`} onClick={found ? openRow(`/workflows/${encodeURIComponent(slug)}`) : undefined}>
                  <Lamp status={!found || w?.error ? "failed" : (last?.status ?? "idle")} />
                  <span className="ctx-text">
                    <span className="ctx-name">{w?.name ?? slug}</span>
                    <span className="ctx-sub">
                      {!found ? "not in this workspace" : w?.error ? "broken" : last ? `${last.status} · ${fmtAgo(last.updatedAt)}` : (w?.description ?? "no runs yet")}
                    </span>
                  </span>
                  {found && !w?.error && <Icon name="chevron_right" className="ctx-go ms-sm" />}
                </Link>
              );
            })}
          </>
        )}

        {current === "knowledge" && (
          <>
            {links && links.knowledge.length === 0 && empty("knowledge")}
            {links?.knowledge.map(({ slug, found }) => {
              const b = bundleOf(slug);
              return (
                <Link key={slug} href={`/knowledge/${encodeURIComponent(slug)}`} className={`ctx-row${found ? "" : " missing"}`} onClick={found ? openRow(`/knowledge/${encodeURIComponent(slug)}`) : undefined}>
                  <Icon name="menu_book" className="ctx-icon ms-sm" />
                  <span className="ctx-text">
                    <span className="ctx-name">{slug}</span>
                    <span className="ctx-sub">{!found ? "not in this workspace" : b ? `${b.concepts} ${b.concepts === 1 ? "page" : "pages"}${b.updatedAt ? ` · ${fmtAgo(b.updatedAt)}` : ""}` : ""}</span>
                  </span>
                </Link>
              );
            })}
          </>
        )}

        {current === "vibeables" && links && (
          <>
            {(links.all ? (vibes?.vibeables ?? []).map((v) => ({ slug: v.slug, found: true })) : (links.vibeables ?? [])).map(({ slug, found }) => {
              const v = vibeOf(slug);
              return (
                <Link key={slug} href={`/vibeables/${encodeURIComponent(slug)}`} className={`ctx-row${found ? "" : " missing"}`} onClick={found ? openRow(`/vibeables/${encodeURIComponent(slug)}`) : undefined}>
                  <Icon name="web" className="ctx-icon ms-sm" />
                  <span className="ctx-text">
                    <span className="ctx-name">{slug}</span>
                    <span className="ctx-sub">{!found ? "not in this workspace" : v?.updatedAt ? `changed ${fmtAgo(v.updatedAt)}` : ""}</span>
                  </span>
                </Link>
              );
            })}
            {links.all && vibes && vibes.vibeables.length === 0 && empty("vibeables")}
            {!links.all && links.vibeables?.length === 0 && empty("vibeables")}
          </>
        )}

        {current === "repos" && links?.repos && (
          <>
            {links.repos.length === 0 && empty("repositories")}
            {links.repos.map(({ slug, found }) => (
              <Link key={slug} href={`/repos/${encodeURIComponent(slug)}`} className={`ctx-row${found ? "" : " missing"}`}>
                <Icon name="source" className="ctx-icon ms-sm" />
                <span className="ctx-text">
                  <span className="ctx-name">{slug}</span>
                  {!found && <span className="ctx-sub">not in this workspace</span>}
                </span>
              </Link>
            ))}
          </>
        )}

        {current === "agents" && links?.agents && (
          <>
            {links.agents.length === 0 && empty("agents")}
            {links.agents.map(({ slug, found, label }) => (
              <Link key={slug} href={`/agents/${encodeURIComponent(slug)}`} className={`ctx-row${found ? "" : " missing"}`}>
                <Icon name="person" className="ctx-icon ms-sm" />
                <span className="ctx-text">
                  <span className="ctx-name">{label ?? slug}</span>
                  {!found && <span className="ctx-sub">not in this workspace</span>}
                </span>
              </Link>
            ))}
          </>
        )}

        {current === "records" && links?.records && (
          <>
            {links.records.map((r, i) => (
              <a key={i} href={r.url || undefined} target="_blank" rel="noopener" className="ctx-row">
                <Icon name="open_in_new" className="ctx-icon ms-sm" />
                <span className="ctx-text">
                  <span className="ctx-name">{r.title || r.kind}</span>
                  {r.note && <span className="ctx-sub">{r.note}</span>}
                </span>
              </a>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
