import { useState } from "react";
import { useApi } from "./api";
import { Icon, Link, LocalNav, fmtAgo, navigate, useFeatures, useHashPath, type Features } from "./shared";
import { PlacesMap, type MapPlace } from "./places-map";
import { EventsCalendar, type CalEvent } from "./events-calendar";
import { BoardGlance } from "./boards";
import { DeckGlance } from "./presentations";
import { EntityPage } from "./entities";
import { VibePane } from "./vibeables";
import { WorkflowView, type WorkflowTab } from "./workflow-view";
import { BundleView } from "./knowledge";
import { Button, cn, EmptyState } from "./ui";
import type { EntitiesView, EntityBase } from "./types";

/**
 * #/artifacts: everything the workspace has made, in one list — apps
 * (vibeables), presentations, boards, contacts, places and events, the
 * workspace's and every project's — newest first, like a desktop app's
 * artifacts page. The tiles on top are the filter (one kind each, pressed
 * again for everything) and each has a + to make a new one; the search goes
 * by title. A row selects the thing: it shows in the right column (`ArtifactPreview`, #/artifacts?open=<key>), whose "open"
 * leads to where it lives. Only the kinds whose feature is on show.
 */
type Kind = "workflows" | "knowledge" | "vibeables" | "presentations" | "boards" | "contacts" | "places" | "events";

const KINDS: { id: Kind; label: string; one: string; icon: string; hue: string; newHref: string; newTitle?: string }[] = [
  // Workflows have no form of their own: Ralv (or the CLI) writes them.
  { id: "workflows", label: "Workflows", one: "Workflow", icon: "account_tree", hue: "#0e7490", newHref: "/agents/chats", newTitle: "ask Ralv to make a workflow" },
  { id: "knowledge", label: "Knowledge", one: "Knowledge bundle", icon: "menu_book", hue: "#4d7c0f", newHref: "/knowledge/new" },
  { id: "presentations", label: "Presentations", one: "Slides", icon: "slideshow", hue: "#c2410c", newHref: "/presentations/new" },
  { id: "vibeables", label: "Apps", one: "App", icon: "web", hue: "#2563eb", newHref: "/vibeables" },
  { id: "boards", label: "Boards", one: "Board", icon: "view_kanban", hue: "#15803d", newHref: "/boards/new" },
  { id: "contacts", label: "Contacts", one: "Contact", icon: "person", hue: "#7c3aed", newHref: "/contacts/new" },
  { id: "places", label: "Places", one: "Place", icon: "location_on", hue: "#be123c", newHref: "/places/new" },
  { id: "events", label: "Events", one: "Event", icon: "event", hue: "#a16207", newHref: "/events/new" },
];

interface Item {
  key: string;
  kind: Kind;
  title: string;
  href: string;
  project?: string;
  updatedAt?: string;
  broken?: boolean;
  /** More about it on the row's second line ("12 concepts"). */
  sub?: string;
  /** A place's coordinates, for the map. */
  lat?: number;
  lng?: number;
  /** An event's dates, for the calendar. */
  start?: string;
  end?: string;
}

const enc = encodeURIComponent;
// Workflows and knowledge are always there; every other kind is a feature that can be off.
const on = (f: Features, k: Kind) => k === "workflows" || k === "knowledge" || !!f[k];
const specOf = (k: Kind) => KINDS.find((x) => x.id === k)!;

/** The page's state in its hash: the kind filtered to (#/artifacts?kind=places) and the selected artifact (&open=<key>). */
function useArtifactsQuery(): { kind: Kind | "all"; open?: string } {
  const hash = useHashPath();
  const q = new URLSearchParams(hash.split("?")[1] ?? "");
  const kind = q.get("kind");
  return { kind: KINDS.some((k) => k.id === kind) ? (kind as Kind) : "all", open: q.get("open") ?? undefined };
}
const artifactsHref = ({ kind, open }: { kind?: Kind | "all"; open?: string }): string => {
  const q = new URLSearchParams();
  if (kind && kind !== "all") q.set("kind", kind);
  if (open) q.set("open", open);
  const s = q.toString();
  return s ? `/artifacts?${s}` : "/artifacts";
};

