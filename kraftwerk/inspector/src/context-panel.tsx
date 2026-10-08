import { useEffect, useRef, useState } from "react";
import { api, useApi } from "./api";
import { Icon, Link, LocalNav, PROJECTS_CHANGED_EVENT, fmtAgo, isEditPath, useExpertMode, useFeatures, useHashPath } from "./shared";
import { BundleView } from "./knowledge";
import { FileBrowser } from "./files";
import { Overview } from "./overview";
import { Button, cn, Dot, IconButton, ListRow, Select, Tabs, type DotTone } from "./ui";
import { VIBE_ATTACH_EVENT, VIBE_SLOT_ID, VibePane, type VibeAttachment } from "./vibeables";
import { WorkflowView } from "./workflow-view";
import { RunForm } from "./run-launcher";
import { BROWSE_EVENT, ContextBrowser } from "./context-browser";
import type { AgentDetail, ChannelView, ProjectDetail, WorkflowSummary } from "./types";

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
  /** A project's state.md and log.md, shown as documents; absent for everything but a project. */
  state?: string;
  log?: string;
  /** An agent's journal.md, its memory between sessions; absent for everything but an agent. */
  journal?: string;
  /** The place itself, for the overview tab. */
  project?: ProjectDetail;
  agent?: AgentDetail;
  channel?: ChannelView;
  /** Where the links are edited. */
  editHref?: string;
  /** Everything the workspace has, not a selection. */
  all?: boolean;
}


