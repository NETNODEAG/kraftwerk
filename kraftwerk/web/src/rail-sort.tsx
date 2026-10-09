import { Fragment, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./shared";
import { IconButton, cn } from "./ui";
import type { ProjectLayout } from "./types";

/**
 * The rail's projects in their order, with named sections (the layout lives
 * in the workspace: PUT /api/projects writes kraftwerk-data/projects/order.yml).
 * Drag a project to another place or into a section, drag a section's heading
 * to move the section, Alt+↑/↓ on a focused project moves it one step.
 *
 * The layout is handled as one flat list of tokens — project slugs, and a
 * marker where a section starts — so a move is a splice: a project dragged
 * past a section's heading lands in that section, and deleting a section
 * deletes only its marker, which hands its projects to the group above.
 */

type Token = { slug: string } | { section: string };
type Drag = { slug: string } | { section: string };
const isHead = (t: Token): t is { section: string } => "section" in t;

function toTokens(l: ProjectLayout): Token[] {
  return [...l.top.map((slug) => ({ slug })), ...l.sections.flatMap((s) => [{ section: s.name }, ...s.projects.map((slug) => ({ slug }))])];
}

function fromTokens(tokens: Token[]): ProjectLayout {
  const out: ProjectLayout = { top: [], sections: [] };
  for (const t of tokens) {
    if (isHead(t)) out.sections.push({ name: t.section, projects: [] });
    else (out.sections.at(-1)?.projects ?? out.top).push(t.slug);
  }
  return out;
}

const same = (a: Token, b: Drag) => (isHead(a) ? "section" in b && a.section === b.section : "slug" in b && a.slug === b.slug);

/** Take `what` (a project, or a section with its projects) out and put it back in before token `at` (an index in the original list). */
function move(tokens: Token[], what: Drag, at: number): Token[] {
  const from = tokens.findIndex((t) => same(t, what));
  if (from < 0) return tokens;
  let end = from + 1;
  if ("section" in what) while (end < tokens.length && !isHead(tokens[end])) end++;
  if (at >= from && at <= end) return tokens; // onto itself
  const block = tokens.slice(from, end);
  const rest = [...tokens.slice(0, from), ...tokens.slice(end)];
  const i = at > from ? at - block.length : at;
  return [...rest.slice(0, i), ...block, ...rest.slice(i)];
}

export function SortableProjects({
  layout,
  visible,
  render,
  onSave,
  collapsed,
  onCollapse,
  editing,
  onEdited,
}: {
  layout: ProjectLayout;
  /** Projects shown inside a collapsed section anyway (the one you are in). */
  visible: (slug: string) => boolean;
  /** A project's rows: its own and, open, its assistant, agents and apps. */
  render: (slug: string) => ReactNode;
  onSave: (layout: ProjectLayout) => Promise<boolean>;
  collapsed: (section: string) => boolean;
  onCollapse: (section: string) => void;
  /** The section whose name is being edited (a new one starts out so). */
  editing?: string;
  onEdited: () => void;
}) {
  // Shown at once while it saves; the next poll's layout takes over after.
  const [local, setLocal] = useState<Token[] | null>(null);
  const tokens = local ?? toTokens(layout);
  useEffect(() => setLocal(null), [JSON.stringify(layout)]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | undefined>(editing);
  useEffect(() => setRenaming(editing), [editing]);

  const commit = async (next: Token[]) => {
    setLocal(next);
    if (!(await onSave(fromTokens(next)))) setLocal(null);
  };
  const end = () => {
    setDrag(null);
    setOver(null);
  };

  // Where a drop over token i lands: before it in its upper half, after it in its lower.
  // A section heading takes projects at its start; it takes sections before or after it.
  const target = (e: DragEvent, i: number): number => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const lower = e.clientY > r.top + r.height / 2;
    const t = tokens[i];
    if (drag && "slug" in drag && isHead(t)) return i + 1;
    if (drag && "section" in drag) {
      // A section goes before a heading, or after the whole block of the section below the pointer.
      let k = i;
      while (k >= 0 && !isHead(tokens[k])) k--;
      if (k < 0) return tokens.findIndex(isHead) < 0 ? tokens.length : tokens.findIndex(isHead);
      if (!lower && k === i) return k;
      let e2 = k + 1;
      while (e2 < tokens.length && !isHead(tokens[e2])) e2++;
      return e2;
    }
    return lower ? i + 1 : i;
  };
  // `i` = the token under the pointer; undefined = the end of the list.
  const dropProps = (i?: number) => ({
    onDragOver: (e: DragEvent) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const at = i === undefined ? tokens.length : target(e, i);
      if (at !== over) setOver(at);
    },
    onDrop: (e: DragEvent) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      const next = move(tokens, drag, i === undefined ? tokens.length : target(e, i));
      end();
      if (next !== tokens) void commit(next);
    },
  });
  const dragProps = (what: Drag) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "slug" in what ? what.slug : what.section);
      setDrag(what);
    },
    onDragEnd: end,
  });
  // Alt+↑/↓: one step, across section headings (into the section above or below).
  const keys = (slug: string) => (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const i = tokens.findIndex((t) => !isHead(t) && t.slug === slug);
    const at = e.key === "ArrowUp" ? i - 1 : i + 2;
    if (at < 0 || at > tokens.length) return;
    void commit(move(tokens, { slug }, at));
  };

  const line = (i: number) =>
    drag && over === i ? (
      <div className="relative h-0" aria-hidden>
        <div className="absolute inset-x-2 -top-px h-0.5 rounded-full bg-accent" />
      </div>
    ) : null;

  const rows: ReactNode[] = [];
  let section: string | undefined;
  tokens.forEach((t, i) => {
    rows.push(<Fragment key={`line:${i}`}>{line(i)}</Fragment>);
    if (isHead(t)) {
      section = t.section;
      const name = t.section;
      const folded = collapsed(name);
      let n = 0;
      for (let k = i + 1; k < tokens.length && !isHead(tokens[k]); k++) n++;
      rows.push(
        <div
          key={`section:${name}`}
          {...dropProps(i)}
          {...(renaming === name ? {} : dragProps({ section: name }))}
          className={cn("group/sec mt-2 flex items-center gap-0.5 rounded-control pl-1 pr-1", drag && "section" in drag && drag.section === name && "opacity-40")}
          data-section={name}
        >
          {renaming === name ? (
            <SectionName
              name={name}
              taken={tokens.filter(isHead).map((x) => x.section).filter((x) => x !== name)}
              onDone={(next) => {
                setRenaming(undefined);
                onEdited();
                if (next && next !== name) void commit(tokens.map((x) => (isHead(x) && x.section === name ? { section: next } : x)));
              }}
            />
          ) : (
            <>
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 border-0 bg-transparent px-1 py-1 text-left font-[inherit] text-xs font-semibold text-fg-2 hover:text-fg"
                aria-expanded={!folded}
                title={folded ? `show the projects in ${name}` : `fold ${name}`}
                onClick={() => onCollapse(name)}
              >
                <Icon name="chevron_right" className={cn("ms-sm flex-none text-[15px] transition-transform", !folded && "rotate-90")} />
                <span className="min-w-0 truncate">{name}</span>
                <span className="font-normal tabular-nums opacity-70">{n}</span>
              </button>
              <span className="flex items-center opacity-0 transition-opacity group-hover/sec:opacity-100 group-focus-within/sec:opacity-100 pointer-coarse:opacity-100">
                <IconButton size="sm" icon="edit" label={`rename section ${name}`} onClick={() => setRenaming(name)} />
                <IconButton
                  size="sm"
                  icon="close"
                  label={`remove section ${name}`}
                  title="remove the section; its projects move up"
                  onClick={() => void commit(tokens.filter((x) => !(isHead(x) && x.section === name)))}
                />
              </span>
            </>
          )}
        </div>
      );
      return;
    }
    if (section && collapsed(section) && !visible(t.slug)) return;
    rows.push(
      <div
        key={t.slug}
        {...dropProps(i)}
        {...dragProps({ slug: t.slug })}
        onKeyDown={keys(t.slug)}
        className={cn("flex flex-col gap-0.5", drag && "slug" in drag && drag.slug === t.slug && "opacity-40")}
        data-sort={t.slug}
      >
        {render(t.slug)}
      </div>
    );
  });
  rows.push(<Fragment key="line:end">{line(tokens.length)}</Fragment>);
  // While dragging, the end of the list takes drops too (after the last section's projects).
  if (drag) rows.push(<div key="drop:end" className="h-4" {...dropProps()} />);
  return <>{rows}</>;
}

/** The inline name field of a section: Enter or leaving it saves, Escape keeps the old name. */
function SectionName({ name, taken, onDone }: { name: string; taken: string[]; onDone: (next?: string) => void }) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const clean = value.trim().slice(0, 60);
  const ok = !!clean && !taken.includes(clean);
  return (
    <input
      ref={ref}
      value={value}
      aria-label="section name"
      maxLength={60}
      className={cn(
        "min-w-0 flex-1 rounded-control border bg-surface px-2 py-1 font-[inherit] text-xs font-semibold text-fg outline-none",
        ok ? "border-line focus:border-accent" : "border-bad"
      )}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(ok ? clean : undefined);
        if (e.key === "Escape") onDone();
      }}
      onBlur={() => onDone(ok ? clean : undefined)}
    />
  );
}

/** A section name not yet in the layout: "New section", "New section 2", … */
export function freshSectionName(layout: ProjectLayout): string {
  const names = new Set(layout.sections.map((s) => s.name));
  let name = "New section";
  for (let n = 2; names.has(name); n++) name = `New section ${n}`;
  return name;
}