/** Everything made in the workspace, newest first, with the projects' titles. */
function useArtifacts() {
  const features = useFeatures();
  const wfs = useApi("workflows.list", {}, { interval: 30_000 });
  const know = useApi("knowledge.list", {}, { interval: 30_000 });
  const vibes = useApi("vibeables.list", features.vibeables ? {} : null, { interval: 30_000 });
  const decks = useApi("presentations.list", features.presentations ? { query: { all: "1" } } : null, { interval: 30_000 });
  const boards = useApi("boards.list", features.boards ? { query: { all: "1" } } : null, { interval: 30_000 });
  const contacts = useApi("contacts.list", features.contacts ? {} : null, { interval: 30_000 }) as EntitiesView<EntityBase> | null;
  const places = useApi("places.list", features.places ? {} : null, { interval: 30_000 }) as EntitiesView<EntityBase> | null;
  const events = useApi("events.list", features.events ? {} : null, { interval: 30_000 }) as EntitiesView<EntityBase> | null;
  const projects = useApi("projects.list", features.projects ? {} : null, { interval: 60_000 });
  const projectTitle = (slug?: string) => (slug ? (projects?.projects.find((p) => p.slug === slug)?.title ?? slug) : undefined);

  const items: Item[] = ([
    ...(wfs?.workflows ?? []).map((w) => ({ key: `workflows:${w.slug}`, kind: "workflows" as const, title: w.name || w.slug, href: `/workflows/${enc(w.slug)}`, updatedAt: w.updatedAt, broken: !!w.error })),
    ...(know?.bundles ?? []).map((b) => ({ key: `knowledge:${b.name}`, kind: "knowledge" as const, title: b.name, href: `/knowledge/${enc(b.name)}`, updatedAt: b.updatedAt, sub: `${b.concepts} concept${b.concepts === 1 ? "" : "s"}` })),
    ...(vibes?.vibeables ?? []).map((v) => ({ key: `vibeables:${v.slug}`, kind: "vibeables" as const, title: v.slug, href: `/vibeables/${enc(v.slug)}`, updatedAt: v.updatedAt, broken: !!v.configError })),
    ...(decks?.presentations ?? []).map((d) => ({
      key: `presentations:${d.project ?? ""}:${d.name}`,
      kind: "presentations" as const,
      title: d.title,
      href: d.project ? `/projects/${enc(d.project)}/presentations/${enc(d.name)}` : `/presentations/${enc(d.name)}`,
      project: d.project,
      updatedAt: d.updatedAt,
      broken: !!d.error,
    })),
    ...(boards?.boards ?? []).map((b) => ({
      key: `boards:${b.project ?? ""}:${b.board}`,
      kind: "boards" as const,
      title: b.title,
      href: b.project ? `/projects/${enc(b.project)}/boards/${enc(b.board)}` : `/boards/${enc(b.board)}`,
      project: b.project,
      updatedAt: b.updatedAt,
      broken: !!b.configError,
    })),
    ...(
      [
        ["contacts", contacts],
        ["places", places],
        ["events", events],
      ] as const
    ).flatMap(([kind, view]) =>
      (view?.items ?? []).map((e) => {
        const at = e as EntityBase & { lat?: number; lng?: number; start?: string; end?: string };
        return { key: `${kind}:${e.slug}`, kind, title: e.title || e.slug, href: `/${kind}/${enc(e.slug)}`, updatedAt: e.updatedAt, broken: !!e.configError, lat: at.lat, lng: at.lng, start: at.start, end: at.end };
      }),
    ),
  ] as Item[]).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const loading = !wfs && !know && !vibes && !decks && !boards && !contacts && !places && !events;
  return { items, loading, projectTitle };
}

