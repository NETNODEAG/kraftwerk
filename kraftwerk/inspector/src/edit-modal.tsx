import { useEffect } from "react";
import { Icon, isEditPath, navigate } from "./shared";
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
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal edit-modal" role="dialog" aria-label="edit" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="modal-x" onClick={close} title="close (esc)" aria-label="close">
          <Icon name="close" />
        </button>
        <div className="runs-main modal-body">{children}</div>
      </div>
    </div>
  );
}
