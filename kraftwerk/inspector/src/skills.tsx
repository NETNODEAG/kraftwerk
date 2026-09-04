import { Fragment, useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { SkillDetail, SkillInfo } from "./types";
import { Link, usePoll } from "./shared";

/**
 * Skills: browsable instruction packages. Workspace skills (the kraftwerk
 * skills root, git-tracked and shared with the team) come first; skills
 * from .claude/skills and the personal ~/.claude/skills are listed below
 * as machine-/repo-local extras, clearly separated.
 */

const SOURCE_LABEL: Record<SkillInfo["source"], string> = {
  workspace: "workspace",
  project: ".claude",
  user: "global",
  agent: "agent",
};

function sourceChip(source: SkillInfo["source"]) {
  return <span className={`chip skill-src ${source}`}>{SOURCE_LABEL[source]}</span>;
}

export function SkillsScreen({ name }: { name?: string }) {
  const data = usePoll<{ root: string; skills: SkillInfo[] }>("/api/skills", false);
  const skills = data?.skills ?? [];
  const workspace = skills.filter((s) => s.source === "workspace");
  const local = skills.filter((s) => s.source !== "workspace");

  const row = (s: SkillInfo) => (
    <Link
      key={`${s.source}:${s.name}`}
      href={`/skills/${encodeURIComponent(s.name)}`}
      className={`side-row ${s.name === name ? "active" : ""}`}
    >
      <span className={`lamp ${s.source === "workspace" ? "ok" : "dim"}`} />
      <div className="side-row-body">
        <div className="side-row-top">
          <span className="side-wf">/{s.name}</span>
          {s.source !== "workspace" && sourceChip(s.source)}
        </div>
        <div className="side-row-sub">
          <span className="side-req">{s.description || "no description"}</span>
        </div>
      </div>
    </Link>
  );

  return (
    <div className="runs-screen">
      <aside className="runs-side">
        <div className="side-head">
          <span className="microlabel">workspace skills</span>
        </div>
        <div className="side-list">
          {workspace.map(row)}
          {data && workspace.length === 0 && (
            <div className="viewer-note">no workspace skills yet</div>
          )}
          {local.length > 0 && (
            <Fragment>
              <div className="side-head skills-local-head">
                <span className="microlabel">local (this machine / repo)</span>
              </div>
              {local.map(row)}
            </Fragment>
          )}
        </div>
      </aside>
      <div className="runs-main">
        {name ? <SkillView key={name} name={name} /> : <SkillsHome root={data?.root} workspace={workspace} />}
      </div>
    </div>
  );
}

/* ---------- home ---------- */

function SkillsHome({ root, workspace }: { root?: string; workspace: SkillInfo[] }) {
  return (
    <div className="new-chat">
      <div className="page-head">
        <h1>skills</h1>
        <span className="count">{workspace.length} in workspace</span>
      </div>
      <section className="panel new-chat-panel">
        <div className="panel-head">
          <span className="microlabel">what lives here</span>
        </div>
        <div className="know-intro">
          Skills are reusable <b>instruction packages</b>: one folder per skill with a{" "}
          <code>SKILL.md</code> (YAML frontmatter: name, description). <b>Workspace skills</b>
          {root ? <> live under <code>{root}</code></> : null}, are tracked in git and shared with
          everyone in this workspace — they are the ones to build on. Skills from{" "}
          <code>.claude/skills</code> and your personal <code>~/.claude/skills</code> also work
          here, but stay repo-/machine-local. Invoke any skill in a session with{" "}
          <code>/&lt;name&gt;</code>.
        </div>
        <div className="panel-head">
          <span className="microlabel">add a workspace skill</span>
        </div>
        <div className="know-intro">
          Create <code>{root ? `${root}/` : "skills/"}&lt;name&gt;/SKILL.md</code>, commit it, done —
          it appears here and in every session's <code>/</code> menu.
        </div>
      </section>
    </div>
  );
}

/* ---------- detail ---------- */

function SkillView({ name }: { name: string }) {
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [gone, setGone] = useState(false);
  const [view, setView] = useState<"rendered" | "source">("rendered");
  // Strip the frontmatter for the rendered view; the source tab shows the full file.
  const body = useMemo(
    () => (skill ? skill.content.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "") : ""),
    [skill?.content]
  );
  const html = useMemo(
    () => (skill ? DOMPurify.sanitize(marked.parse(body, { async: false })) : ""),
    [body]
  );

  useEffect(() => {
    fetch(`/api/skills/${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setSkill)
      .catch(() => setGone(true));
  }, [name]);

  if (gone) return <div className="empty">skill not found</div>;
  if (!skill) return <div className="empty">loading…</div>;

  return (
    <div className="agent-view">
      <div className="detail-head">
        <h1>/{skill.name}</h1>
        {sourceChip(skill.source)}
      </div>
      {skill.description && <div className="know-intro skill-desc">{skill.description}</div>}

      <div className="detail-cols">
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">SKILL.md</span>
            <span className="spacer" />
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
              <pre>{skill.content.trim() || "(empty)"}</pre>
            )}
          </div>
        </section>

        <aside className="detail-rail">
          <section className="panel">
            <div className="panel-head">
              <span className="microlabel">about</span>
            </div>
            <div className="rail-list">
              <div className="rail-kv">
                <span className="microlabel">source</span>
                <span className="v">
                  {skill.source === "workspace"
                    ? "workspace — git-tracked, shared with the team"
                    : skill.source === "project"
                      ? "repo .claude/skills — tracked, but outside the workspace root"
                      : "global ~/.claude/skills — only on this machine"}
                </span>
              </div>
              <div className="rail-kv">
                <span className="microlabel">path</span>
                <span className="v mono skill-path" title={skill.path}>{skill.path}</span>
              </div>
              <div className="rail-kv">
                <span className="microlabel">invoke</span>
                <span className="v">
                  <code>/{skill.name}</code> in any session
                </span>
              </div>
              {skill.files.length > 0 && (
                <div className="rail-kv">
                  <span className="microlabel">bundled files</span>
                  {skill.files.map((f) => (
                    <span key={f} className="v mono">{f}</span>
                  ))}
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
