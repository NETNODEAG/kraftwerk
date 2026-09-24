import { Icon, useExpertMode, useFeatures, usePoll } from "./shared";
import type { GitStatus } from "./types";

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
  const items: { id: string; href: string; label: string; icon: string; expert?: boolean; badge?: React.ReactNode }[] = [
    { id: "workflows", href: "/workflows", label: "workflows", icon: "account_tree" },
    { id: "knowledge", href: "/knowledge", label: "knowledge", icon: "menu_book" },
    ...(features.vibeables ? [{ id: "vibeables", href: "/vibeables", label: "vibeables", icon: "web" }] : []),
    { id: "skills", href: "/skills", label: "skills", icon: "extension", expert: true },
    ...(features.repos ? [{ id: "repos", href: "/repos", label: "repositories", icon: "source", expert: true }] : []),
    ...(features.git ? [{ id: "git", href: "/git", label: "git", icon: "cloud_sync", expert: true, badge: <GitBadge /> }] : []),
    { id: "workspaces", href: "/workspaces", label: "workspaces", icon: "grid_view", expert: true },
    { id: "settings", href: "/settings", label: "settings", icon: "settings", expert: true },
  ];
  const active = (id: string) => first === id || (id === "workflows" && first === "runs");
  return (
    <nav className="global-nav" aria-label="Workspace">
      {items.map((t) => (
          <a key={t.id} href={`#${t.href}`} className={`${t.expert ? "nav-expert" : ""}${active(t.id) ? " active" : ""}`} aria-current={active(t.id) ? "page" : undefined}>
            <Icon name={t.icon} /> {t.label}
            {t.badge}
          </a>
        ))}
    </nav>
  );
}

/** Ahead/behind counts on the git entry, so the state is visible without opening the screen. */
function GitBadge() {
  const st = usePoll<GitStatus>("/api/git", false, 15_000);
  const dirty = st?.files?.filter((f) => f.syncable).length ?? 0;
  return (
    <>
      {!!st?.behind && <span className="git-badge behind">{st.behind}↓</span>}
      {!!st?.ahead && <span className="git-badge ahead">{st.ahead}↑</span>}
      {!st?.ahead && !st?.behind && !!dirty && <span className="git-badge dirty">{dirty}</span>}
    </>
  );
}
