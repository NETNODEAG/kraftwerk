import { useApi } from "./api";
import { Icon, Link, useFeatures } from "./shared";
import { cn, IconButton } from "./ui";

/** One entry of the settings navigation. */
interface NavItem {
  id: string;
  href: string;
  label: string;
  icon: string;
  /** Keeps its label on a laptop's width; the others show their icon there and the label on hover. */
  main?: boolean;
}

/** The overviews the settings navigation links to, as the workspace's features allow. */
function useNavItems(): NavItem[] {
  const features = useFeatures();
  return [
    { id: "settings", main: true, href: "/settings", label: "base settings", icon: "settings" },
    { id: "agents", main: true, href: "/settings/agents", label: "agents", icon: "smart_toy" },
    ...(features.projects ? [{ id: "projects", main: true, href: "/settings/projects", label: "projects", icon: "folder_special" }] : []),
    { id: "routines", main: true, href: "/settings/routines", label: "routines", icon: "schedule" },
    { id: "workflows", main: true, href: "/settings/workflows", label: "workflows", icon: "account_tree" },
    { id: "knowledge", main: true, href: "/settings/knowledge", label: "knowledge", icon: "menu_book" },
    { id: "files", main: true, href: "/files", label: "files", icon: "folder_open" },
    ...(features.boards ? [{ id: "boards", main: true, href: "/settings/boards", label: "boards", icon: "view_kanban" }] : []),
    ...(features.presentations ? [{ id: "presentations", href: "/presentations", label: "presentations", icon: "slideshow" }] : []),
    ...(features.vibeables ? [{ id: "vibeables", href: "/settings/apps", label: "apps", icon: "web" }] : []),
    { id: "skills", main: true, href: "/settings/skills", label: "skills", icon: "extension" },
    ...(features.repos ? [{ id: "repos", href: "/repos", label: "repositories", icon: "source" }] : []),
    ...(features.contacts ? [{ id: "contacts", href: "/contacts", label: "contacts", icon: "person" }] : []),
    ...(features.places ? [{ id: "places", href: "/places", label: "places", icon: "location_on" }] : []),
    ...(features.events ? [{ id: "events", href: "/events", label: "events", icon: "event" }] : []),
    { id: "workspaces", href: "/workspaces", label: "workspaces", icon: "grid_view" },
  ];
}

/** The pages the settings navigation sits above: the settings and every overview it links to. */
const SECTION = new Set(["settings", "workflows", "runs", "knowledge", "files", "boards", "presentations", "vibeables", "skills", "repos", "contacts", "places", "events", "workspaces"]);

/** The overviews under #/settings/<id>, named like their entry in the navigation. */
const OVERVIEWS = new Set(["agents", "routines", "workflows", "knowledge", "boards", "skills"]);

/** Whether `path` is a page of the settings section (and so carries its navigation). */
export function inSettingsSection(path: string): boolean {
  return SECTION.has(path.split("?")[0].split("/").filter(Boolean)[0] ?? "");
}

/**
 * The second navigation bar, under the top bar: the base settings first,
 * then every overview the workspace has (all workflows, all knowledge, …).
 * It is the way to those pages for everyone — the top bar has no
 * navigation of its own, and expert mode only decides how much a chat shows.
 * It stays on the overviews, so one leads to the next without going back.
 * It fits a laptop without scrolling sideways: see the labels below.
 */
export function SettingsNav({ path }: { path: string }) {
  const items = useNavItems();
  const [first = "", second = ""] = path.split("?")[0].split("/").filter(Boolean);
  // The overviews live under the settings (#/settings/agents, …; apps are the vibeables); #/agents is the conversations.
  const here = first === "settings" ? (OVERVIEWS.has(second) ? second : second === "apps" ? "vibeables" : "settings") : first === "runs" ? "workflows" : first;
  const active = (id: string) => here === id;
  return (
    // settings-nav: the tests find it by this name.
    <nav
      className="settings-nav sticky top-[var(--topbar-h)] z-[9] flex h-11 items-center gap-0.5 overflow-x-auto bg-bg px-5 shadow-[inset_0_-1px_0_var(--line)] [scrollbar-width:none] max-[800px]:px-3"
      aria-label="Settings"
    >
      {items.map((t, i) => {
        const on = active(t.id);
        return (
          <Link
            key={t.id}
            href={t.href}
            className={cn(
              "inline-flex flex-none items-center gap-1.5 rounded-full px-3 py-1 text-[13.5px] font-semibold no-underline transition-colors [&_.ms]:text-[18px]",
              on ? "bg-surface text-accent shadow-[inset_0_0_0_1px_var(--line)]" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
              // The base settings stand apart from the overviews that follow.
              i === 0 && "mr-2"
            )}
            aria-current={on ? "page" : undefined}
            aria-label={t.label}
            title={t.label}
          >
            {/* All fifteen labels need about 1700px: below that the lesser ones are icons (the one you are on keeps its label), on a phone all are. */}
            <Icon name={t.icon} fill={on} /> <span className={cn(!on && (t.main ? "max-[1100px]:hidden" : "max-[1720px]:hidden"))}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Git and the trash, beside the search in the top bar — for everyone, whatever the mode. */
export function TopbarTools({ path }: { path: string }) {
  const features = useFeatures();
  const first = path.split("?")[0].split("/").filter(Boolean)[0] ?? "";
  return (
    <>
      {features.git && (
        <span className="relative inline-flex flex-none">
          <IconButton icon="cloud_sync" label="git" href="/git" className={first === "git" ? "text-accent" : undefined} />
          <GitBadge />
        </span>
      )}
      <IconButton icon="delete" label="trash" href="/trash" className={first === "trash" ? "text-accent" : undefined} />
    </>
  );
}

/** Ahead/behind counts on the git button, so the state is visible without opening the screen. */
function GitBadge() {
  const st = useApi("git.status", {}, { interval: 15_000 });
  const dirty = st?.files?.filter((f) => f.syncable).length ?? 0;
  const text = st?.behind ? `${st.behind}↓` : st?.ahead ? `${st.ahead}↑` : dirty ? String(dirty) : "";
  if (!text) return null;
  return (
    <span
      className={cn(
        "git-badge pointer-events-none absolute -top-1 -right-1.5 rounded-full bg-surface-2 px-1 text-[10px] leading-[14px] font-semibold tabular-nums",
        st?.behind ? "text-accent" : st?.ahead ? "text-ok" : "text-fg-2"
      )}
    >
      {text}
    </span>
  );
}