export function ArtifactsScreen() {
  const features = useFeatures();
  const kinds = KINDS.filter((k) => on(features, k.id));
  const { kind: filter, open } = useArtifactsQuery();
  // Filtering keeps the selection only when it is of the kind filtered to.
  const setFilter = (kind: Kind | "all") => navigate(artifactsHref({ kind, open: kind === "all" || open?.startsWith(`${kind}:`) ? open : undefined }), { replace: true });
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const { items, loading: none, projectTitle } = useArtifacts();

  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => (filter === "all" || i.kind === filter) && (!needle || `${i.title} ${projectTitle(i.project) ?? ""}`.toLowerCase().includes(needle)));
  const loading = kinds.length > 0 && none;

  return (
    <div className="artifacts-screen mx-auto flex w-full max-w-[920px] flex-col gap-6 px-6 pt-8 pb-12 max-[800px]:px-4">
      <h1 className="m-0 text-3xl font-semibold tracking-[-0.02em] text-fg">Artifacts</h1>

      {kinds.length > 0 && (
        // The tiles are the filter: one per kind, pressed again to show everything; the + beside the name makes a new one.
        <section className="grid grid-cols-4 gap-3 max-[600px]:grid-cols-3" aria-label="kinds">
          {kinds.map((k) => {
            const pressed = filter === k.id;
            return (
              <div key={k.id} className="flex flex-col gap-1.5 text-sm text-fg">
                <button
                  type="button"
                  aria-pressed={pressed}
                  aria-label={`show only ${k.label.toLowerCase()}`}
                  title={pressed ? "show everything" : `show only ${k.label.toLowerCase()}`}
                  className={cn(
                    "grid h-[72px] cursor-pointer place-items-center rounded-2xl outline-offset-2 transition-[filter,box-shadow] hover:brightness-95",
                    pressed && "shadow-[0_0_0_2px_currentColor]",
                    filter !== "all" && !pressed && "opacity-55",
                  )}
                  style={{ background: `color-mix(in srgb, ${k.hue} 20%, var(--color-surface))`, color: k.hue }}
                  onClick={() => setFilter(pressed ? "all" : k.id)}
                >
                  <Icon name={k.icon} className="text-[34px]" />
                </button>
                <span className="flex items-center gap-1 px-0.5">
                  <span className={cn("min-w-0 flex-1 truncate", pressed && "font-medium")}>{k.label}</span>
                  <Link
                    href={k.newHref}
                    aria-label={`new ${k.one.toLowerCase()}`}
                    title={k.newTitle ?? `new ${k.one.toLowerCase()}`}
                    className="grid size-6 flex-none place-items-center rounded-full text-fg-2 no-underline hover:bg-surface-2 hover:text-fg"
                  >
                    <Icon name="add" className="ms-sm" />
                  </Link>
                </span>
              </div>
            );
          })}
        </section>
      )}

      <div className="-mb-3 flex items-center gap-2">
        <h2 className="m-0 flex-1 text-sm font-normal text-fg-2">{filter === "all" ? "Everything" : specOf(filter).label}</h2>
        {searching ? (
          <input
            autoFocus
            type="search"
            aria-label="search artifacts"
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => !q && setSearching(false)}
            className="w-56 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
        ) : (
          <button type="button" aria-label="search artifacts" className="grid size-8 cursor-pointer place-items-center rounded-full text-fg-2 hover:bg-surface-2 hover:text-fg" onClick={() => setSearching(true)}>
            <Icon name="search" />
          </button>
        )}
      </div>

      <section className="flex flex-col" aria-label="artifacts">
        {kinds.length === 0 && (
          <p className="m-0 py-3 text-sm text-fg-2">
            Nothing to list yet: turn on apps, presentations, boards, contacts, places or events in <Link href="/settings" className="text-accent">settings</Link>.
          </p>
        )}
        {!loading && kinds.length > 0 && shown.length === 0 && <p className="m-0 py-3 text-sm text-fg-2">{needle ? `Nothing matches “${q.trim()}”.` : "Nothing here yet — make something above."}</p>}
        {shown.map((i) => {
          const k = specOf(i.kind);
          const project = projectTitle(i.project);
          return (
            // A row selects; the preview on the right opens it where it lives.
            <Link
              key={i.key}
              href={artifactsHref({ kind: filter, open: i.key })}
              data-artifact={i.kind}
              aria-current={open === i.key ? "true" : undefined}
              className="artifact-row flex items-center gap-3 rounded-xl px-2 py-2.5 text-fg no-underline hover:bg-surface-2 aria-[current=true]:bg-surface-2"
            >
              <span className="grid size-9 flex-none place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${k.hue} 16%, var(--color-surface))`, color: k.hue }} title={k.one}>
                <Icon name={k.icon} className="ms-sm" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("truncate text-[15px]", i.broken && "text-on-bad-soft")}>{i.title}</span>
                <span className="truncate text-xs text-fg-2">
                  {k.one}
                  {i.sub ? ` · ${i.sub}` : ""}
                  {project ? ` · 📁 ${project}` : ""}
                  {i.broken ? " · unreadable" : ""}
                </span>
              </span>
              {i.updatedAt && (
                <span className="flex-none text-sm text-fg-2 tabular-nums" title={i.updatedAt}>
                  Edited {fmtAgo(i.updatedAt)}
                </span>
              )}
            </Link>
          );
        })}
      </section>
    </div>
  );
}