/** "today 17:00", "tomorrow 09:00", "Fri 17:00", "12 Oct 09:00". */
function fmtNext(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86_400_000);
  if (diff === 0) return `today ${time}`;
  if (diff === 1) return `tomorrow ${time}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
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
  // The sign's pencil: you are working on this project, agent or channel — its page is where it is edited.
  const [editHref, editTitle] =
    ctx.kind === "project"
      ? [`/projects/${encodeURIComponent(ctx.slug)}/info`, "edit the project: brief, state, records, links"]
      : ctx.kind === "agent"
        ? [`/agents/${encodeURIComponent(ctx.slug)}/info`, "edit the agent: profile and settings"]
        : ctx.kind === "channel"
          ? [`/channels/${encodeURIComponent(ctx.slug)}/edit`, "edit the channel"]
          : expert
            ? ["/settings", "workspace settings"]
            : [undefined, ""];
  const wfs = useApi("workflows.list", {}, { interval: 15_000 });
  const runs = useApi("runs.list", {}, { interval: 6000 });
  // The routines that run a workflow (their prompt names it), shown under it in the workflows tab.
  const routines = useApi("routines.list", {}, { interval: 30_000 });
  // The workflow whose launcher is unfolded under its row.
  const [launching, setLaunching] = useState<string | null>(null);
  const know = useApi("knowledge.list", {}, { interval: 15_000 });
  const vibes = useApi("vibeables.list", features.vibeables ? {} : null, { interval: 15_000 });
  const [links, setLinks] = useState<Links | null>(null);
  const [version, setVersion] = useState(0);
  // One category at a time, as tabs; remembered per browser.
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem("kw-ctx-tab") || "overview";
    } catch {
      return "overview";
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
  // What is open in a category: a route path the embedded screen renders
  // (/knowledge/<bundle>/<page>, /workflows/<slug>[/tab], /vibeables/<slug>);
  // null = the list. Its links stay inside the column (LocalNav).
  const [open, setOpen] = useState<Record<string, string | null>>({});
  useEffect(() => setOpen(attachedRef.current ? { vibeables: `/vibeables/${encodeURIComponent(attachedRef.current.slug)}` } : {}), [key]);
  // An app at full size: it takes the chat's place too (shell.css, .ctx[data-full]). Another conversation ends it.
  const [full, setFull] = useState(false);
  useEffect(() => setFull(false), [key]);
  // A project's app opened from the rail (#/projects/<slug>?app=<vibeable>): shown in the vibeables tab, at full size.
  const hashPath = useHashPath();
  const appParam = ctx.kind === "project" ? new URLSearchParams(hashPath.split("?")[1] ?? "").get("app") : null;
  useEffect(() => {
    if (!appParam) return;
    pickTab("vibeables");
    setOpen((o) => ({ ...o, vibeables: `/vibeables/${encodeURIComponent(appParam)}` }));
    setFull(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appParam, key]);
  const show = (path: string) => setOpen((o) => ({ ...o, [current]: path }));
  // Where the files tab is, per conversation.
  const [filesAt, setFilesAt] = useState<{ dir: string; file?: string }>({ dir: "" });
  useEffect(() => setFilesAt({ dir: "" }), [key]);
  // Pin an app to the project (link the vibeable) or unpin it; the rail lists the pinned ones under the project.
  const pinApp = async (project: string, vibeable: string, remove: boolean) => {
    const r = await api.request("projects.link", { slug: project, body: { kind: "vibeables", target: vibeable, remove } }).catch(() => null);
    if (r?.ok) {
      setVersion((v) => v + 1);
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    }
  };
  const back = () => {
    setFull(false);
    setOpen((o) => ({ ...o, [current]: null }));
  };
  const takeLink = (prefix: string) => (href: string) => {
    if (!href.startsWith(prefix)) return false;
    setOpen((o) => ({ ...o, [current]: href }));
    return true;
  };
  // The app attached to the current chat (announced by the chat, rendered by it into the slot below).
  const [attached, setAttached] = useState<VibeAttachment | null>(null);
  const attachedRef = useRef<VibeAttachment | null>(null);
  useEffect(() => {
    const onAttach = (e: Event) => {
      const detail = (e as CustomEvent<VibeAttachment | null>).detail;
      attachedRef.current = detail;
      setAttached(detail);
      if (detail) {
        pickTab("vibeables");
        setOpen((o) => ({ ...o, vibeables: `/vibeables/${encodeURIComponent(detail.slug)}` }));
      } else setOpen((o) => (o.vibeables?.startsWith("/vibeables/") ? { ...o, vibeables: null } : o));
    };
    window.addEventListener(VIBE_ATTACH_EVENT, onAttach);
    return () => window.removeEventListener(VIBE_ATTACH_EVENT, onAttach);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const showRepos = features.repos && !!links?.repos;
  // Where this place's files are: a project's own, a channel's project's, else the workspace's.
  const filesScope =
    ctx.kind === "project" ? `project:${ctx.slug}` : links?.channel?.project ? `project:${links.channel.project}` : "workspace";
  // The same tabs in the same order everywhere: the place at a glance first, then what the work uses.
  const tabs: { id: string; label: string; count?: number; allHref?: string }[] = [
    { id: "overview", label: "overview" },
    { id: "files", label: "files", allHref: `/files/${encodeURIComponent(filesScope)}` },
    { id: "knowledge", label: "knowledge", count: links?.knowledge.length, allHref: "/knowledge" },
    ...(features.vibeables ? [{ id: "vibeables", label: "apps", count: links?.all ? vibes?.vibeables.length : (links?.vibeables?.length ?? 0), allHref: "/vibeables" }] : []),
    { id: "workflows", label: "workflows", count: links?.workflows.length, allHref: "/workflows" },
    // Expert detail: the clones a project or agent works on.
    ...(expert && showRepos ? [{ id: "repos", label: "repositories", count: links?.repos?.length, allHref: "/repos" }] : []),
    // The browser shows up once a link from the chat opened something in it.
    ...(browserTabs > 0 || tab === "browser" ? [{ id: "browser", label: "browser", count: browserTabs }] : []),
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : "overview";
  const active = tabs.find((t) => t.id === current);
  const openPath = open[current] ?? null;
  const attachedShown = !!attached && current === "vibeables" && openPath === `/vibeables/${encodeURIComponent(attached.slug)}`;
  const appOpen = current === "vibeables" && !!openPath;
  const fullShown = full && appOpen;

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
  // The editing happens in a modal over this very conversation, so the route
  // key does not change: reload the moment the modal closes instead of
  // waiting for the next tick.
  const editing = isEditPath(hashPath);
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing) setVersion((v) => v + 1);
    wasEditing.current = editing;
  }, [editing]);

  useEffect(() => {
    let alive = true;
    const wfSlugs = new Set((wfs?.workflows ?? []).map((w) => w.slug));
    const bundleNames = new Set((know?.bundles ?? []).map((b) => b.name));
    const vibeSlugs = new Set((vibes?.vibeables ?? []).map((v) => v.slug));
    (async () => {
      let next: Links | null = null;
      if (ctx.kind === "agent") {
        const a = await api.call("agents.get", { slug: ctx.slug }).catch(() => null);
        if (a) {
          next = { title: `${a.emoji ? `${a.emoji} ` : ""}${a.name}`, agent: a, workflows: present(a.workflows, wfSlugs), knowledge: present(a.knowledge, bundleNames), editHref: `/agents/${encodeURIComponent(ctx.slug)}/edit` };
          // Linked apps show like a project's; an agent without any keeps the column as it was.
          if ((a.vibeables ?? []).length > 0) next.vibeables = present(a.vibeables, vibeSlugs);
          next.journal = (await api.call("agents.journal", { slug: ctx.slug }).catch(() => null))?.journal ?? "";
        }
      } else if (ctx.kind === "project") {
        const p = await api.call("projects.get", { slug: ctx.slug }).catch(() => null);
        if (p) next = { title: `📁 ${p.title}`, project: p, workflows: p.links.workflows, knowledge: p.links.knowledge, vibeables: p.links.vibeables, repos: p.links.repos, agents: p.links.agents, records: p.records, state: p.state, log: p.log, editHref: `/projects/${encodeURIComponent(ctx.slug)}/info` };
      } else if (ctx.kind === "channel") {
        const d = await api.call("channels.list").catch(() => null);
        const c = d?.channels.find((x) => x.slug === ctx.slug);
        if (c) {
          const members = (await Promise.all(c.members.map((m) => api.call("agents.get", { slug: m }).catch(() => null)))).filter((a): a is AgentDetail => !!a);
          const union = (pick: (a: AgentDetail) => string[]) => [...new Set(members.flatMap(pick))];
          const memberVibes = union((a) => a.vibeables ?? []);
          next = {
            title: `#${c.slug}`,
            channel: c,
            workflows: present(union((a) => a.workflows), wfSlugs),
            knowledge: present(union((a) => a.knowledge), bundleNames),
            ...(memberVibes.length > 0 ? { vibeables: present(memberVibes, vibeSlugs) } : {}),
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
  }, [key, version, wfs, know, vibes, workspace.name, workspace.icon]);

  const wfOf = (slug: string) => wfs?.workflows.find((w) => w.slug === slug);
  const lastRun = (w: WorkflowSummary | undefined) => (w ? runs?.runs.find((r) => r.workflow === (w.name ?? w.slug) || r.workflow === w.slug) : undefined);
  const bundleOf = (name: string) => know?.bundles.find((b) => b.name === name);
  const vibeOf = (slug: string) => vibes?.vibeables.find((v) => v.slug === slug);

  const empty = (what: string) => (
    <p className="m-0 px-2.5 py-3 text-sm text-fg-2">
      {links?.all ? `No ${what} in this workspace yet.` : `No ${what} linked.`}
      {links?.editHref && expert && !links.all && (
        <>
          {" "}
          <Link href={links.editHref} className="text-accent">Edit the links</Link>.
        </>
      )}
    </p>
  );


  return (
    <>
      {/* The space's title, top left above the chat and this column (shell.css places it): only its pencil is a target. */}
      <div className="space-title flex min-w-0 items-center gap-2 px-1">
        {/* Keyed by the name: a new context fades its title in. */}
        <span key={links?.title ?? ""} className="min-w-0 truncate text-[22px] leading-[1.15] font-[750] tracking-[-0.015em] text-fg animate-fade max-[800px]:text-lg" title={links?.title}>
          {links ? links.title : "…"}
        </span>
        {editHref && (
          // ctx-edit: the tests open the editor by it.
          <Link
            href={editHref}
            className="ctx-edit inline-grid size-7 flex-none place-items-center rounded-full text-fg-2 no-underline transition-colors hover:bg-surface-2 hover:text-accent active:scale-96 [&_.ms]:text-[18px]"
            title={editTitle}
            aria-label={editTitle}
          >
            <Icon name="edit" className="ms-sm" />
          </Link>
        )}
      </div>
      <aside className="ctx" aria-label="Context" data-full={fullShown || undefined}>
        <Tabs className="flex-none gap-y-0.5 pt-2" label="Categories" items={tabs} value={current} onChange={pickTab} />
        {openPath && (
          <div className="flex items-center gap-2 px-3 pb-1 pt-2">
            <Button variant="quiet" size="sm" icon="arrow_back" onClick={back} aria-label="Back to the list">
              {active?.label}
            </Button>
            <span className="flex-1" />
            {appOpen && (
              <Button
                variant="quiet"
                size="sm"
                icon={fullShown ? "close_fullscreen" : "open_in_full"}
                onClick={() => setFull(!fullShown)}
                title={fullShown ? "back beside the chat" : "full size, in place of the chat"}
              >
                {fullShown ? "beside the chat" : "full size"}
              </Button>
            )}
            <Button variant="quiet" size="sm" icon="open_in_new" href={openPath} title="Open as a page">
              page
            </Button>
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
        {openPath && current === "vibeables" && !attachedShown && (
          <div className="ctx-body ctx-embed ctx-embed-vibe">
            <VibePane key={openPath} slug={decodeURIComponent(openPath.split("/").filter(Boolean)[1] ?? "")} />
          </div>
        )}
        {/* The chat renders its attached app in here (a portal); always in the DOM so the portal has a target. */}
        <div id={VIBE_SLOT_ID} className="ctx-body ctx-embed ctx-embed-vibe" hidden={!attachedShown} />
        <div className="ctx-body ctx-embed ctx-browser" hidden={current !== "browser"}>
          <ContextBrowser key={key} storeKey={key} onTabs={setBrowserTabs} />
        </div>
        <div key={current} className="ctx-body" role="tabpanel" hidden={current === "browser" || (!!openPath && ["knowledge", "workflows", "vibeables"].includes(current))}>
          {active?.allHref && (
            <div className="flex justify-end px-1 pb-1">
              <Button variant="quiet" size="sm" href={active.allHref}>
                all {active.label} <Icon name="arrow_forward" className="ms-sm" />
              </Button>
            </div>
          )}

          {current === "workflows" && (
            <>
              {links && links.workflows.length === 0 && empty("workflows")}
              {links?.workflows.map(({ slug, found }) => {
                const w = wfOf(slug);
                const last = lastRun(w);
                const runnable = found && !!w && !w.error;
                const scheduled = (routines?.routines ?? []).filter((r) => r.workflows.includes(slug));
                return (
                  <div key={slug} className="flex flex-col">
                    <ListRow
                      href={`/workflows/${encodeURIComponent(slug)}`}
                      onClick={found ? openRow(`/workflows/${encodeURIComponent(slug)}`) : undefined}
                      dim={!found}
                      leading={<Dot tone={!found || w?.error ? "bad" : runTone(last?.status)} />}
                      title={w?.name ?? slug}
                      sub={!found ? "not in this workspace" : w?.error ? "broken" : last ? `${last.status} · ${fmtAgo(last.updatedAt)}` : (w?.description ?? "no runs yet")}
                      actionsAlways
                      actions={
                        runnable ? (
                          <IconButton
                            size="sm"
                            icon={launching === slug ? "close" : "play_arrow"}
                            label={launching === slug ? `close the launcher of ${w.name ?? slug}` : `run ${w.name ?? slug}`}
                            aria-expanded={launching === slug}
                            onClick={() => setLaunching(launching === slug ? null : slug)}
                          />
                        ) : undefined
                      }
                    />
                    {/* A routine whose prompt names the workflow: who runs it, and when next. */}
                    {scheduled.map((r) => (
                      <Link
                        key={`${r.agent.slug}/${r.id}`}
                        href={`/agents/${encodeURIComponent(r.agent.slug)}/info`}
                        className="routine-line flex min-w-0 items-center gap-1.5 pt-0.5 pb-2 pl-[46px] pr-3 text-xs text-fg-2 no-underline hover:text-fg"
                        title={`${r.agent.name}'s routine "${r.name}" (${r.schedule}) runs this workflow: ${r.prompt}`}
                      >
                        <Icon name="schedule" className="ms-sm flex-none text-[14px]" />
                        <span className="min-w-0 truncate">
                          {r.agent.emoji} {r.agent.name} · {r.name} · {r.enabled ? (r.nextRunAt ? `next ${fmtNext(r.nextRunAt)}` : r.schedule) : "paused"}
                        </span>
                      </Link>
                    ))}
                    {launching === slug && w && (
                      <div className="mx-1 mb-2 rounded-card border border-line bg-surface [&>div]:px-3 [&>div]:pt-3">
                        <RunForm
                          slug={slug}
                          usesRequest={w.usesRequest}
                          onLaunched={() => {
                            setLaunching(null);
                            show(`/workflows/${encodeURIComponent(slug)}`);
                          }}
                        />
                      </div>
                    )}
                  </div>
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
                  <ListRow
                    key={slug}
                    href={`/knowledge/${encodeURIComponent(slug)}`}
                    onClick={found ? openRow(`/knowledge/${encodeURIComponent(slug)}`) : undefined}
                    dim={!found}
                    leading={<Icon name="menu_book" className="ms-sm" />}
                    title={slug}
                    sub={!found ? "not in this workspace" : b ? `${b.concepts} ${b.concepts === 1 ? "page" : "pages"}${b.updatedAt ? ` · ${fmtAgo(b.updatedAt)}` : ""}` : undefined}
                  />
                );
              })}
            </>
          )}

          {current === "vibeables" && links && (
            <>
              {(links.all ? (vibes?.vibeables ?? []).map((v) => ({ slug: v.slug, found: true })) : (links.vibeables ?? [])).map(({ slug, found }) => {
                const v = vibeOf(slug);
                return (
                  <ListRow
                    key={slug}
                    href={`/vibeables/${encodeURIComponent(slug)}`}
                    onClick={found ? openRow(`/vibeables/${encodeURIComponent(slug)}`) : undefined}
                    dim={!found}
                    leading={<Icon name="web" className="ms-sm" />}
                    title={slug}
                    sub={!found ? "not in this workspace" : v?.updatedAt ? `changed ${fmtAgo(v.updatedAt)}` : undefined}
                    actions={
                      ctx.kind === "project" ? (
                        <IconButton icon="keep_off" size="sm" label={`unpin ${slug}`} onClick={() => void pinApp(ctx.slug, slug, true)} />
                      ) : undefined
                    }
                  />
                );
              })}
              {ctx.kind === "project" && vibes && (
                <PinApp options={vibes.vibeables.map((v) => v.slug).filter((s) => !links.vibeables?.some((l) => l.slug === s))} onPin={(s) => void pinApp(ctx.slug, s, false)} />
              )}
              {links.all && vibes && vibes.vibeables.length === 0 && empty("vibeables")}
              {!links.all && links.vibeables?.length === 0 && empty("vibeables")}
            </>
          )}

          {current === "repos" && links?.repos && (
            <>
              {links.repos.length === 0 && empty("repositories")}
              {links.repos.map(({ slug, found }) => (
                <ListRow
                  key={slug}
                  href={`/repos/${encodeURIComponent(slug)}`}
                  dim={!found}
                  leading={<Icon name="source" className="ms-sm" />}
                  title={slug}
                  sub={!found ? "not in this workspace" : undefined}
                />
              ))}
            </>
          )}

          {current === "overview" && links && (
            <Overview
              key={key}
              of={
                links.project
                  ? { kind: "project", project: links.project }
                  : links.agent
                    ? { kind: "agent", agent: links.agent, journal: links.journal ?? "" }
                    : links.channel
                      ? { kind: "channel", channel: links.channel }
                      : { kind: "workspace" }
              }
            />
          )}

          {current === "files" && (
            <FileBrowser
              key={filesScope}
              compact
              scope={filesScope}
              dir={filesAt.dir}
              file={filesAt.file}
              onOpen={(dir, file) => setFilesAt({ dir, file })}
            />
          )}
        </div>
      </aside>
    </>
  );
}

/** "pin an app": the workspace's vibeables not yet pinned to the project. */
function PinApp({ options, onPin }: { options: string[]; onPin: (slug: string) => void }) {
  if (options.length === 0) return null;
  return (
    <div className="flex items-center gap-2 px-2.5 py-2 text-fg-2">
      <Icon name="keep" className="ms-sm" />
      <Select className="h-8 text-sm" value="" onChange={(e) => e.target.value && onPin(e.target.value)} aria-label="pin an app to this project">
        <option value="">pin an app to this project…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    </div>
  );
}

/** A run's status as a dot. */
function runTone(status?: string): DotTone {
  return status === "ok" ? "ok" : status === "failed" ? "bad" : status === "running" ? "working" : "idle";
}
