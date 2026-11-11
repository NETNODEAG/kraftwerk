import { useState } from "react";
import { useApi } from "./api";
import { Icon, Link, fmtAgo, useFeatures, type Features } from "./shared";
import { cn } from "./ui";
import type { EntitiesView, EntityBase } from "./types";

/**
 * #/artifacts: everything the workspace has made, in one list — apps
 * (vibeables), presentations, boards, contacts, places and events, the
 * workspace's and every project's — newest first, like a desktop app's
 * artifacts page. Tiles on top start a new one of each kind; the chips filter
 * by kind and the search by title. Each row opens the thing where it lives.
 * Only the kinds whose feature is on show.
 */
type Kind = "vibeables" | "presentations" | "boards" | "contacts" | "places" | "events";

const KINDS: { id: Kind; label: string; one: string; icon: string; hue: string; newHref: string }[] = [
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
}

const enc = encodeURIComponent;
const on = (f: Features, k: Kind) => !!f[k];

export function ArtifactsScreen() {
  const features = useFeatures();
  const kinds = KINDS.filter((k) => on(features, k.id));
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);

  const vibes = useApi("vibeables.list", features.vibeables ? {} : null, { interval: 30_000 });
  const decks = useApi("presentations.list", features.presentations ? { query: { all: "1" } } : null, { interval: 30_000 });
  const boards = useApi("boards.list", features.boards ? { query: { all: "1" } } : null, { interval: 30_000 });
  const contacts = useApi("contacts.list", features.contacts ? {} : null, { interval: 30_000 }) as EntitiesView<EntityBase> | null;
  const places = useApi("places.list", features.places ? {} : null, { interval: 30_000 }) as EntitiesView<EntityBase> | null;
  const events = useApi("events.list", features.events ? {} : null, { interval: 30_000 }) as EntitiesView<EntityBase> | null;
  const projects = useApi("projects.list", features.projects ? {} : null, { interval: 60_000 });
  const projectTitle = (slug?: string) => (slug ? (projects?.projects.find((p) => p.slug === slug)?.title ?? slug) : undefined);

  const items: Item[] = [
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
      (view?.items ?? []).map((e) => ({ key: `${kind}:${e.slug}`, kind, title: e.title || e.slug, href: `/${kind}/${enc(e.slug)}`, updatedAt: e.updatedAt, broken: !!e.configError })),
    ),
  ].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => (filter === "all" || i.kind === filter) && (!needle || `${i.title} ${projectTitle(i.project) ?? ""}`.toLowerCase().includes(needle)));
  const loading = kinds.length > 0 && !vibes && !decks && !boards && !contacts && !places && !events;
  const spec = (k: Kind) => KINDS.find((x) => x.id === k)!;

  return (
    <div className="artifacts-screen mx-auto flex w-full max-w-[920px] flex-col gap-6 px-6 pt-8 pb-12 max-[800px]:px-4">
      <h1 className="m-0 text-3xl font-semibold tracking-[-0.02em] text-fg">Artifacts</h1>

      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="kind">
        {[{ id: "all" as const, label: "All" }, ...kinds].map((k) => (
          <button
            key={k.id}
            type="button"
            role="tab"
            aria-selected={filter === k.id}
            className={cn("cursor-pointer rounded-full px-3 py-1.5 text-sm text-fg-2 hover:text-fg", filter === k.id && "bg-surface-2 font-medium text-fg")}
            onClick={() => setFilter(k.id)}
          >
            {k.label}
          </button>
        ))}
        <span className="flex-1" />
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

      {kinds.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="make something new">
          <h2 className="m-0 text-sm font-normal text-fg-2">Make something new</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3">
            {kinds.map((k) => (
              <Link key={k.id} href={k.newHref} className="group/tile flex flex-col gap-1.5 text-sm text-fg no-underline" title={`new ${k.one.toLowerCase()}`}>
                <span
                  className="grid h-[84px] place-items-center rounded-2xl transition-[filter] group-hover/tile:brightness-95"
                  style={{ background: `color-mix(in srgb, ${k.hue} 20%, var(--color-surface))`, color: k.hue }}
                >
                  <Icon name={k.icon} className="text-[34px]" />
                </span>
                <span className="px-0.5">{k.one}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col" aria-label="artifacts">
        {kinds.length === 0 && (
          <p className="m-0 py-3 text-sm text-fg-2">
            Nothing to list yet: turn on apps, presentations, boards, contacts, places or events in <Link href="/settings" className="text-accent">settings</Link>.
          </p>
        )}
        {!loading && kinds.length > 0 && shown.length === 0 && <p className="m-0 py-3 text-sm text-fg-2">{needle ? `Nothing matches “${q.trim()}”.` : "Nothing here yet — make something above."}</p>}
        {shown.map((i) => {
          const k = spec(i.kind);
          const project = projectTitle(i.project);
          return (
            <Link
              key={i.key}
              href={i.href}
              data-artifact={i.kind}
              className="artifact-row flex items-center gap-3 rounded-xl px-2 py-2.5 text-fg no-underline hover:bg-surface-2"
            >
              <span className="grid size-9 flex-none place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${k.hue} 16%, var(--color-surface))`, color: k.hue }} title={k.one}>
                <Icon name={k.icon} className="ms-sm" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("truncate text-[15px]", i.broken && "text-on-bad-soft")}>{i.title}</span>
                <span className="truncate text-xs text-fg-2">
                  {k.one}
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
