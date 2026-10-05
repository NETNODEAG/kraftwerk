import { Icon, useExpertMode, useFeatures, usePoll } from "./shared";
import type { GitStatus } from "./types";
import { cn } from "./ui";

/**
 * The global navigation in the top bar: everything the workspace has, each
 * a full page under the top bar — expert mode only. Simple mode shows no
 * top navigation: workflows, knowledge and vibeables reach people through
 * the context column of their conversation. The columns come back with the
 * next conversation link; what a conversation is linked to shows in its
 * context column (context-panel.tsx).
 */
export function GlobalNav({ path }: { path: string }) {
  const expert = useExpertMode();
  const features = useFeatures();
  const first = path.split("/").filter(Boolean)[0] ?? "";
  // Simple mode has no top navigation at all: the rail and the context column are the whole way around.
  if (!expert) return null;
  const items: { id: string; href: string; label: string; icon: string; badge?: React.ReactNode }[] = [
    { id: "workflows", href: "/workflows", label: "workflows", icon: "account_tree" },
    { id: "knowledge", href: "/knowledge", label: "knowledge", icon: "menu_book" },
    { id: "files", href: "/files", label: "files", icon: "folder_open" },
    ...(features.vibeables ? [{ id: "vibeables", href: "/vibeables", label: "apps", icon: "web" }] : []),
    { id: "skills", href: "/skills", label: "skills", icon: "extension" },
    ...(features.repos ? [{ id: "repos", href: "/repos", label: "repositories", icon: "source" }] : []),
    ...(features.git ? [{ id: "git", href: "/git", label: "git", icon: "cloud_sync", badge: <GitBadge /> }] : []),
    { id: "workspaces", href: "/workspaces", label: "workspaces", icon: "grid_view" },
    { id: "trash", href: "/trash", label: "trash", icon: "delete" },
  ];
  const active = (id: string) => first === id || (id === "workflows" && first === "runs");
  return (
    // global-nav: the top bar's layout rules place it (and the tests find it) by this name.
    <nav className="global-nav flex min-w-0 flex-[0_1_auto] justify-start gap-0.5 overflow-x-auto [scrollbar-width:none] max-[1199px]:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] max-[800px]:hidden" aria-label="Workspace">
      {items.map((t) => {
        const on = active(t.id);
        return (
          <a
            key={t.id}
            href={`#${t.href}`}
            className={cn(
              "inline-flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] font-semibold no-underline transition-colors",
              "[&_.ms]:text-[18px] max-[1520px]:gap-[5px] max-[1520px]:[&_.ms]:text-[17px]",
              on ? "bg-surface text-accent shadow-[inset_0_0_0_1px_var(--line)]" : "text-fg-2 hover:bg-surface-2 hover:text-fg"
            )}
            aria-current={on ? "page" : undefined}
          >
            <Icon name={t.icon} fill={on} /> {t.label}
            {t.badge}
          </a>
        );
      })}
    </nav>
  );
}

/** Ahead/behind counts on the git entry, so the state is visible without opening the screen. */
function GitBadge() {
  const st = usePoll<GitStatus>("/api/git", false, 15_000);
  const dirty = st?.files?.filter((f) => f.syncable).length ?? 0;
  const badge = "ml-[5px] rounded-full bg-surface-2 px-1.5 py-px text-[10.5px] font-semibold tabular-nums";
  return (
    <>
      {!!st?.behind && <span className={cn(badge, "text-accent")}>{st.behind}↓</span>}
      {!!st?.ahead && <span className={cn(badge, "text-ok")}>{st.ahead}↑</span>}
      {!st?.ahead && !st?.behind && !!dirty && <span className={badge}>{dirty}</span>}
    </>
  );
}