/**
 * The right column of #/artifacts: the selected artifact itself — a deck's
 * slides, an app running, a board's columns, a contact, place or event to
 * edit — under its name, with "open" to where it lives and a close back to
 * the list. Places (filtered to, or one selected) are on an OpenStreetMap
 * map, all of them; a selected one is zoomed to with its details under the
 * map, and a dot on the map selects its place. Events the same way on a
 * dense month calendar: the overview while filtered to them, the selected
 * one's month and details under it. Nothing selected: a hint.
 */
export function ArtifactPreview() {
  const { kind, open } = useArtifactsQuery();
  const { items, loading } = useArtifacts();
  const item = open ? items.find((i) => i.key === open) : undefined;
  const k = item ? specOf(item.kind) : undefined;
  const [, a = "", b = ""] = (open ?? "").split(":");
  const mapped = kind === "places" || item?.kind === "places";
  const places = items.filter((i) => i.kind === "places");
  const pins: MapPlace[] = places.flatMap((p) => (p.lat !== undefined && p.lng !== undefined ? [{ slug: p.key.slice("places:".length), title: p.title, lat: p.lat, lng: p.lng }] : []));
  const unmapped = places.length - pins.length;
  const close = artifactsHref({ kind });
  const dated = kind === "events" || item?.kind === "events";
  const cal: CalEvent[] = items.flatMap((i) => (i.kind === "events" && i.start ? [{ slug: i.key.slice("events:".length), title: i.title, start: String(i.start), end: i.end ? String(i.end) : undefined }] : []));
  const head = item && k && (
    <div className="flex flex-none items-center gap-2.5 border-b border-line px-3 py-2.5">
      <span className="grid size-8 flex-none place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${k.hue} 16%, var(--color-surface))`, color: k.hue }} title={k.one}>
        <Icon name={k.icon} className="ms-sm" />
      </span>
      <h2 className="m-0 min-w-0 flex-1 truncate text-base font-semibold text-fg" title={item.title}>
        {item.title}
      </h2>
      <Button variant="quiet" size="sm" icon="open_in_new" href={item.href} title={`open the ${k.one.toLowerCase()} where it lives`}>
        open
      </Button>
      <Button variant="quiet" size="sm" icon="close" href={close} aria-label="close the preview" />
    </div>
  );
  return (
    <>
      <div className="space-title flex min-w-0 items-center gap-2 px-1" />
      <aside className="ctx artifact-preview" aria-label="Preview" data-open={item?.key}>
        {dated ? (
          <>
            {head}
            <div className={cn("flex min-h-0 flex-col p-3", item ? "h-[52%] flex-none" : "flex-1")}>
              <EventsCalendar events={cal} selected={item ? a : undefined} onPick={(slug) => navigate(artifactsHref({ kind, open: `events:${slug}` }))} />
            </div>
            {item ? (
              <div key={item.key} className="ctx-body ctx-embed border-t border-line">
                <EntityPage kind="events" slug={a} />
              </div>
            ) : (
              <p className="m-0 flex-none px-3 pb-3 text-sm text-fg-2">Pick an event on the left or in the calendar to see its details.</p>
            )}
          </>
        ) : mapped ? (
          <>
            {head}
            <div className={cn("flex min-h-0 flex-col gap-1.5 p-3", item ? "h-[48%] flex-none" : "flex-1")}>
              <PlacesMap places={pins} selected={item ? a : undefined} onPick={(slug) => navigate(artifactsHref({ kind, open: `places:${slug}` }))} />
              {(unmapped > 0 || (item && item.lat === undefined)) && (
                <p className="m-0 text-xs text-fg-2">
                  {item && item.lat === undefined ? "This place has no coordinates yet: add latitude and longitude below to put it on the map." : `${unmapped} of ${places.length} places have no coordinates and are not on the map.`}
                </p>
              )}
            </div>
            {item ? (
              <div key={item.key} className="ctx-body ctx-embed border-t border-line">
                <EntityPage kind="places" slug={a} />
              </div>
            ) : (
              <p className="m-0 flex-none px-3 pb-3 text-sm text-fg-2">Pick a place on the left or a dot on the map to zoom in and see its details.</p>
            )}
          </>
        ) : !item || !k ? (
          <EmptyState icon="preview" className="my-auto">
            {open && !loading ? "That one is gone." : "Pick an artifact on the left to see it here."}
          </EmptyState>
        ) : (
          <>
            {head}
            {item.kind === "vibeables" ? (
              <div className="ctx-body ctx-embed ctx-embed-vibe">
                <VibePane key={item.key} slug={a} />
              </div>
            ) : (
              <div key={item.key} className="ctx-body ctx-embed">
                {item.kind === "workflows" && <WorkflowPreview slug={a} />}
                {item.kind === "knowledge" && <BundlePreview name={a} />}
                {item.kind === "presentations" && <DeckGlance project={a || undefined} name={b} />}
                {item.kind === "boards" && <BoardGlance project={a || undefined} board={b} />}
                {item.kind === "contacts" && <EntityPage kind={item.kind} slug={a} />}
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

/** A workflow in the preview: its own view (request box, board, details, runs), its tab links kept in the column. */
function WorkflowPreview({ slug }: { slug: string }) {
  const [tab, setTab] = useState<WorkflowTab>("overview");
  const base = `/workflows/${enc(slug)}`;
  const take = (href: string) => {
    if (href !== base && !href.startsWith(`${base}/`)) return false;
    const t = href.slice(base.length + 1);
    setTab(t === "details" || t === "runs" ? t : "overview");
    return true;
  };
  return (
    <LocalNav.Provider value={take}>
      <WorkflowView key={slug} slug={slug} tab={tab} />
    </LocalNav.Provider>
  );
}

/** A knowledge bundle in the preview: its own view, a concept link opening the concept in the column. */
function BundlePreview({ name }: { name: string }) {
  const [concept, setConcept] = useState<string | undefined>(undefined);
  const base = `/knowledge/${enc(name)}`;
  const take = (href: string) => {
    if (href !== base && !href.startsWith(`${base}/`)) return false;
    const rest = href.slice(base.length + 1);
    setConcept(rest ? rest.split("/").map(decodeURIComponent).join("/") : undefined);
    return true;
  };
  return (
    <LocalNav.Provider value={take}>
      <BundleView key={name} name={name} conceptId={concept} />
    </LocalNav.Provider>
  );
}
