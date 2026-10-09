import { useEffect } from "react";
import { isEditPath, navigate } from "./shared";
import { IconButton } from "./ui";
import { NewProjectPage, ProjectPage } from "./projects";
import { AgentEditor, AgentView } from "./agents";
import { ChannelEditPage } from "./channels";

/**
 * Editing the thing you are talking to — a project's page, an agent's
 * profile or editor, a channel's editor — and creating a new one happen
 * in a modal over the conversation, not in its column: the pencil on the
 * sign and the "new …" links open it, and the chat stays where it was.
 * The routes are unchanged (`/info`, `/edit`, `/new` under a
 * conversation); the shell just renders them here and keeps the columns
 * on the last conversation path.
 */
export function editScreenOf(path: string): React.ReactNode | null {
  if (!isEditPath(path)) return null;
  const seg = path.split("/").filter(Boolean);
  const slug = decodeURIComponent(seg[1]);
  const agent = seg[0] === "agents" || seg[0] === "team";
  if (slug === "new") {
    if (seg[0] === "projects") return <NewProjectPage key="new-project" />;
    if (agent) return <AgentEditor key="new-agent" />;
    return <ChannelEditPage key="new-channel" />;
  }
  if (seg[0] === "projects" && seg[2] === "info") return <ProjectPage key={slug} slug={slug} onChanged={async () => {}} />;
  if (agent && seg[2] === "info") return <AgentView key={slug} slug={slug} />;
  if (agent && seg[2] === "edit") return <AgentEditor key={slug} slug={slug} />;
  if (seg[0] === "channels" && seg[2] === "edit") return <ChannelEditPage key={slug} slug={slug} />;
  return null;
}

export function EditModal({ back, children }: { back: string; children: React.ReactNode }) {
  const close = () => navigate(back);
  useEffect(() => {
    // Escape closes, also from inside a field (the forms autofocus their first
    // one) — unless the palette is up, which takes its own escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".palette-backdrop")) return;
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      className="fixed inset-0 z-40 flex animate-fade items-start justify-center bg-black/38 px-4 pt-[6vh] pb-4 max-[800px]:p-0"
      onMouseDown={close}
    >
      <div
        className="edit-modal relative max-h-[88dvh] w-[min(960px,100%)] animate-modal overflow-y-auto rounded-card border border-line bg-surface shadow-modal max-[800px]:max-h-dvh max-[800px]:rounded-none"
        role="dialog"
        aria-label="edit"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <IconButton icon="close" label="close (esc)" className="absolute top-3 right-3 z-1 rounded-full" onClick={close} />
        {/* runs-main: the screens rendered here still lean on its descendant rules until phase 4. */}
        <div className="runs-main min-w-0 pt-[18px] pr-12 pb-10 pl-6">{children}</div>
      </div>
    </div>
  );
}
