import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "./api";
import { Icon } from "./shared";
import { cn } from "./ui";
import type { SlideDef } from "./types";
// The renderer and the slot helpers are shared with the server: one HTML for the editor, present mode and the exports.
import { slideView, slotStyle, stageCss, stageHeight, type SlideView, type SlotView, type StageTemplate } from "../../src/core/presentations/html";
import { defaultSlotOf, PPI, STAGE_W, type SlotPatch } from "../../src/core/presentations/layout";
import { clean, htmlToMd, richEditable } from "./deck-text";
import { CHART_KINDS, chartSource, parseChart, type ChartData } from "../../src/core/presentations/chart";

/**
 * The slide on the page: drawing it (SlideCanvas, Thumb), the theme's CSS
 * in the document (useDeckCss), and editing it where it stands (Stage):
 * select one box or several (⇧-click, a frame dragged over the slide),
 * move them with guides, resize from the corners, rotate from the handle
 * above, nudge with the arrows, copy and paste, change the layer, type into
 * a box in the slide's own fonts — and the Format panel for everything a
 * box or the slide can be. Changes are patches to the slide's `slots:`.
 */

export type Box = { x: number; y: number; w: number; h: number };
export const round = (n: number): number => Math.round(n * 100) / 100;

/* ---------- the theme on the page ---------- */

/** The themes' CSS (and the deck's own, on the first) in the document while a deck shows; the fonts they name load once. */
export function useDeckCss(themes: StageTemplate[], deckCss: string | undefined): void {
  const key = themes.map((t) => `${t.slug}:${t.css.length}`).join("|") + `|${deckCss ?? ""}`;
  useEffect(() => {
    const els = themes.map((t, i) => {
      const el = document.createElement("style");
      el.dataset.deckTheme = t.slug;
      el.textContent = stageCss({ ...t, css: t.css.replaceAll("{{base}}", api.baseUrl) }, i === 0 ? (deckCss ?? "") : "");
      document.head.appendChild(el);
      return el;
    });
    return () => els.forEach((el) => el.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** CSS from slotStyle (kebab-case) as React wants it. */
const react = (o: Record<string, string>): CSSProperties => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()), v])) as CSSProperties;

export interface EditorHooks {
  live: Record<string, Box & { rotate?: number }>;
  editing: string | null;
  onSlotPointerDown: (e: React.PointerEvent, s: SlotView) => void;
  onSlotDoubleClick: (s: SlotView) => void;
  onSlotContextMenu: (e: React.MouseEvent, s: SlotView) => void;
  onBackgroundPointerDown: (e: React.PointerEvent) => void;
  richEditor: (s: SlotView) => ReactNode;
}

/** One slide as live HTML, scaled to `width`. */
export function SlideCanvas({ view, theme, width, thumb, number, editor, children }: { view: SlideView; theme: StageTemplate; width: number; thumb?: boolean; number?: { n: number; of: number }; editor?: EditorHooks; children?: ReactNode }) {
  const scale = width / STAGE_W;
  const h = stageHeight(theme.size);
  // A slide with `number: false` shows none; a deck with `numbers: false` passes none.
  const shown = view.numbered ? number : undefined;
  return (
    <div className="relative overflow-hidden" style={{ width, height: h * scale }}>
      <div
        className={`deck-slide deck-theme-${theme.slug} layout-${view.layout}`}
        data-n={shown?.n}
        data-nn={shown ? String(shown.n).padStart(2, "0") : undefined}
        data-of={shown?.of}
        style={{ position: "absolute", left: 0, top: 0, width: STAGE_W, height: h, background: view.background, transform: `scale(${scale})`, transformOrigin: "0 0" }}
        onPointerDown={editor ? (e) => e.target === e.currentTarget && editor.onBackgroundPointerDown(e) : undefined}
      >
        {view.shapes.map((s, i) => (
          <div key={i} className="deck-shape" style={{ left: s.x * PPI, top: s.y * PPI, width: s.w * PPI, height: s.h * PPI, background: s.fill }} onPointerDown={editor ? (e) => editor.onBackgroundPointerDown(e) : undefined} />
        ))}
        {view.slots.map((s) => {
          const live = editor?.live[s.name];
          const box = live ? { ...s, ...live } : s;
          const empty = !s.html && !s.embed;
          if (empty && !editor) return null;
          const editing = editor?.editing === s.name;
          return (
            <div
              key={s.name}
              data-slot={s.name}
              data-valign={s.valign}
              data-fit={s.fit}
              className={cn("deck-slot", `kind-${s.kind}`, `slot-${s.name}`, s.class, editor && !editing && "cursor-move")}
              style={react(slotStyle(box, theme))}
              onPointerDown={editor && !editing ? (e) => editor.onSlotPointerDown(e, s) : undefined}
              onDoubleClick={editor && !editing ? () => editor.onSlotDoubleClick(s) : undefined}
              onContextMenu={editor ? (e) => editor.onSlotContextMenu(e, s) : undefined}
            >
              {editing && editor ? (
                editor.richEditor(s)
              ) : empty ? (
                <div className="deck-content" style={{ opacity: 0.38, fontStyle: "italic", fontWeight: 400 }}>
                  {s.kind === "image" ? "Picture — double click to choose one" : s.kind === "chart" ? "Chart — double click for its data" : s.kind === "html" ? "HTML — double click" : s.kind === "embed" ? "Embed — a URL or a page" : (s.placeholder?.split("\n")[0] ?? s.name)}
                </div>
              ) : s.embed ? (
                thumb ? (
                  <div className="deck-content" style={{ background: "#eee", color: "#999", fontSize: 24 }}>
                    embed
                  </div>
                ) : (
                  <div className="deck-content">
                    <iframe title={s.name} {...(s.embed.src ? { src: s.embed.src } : { srcDoc: s.embed.srcdoc })} sandbox="allow-scripts allow-popups allow-forms" style={editor ? { pointerEvents: "none" } : undefined} />
                  </div>
                )
              ) : (
                <div className="deck-content" dangerouslySetInnerHTML={{ __html: clean(s.html) }} />
              )}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/** A slide drawn from the deck: the view computed once per content. */
export function useView(slide: SlideDef | undefined, theme: StageTemplate | undefined, asset: (src: string) => string): SlideView | null {
  return useMemo(() => (slide && theme ? slideView(slide, theme, { asset }) : null), [slide, theme, asset]);
}

/** A picture of a slide for the eye: hidden from the reader (the stage has its text), its lists are not the strip's. */
export function Thumb({ slide, theme, asset, width, number }: { slide: SlideDef; theme: StageTemplate; asset: (s: string) => string; width: number; number?: { n: number; of: number } }) {
  const view = useView(slide, theme, asset);
  return view ? (
    <div aria-hidden inert>
      <SlideCanvas view={view} theme={theme} width={width} thumb number={number} />
    </div>
  ) : null;
}

/* ---------- patches ---------- */

export const patchesOf = (s: SlideDef): Record<string, SlotPatch> => {
  const v = s.extra?.slots;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, SlotPatch>) : {};
};

/** The slide with several slots' changes merged in (null drops a slot's changes). */
export function withPatches(slide: SlideDef, changes: Record<string, SlotPatch | null>): Pick<SlideDef, "extra"> {
  const all = { ...patchesOf(slide) };
  for (const [name, patch] of Object.entries(changes)) {
    if (patch === null) delete all[name];
    else {
      const next: Record<string, unknown> = { ...(all[name] ?? {}), ...patch };
      for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
      all[name] = next as SlotPatch;
    }
  }
  const extra = { ...slide.extra };
  if (Object.keys(all).length) extra.slots = all;
  else delete extra.slots;
  return { extra };
}

export const defaultOf = (t: StageTemplate, layout: string): string | undefined => (t.layouts[layout] ? defaultSlotOf(t.layouts[layout]) : undefined);

/** Slots the editor opens beside the slide instead of on it. */
export const sourceKind = (s: SlotView): boolean => s.kind === "html" || s.kind === "embed" || s.kind === "chart" || s.kind === "image" || ((s.kind === "markdown" || s.kind === "table") && !richEditable(s.md));

/** Fonts the format controls offer besides the theme's two. */
export const FONT_CHOICES = ["Helvetica Neue", "Arial", "Avenir Next", "Futura", "Georgia", "Times New Roman", "Verdana", "Trebuchet MS", "Courier New"];

/* ---------- menus ---------- */

/** One-click requests on a box (the "ask" menu over it): what ChatGPT offers on a selection. */
export const QUICK_ASKS: { icon: string; label: string; text: string }[] = [
  { icon: "compress", label: "Shorten", text: "Shorten it to the essentials; keep the meaning and the facts." },
  { icon: "edit_note", label: "Rewrite clearer", text: "Rewrite it to be clearer and more direct, same length or shorter." },
  { icon: "format_list_bulleted", label: "Make it bullet points", text: "Turn it into three to five short bullet points." },
  { icon: "bar_chart", label: "Make it a chart", text: "Show its numbers as a chart (a chart block) or, without numbers, as one of the theme's pieces (cards, kpis, flow, timeline)." },
  { icon: "translate", label: "Translate to English", text: "Translate it to English." },
  { icon: "translate", label: "Translate to German", text: "Translate it to German (Swiss spelling, ss not ß)." },
  { icon: "record_voice_over", label: "Write speaker notes", text: "Write speaker notes for this slide (`???` notes): what to say about this box in two or three sentences." },
];

export function Menu({ label, onClose, className, style, children }: { label: string; onClose: () => void; className?: string; style?: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[aria-haspopup]")) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label={label} className={cn("z-50 max-h-[70vh] overflow-auto rounded-xl border border-line bg-surface p-1 shadow-[var(--elev-pop)]", className)} style={style}>
      {children}
    </div>
  );
}

export function MenuItem({ icon, title, sub, keys, danger, disabled, onClick }: { icon?: string; title: string; sub?: string; keys?: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} className={cn("flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-40", danger && "text-bad")} onClick={onClick}>
      {icon && <Icon name={icon} className="ms-sm mt-0.5 text-fg-2" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm">{title}</span>
        {sub && <span className="text-xs text-fg-2">{sub}</span>}
      </span>
      {keys && <span className="pt-0.5 text-xs text-fg-2">{keys}</span>}
    </button>
  );
}

export const MenuSep = () => <div className="my-1 border-t border-line" />;

/* ---------- the stage ---------- */

export interface StageProps {
  view: SlideView;
  theme: StageTemplate;
  slide: SlideDef;
  number?: { n: number; of: number };
  /** Screen width of the slide; null fits the column. */
  zoom: number | null;
  selected: string[];
  editing: string | null;
  onSelect: (names: string[]) => void;
  onEditing: (name: string | null) => void;
  onSource: (name: string) => void;
  onPatches: (changes: Record<string, SlotPatch | null>, mark?: string) => void;
  onText: (name: string, md: string) => void;
  onRemove: (names: string[]) => void;
  onDuplicate: (names: string[]) => void;
  onCopy: (names: string[]) => void;
  onPaste: () => void;
  canPaste: boolean;
  /** Ask an agent about a box: with `quick`, that request goes at once; without, the ask field is filled for typing. */
  onAsk: (name: string, quick?: string) => void;
  onFormat: () => void;
  onDropFile: (f: File) => void;
  onWidth?: (w: number) => void;
  /** Open comments on this slide by box ("" for the slide itself). */
  pins?: Record<string, number>;
  /** Boxes other editors of the deck have selected on this slide: an outline in their color with their name. */
  others?: { slot: string; who: string; color: string }[];
  onComments?: (slot?: string) => void;
}

type Guide = { axis: "x" | "y"; at: number };
type Corner = "nw" | "ne" | "sw" | "se";

export function Stage(p: StageProps) {
  const { view, theme, slide, selected, editing } = p;
  const wrap = useRef<HTMLDivElement>(null);
  const [fitW, setFitW] = useState(0);
  const [live, setLive] = useState<Record<string, Box & { rotate?: number }>>({});
  const [guides, setGuides] = useState<Guide[]>([]);
  const [band, setBand] = useState<Box | null>(null);
  const [dropping, setDropping] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; slot: string } | null>(null);
  const h = stageHeight(theme.size);
  const canvasW = STAGE_W / PPI;
  const canvasH = h / PPI;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // A scrollbar coming and going changes the width by its own width: ignore that much, or the slide keeps resizing.
    const fit = () => {
      const next = Math.min(el.clientWidth - 18, (Math.max(260, window.innerHeight - 250) * STAGE_W) / h);
      setFitW((prev) => (prev && Math.abs(prev - next) < 20 && next < prev + 20 ? Math.min(prev, el.clientWidth) : next));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    fit();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [h]);
  const width = p.zoom ? STAGE_W * p.zoom : fitW;
  useEffect(() => p.onWidth?.(Math.min(width, fitW || width)), [width, fitW]); // eslint-disable-line react-hooks/exhaustive-deps

  const perInch = (width / STAGE_W) * PPI;
  const sel = view.slots.filter((s) => selected.includes(s.name));
  const one = sel.length === 1 ? sel[0] : null;
  const filled = (s: SlotView) => !!(s.html || s.embed);

  /** Move (all selected), resize or rotate (one) from a pointer press. */
  const startDrag = (e: React.PointerEvent, s: SlotView, mode: "move" | Corner | "rotate") => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu(null);
    // Keys now act on the boxes: whatever had the focus (a thumbnail, a field, the box being typed into) lets go.
    (document.activeElement as HTMLElement | null)?.blur();
    let group = selected;
    if (mode === "move") {
      if (e.shiftKey || e.metaKey) {
        p.onSelect(selected.includes(s.name) ? selected.filter((n) => n !== s.name) : [...selected, s.name]);
        return;
      }
      if (!selected.includes(s.name)) {
        group = [s.name];
        p.onSelect(group);
      }
    }
    const moving = view.slots.filter((x) => (mode === "move" ? group.includes(x.name) : x.name === s.name));
    const starts = Object.fromEntries(moving.map((x) => [x.name, { x: x.x, y: x.y, w: x.w, h: x.h, rotate: x.rotate ?? 0 }]));
    const x0 = e.clientX;
    const y0 = e.clientY;
    const others = view.slots.filter((o) => !group.includes(o.name) && filled(o));
    const xs = [0, canvasW / 2, canvasW, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
    const ys = [0, canvasH / 2, canvasH, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
    const tol = 6 / perInch;
    const snap = (vals: number[], targets: number[]): { delta: number; at: number } | null => {
      let best: { delta: number; at: number } | null = null;
      for (const v of vals) for (const t of targets) if (Math.abs(t - v) <= tol && (!best || Math.abs(t - v) < Math.abs(best.delta))) best = { delta: t - v, at: t };
      return best;
    };
    const rect = (e.currentTarget as HTMLElement).closest("[data-stage]")?.getBoundingClientRect();
    let last: Record<string, Box & { rotate?: number }> | null = null;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / perInch;
      const dy = (ev.clientY - y0) / perInch;
      if (!last && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      const g: Guide[] = [];
      const next: Record<string, Box & { rotate?: number }> = {};
      if (mode === "move") {
        // The pressed box leads the snapping; the others keep their distance to it.
        const lead = starts[s.name] ?? Object.values(starts)[0];
        let mx = dx;
        let my = dy;
        if (!ev.altKey) {
          const b = { x: lead.x + dx, y: lead.y + dy, w: lead.w, h: lead.h };
          const sx = snap([b.x, b.x + b.w / 2, b.x + b.w], xs);
          const sy = snap([b.y, b.y + b.h / 2, b.y + b.h], ys);
          if (sx) {
            mx += sx.delta;
            g.push({ axis: "x", at: sx.at });
          }
          if (sy) {
            my += sy.delta;
            g.push({ axis: "y", at: sy.at });
          }
        }
        for (const [n, st] of Object.entries(starts)) next[n] = { x: round(st.x + mx), y: round(st.y + my), w: st.w, h: st.h };
      } else if (mode === "rotate") {
        const st = starts[s.name];
        if (!rect) return;
        const cx = rect.left + (st.x + st.w / 2) * perInch;
        const cy = rect.top + (st.y + st.h / 2) * perInch;
        // Turned by as much as the pointer turned around the box's middle since the press.
        const angle = (x: number, y: number) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
        let deg = (st.rotate ?? 0) + angle(ev.clientX, ev.clientY) - angle(x0, y0);
        if (!ev.altKey) {
          const snapTo = Math.round(deg / 15) * 15;
          if (Math.abs(snapTo - deg) < 4) deg = snapTo;
        }
        deg = ((Math.round(deg) % 360) + 360) % 360;
        next[s.name] = { ...st, rotate: deg > 180 ? deg - 360 : deg };
      } else {
        const st = starts[s.name];
        const b = { ...st };
        if (mode.includes("e")) b.w = Math.max(0.2, st.w + dx);
        if (mode.includes("s")) b.h = Math.max(0.15, st.h + dy);
        if (mode.includes("w")) {
          b.w = Math.max(0.2, st.w - dx);
          b.x = st.x + st.w - b.w;
        }
        if (mode.includes("n")) {
          b.h = Math.max(0.15, st.h - dy);
          b.y = st.y + st.h - b.h;
        }
        if (ev.shiftKey && st.h > 0) {
          // Keep the proportions (pictures, shapes).
          const ratio = st.w / st.h;
          if (b.w / b.h > ratio) b.w = b.h * ratio;
          else b.h = b.w / ratio;
          if (mode.includes("w")) b.x = st.x + st.w - b.w;
          if (mode.includes("n")) b.y = st.y + st.h - b.h;
        }
        if (!ev.altKey) {
          const sx = snap([mode.includes("e") ? b.x + b.w : b.x], xs);
          if (sx) {
            if (mode.includes("e")) b.w += sx.delta;
            else {
              b.x += sx.delta;
              b.w -= sx.delta;
            }
            g.push({ axis: "x", at: sx.at });
          }
          const sy = snap([mode.includes("s") ? b.y + b.h : b.y], ys);
          if (sy) {
            if (mode.includes("s")) b.h += sy.delta;
            else {
              b.y += sy.delta;
              b.h -= sy.delta;
            }
            g.push({ axis: "y", at: sy.at });
          }
        }
        next[s.name] = { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) };
      }
      last = next;
      setLive(next);
      setGuides(g);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides([]);
      // A click (no drag) on one box of a selection of several selects just that box.
      if (!last && mode === "move" && group.length > 1) p.onSelect([s.name]);
      if (last) {
        const changes: Record<string, SlotPatch> = {};
        for (const [n, b] of Object.entries(last)) changes[n] = mode === "rotate" ? { rotate: b.rotate || undefined } : { x: b.x, y: b.y, w: b.w, h: b.h };
        p.onPatches(changes);
      }
      setLive({});
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** A frame dragged over the slide selects what it touches; a plain click on the slide selects nothing. */
  const startBand = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setMenu(null);
    (document.activeElement as HTMLElement | null)?.blur();
    const rect = (e.currentTarget as HTMLElement).closest("[data-stage]")?.getBoundingClientRect();
    if (!rect) return;
    const at = (ev: { clientX: number; clientY: number }) => ({ x: (ev.clientX - rect.left) / perInch, y: (ev.clientY - rect.top) / perInch });
    const a = at(e);
    const additive = e.shiftKey || e.metaKey;
    const base = additive ? selected : [];
    let moved = false;
    const move = (ev: PointerEvent) => {
      const b = at(ev);
      if (!moved && Math.abs(b.x - a.x) * perInch < 4 && Math.abs(b.y - a.y) * perInch < 4) return;
      moved = true;
      const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      setBand(box);
      const hit = view.slots.filter((s) => s.x < box.x + box.w && s.x + s.w > box.x && s.y < box.y + box.h && s.y + s.h > box.y && (filled(s) || s.own)).map((s) => s.name);
      p.onSelect([...new Set([...base, ...hit])]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBand(null);
      if (!moved) p.onSelect(base);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const open = (s: SlotView) => {
    p.onSelect([s.name]);
    if (sourceKind(s)) p.onSource(s.name);
    else p.onEditing(s.name);
  };

  // Keys on the selection (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (editing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        p.onSelect(view.slots.filter((s) => filled(s) || s.own).map((s) => s.name));
        return;
      }
      if (mod && e.key.toLowerCase() === "v" && p.canPaste) {
        e.preventDefault();
        p.onPaste();
        return;
      }
      if (!sel.length) return;
      const step = e.shiftKey ? 0.25 : 0.05;
      if (e.key === "Escape") p.onSelect([]);
      else if (e.key === "Enter" && one) {
        e.preventDefault();
        open(one);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        p.onRemove(sel.map((s) => s.name));
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        p.onDuplicate(sel.map((s) => s.name));
      } else if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        p.onCopy(sel.map((s) => s.name));
      } else if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        p.onCopy(sel.map((s) => s.name));
        p.onRemove(sel.map((s) => s.name));
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        p.onPatches(Object.fromEntries(sel.map((s) => [s.name, { x: round(s.x + dx), y: round(s.y + dy) }])), `nudge:${selected.join(",")}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const layers = (dir: "front" | "forward" | "backward" | "back") => {
    const zs = view.slots.map((s, i) => s.z ?? i);
    const max = Math.max(...zs);
    const min = Math.min(...zs);
    p.onPatches(
      Object.fromEntries(
        sel.map((s) => {
          const z = s.z ?? view.slots.indexOf(s);
          return [s.name, { z: dir === "front" ? max + 1 : dir === "back" ? min - 1 : dir === "forward" ? z + 1 : z - 1 }];
        }),
      ),
    );
  };

  const alignAll = (how: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
    // Several boxes align to each other; one box to the slide.
    const pool = sel.length > 1 ? sel : [{ x: 0, y: 0, w: canvasW, h: canvasH }];
    const L = Math.min(...pool.map((s) => s.x));
    const R = Math.max(...pool.map((s) => s.x + s.w));
    const T = Math.min(...pool.map((s) => s.y));
    const B = Math.max(...pool.map((s) => s.y + s.h));
    p.onPatches(
      Object.fromEntries(
        sel.map((s) => [
          s.name,
          how === "left" ? { x: round(L) } : how === "right" ? { x: round(R - s.w) } : how === "center" ? { x: round((L + R) / 2 - s.w / 2) } : how === "top" ? { y: round(T) } : how === "bottom" ? { y: round(B - s.h) } : { y: round((T + B) / 2 - s.h / 2) },
        ]),
      ),
    );
  };

  const handle = "absolute size-2.5 rounded-full border-2 border-accent bg-white";
  const boxOf = (s: SlotView) => ({ ...s, ...(live[s.name] ?? {}) });
  const outer = one ? boxOf(one) : null;
  const groupBox = sel.length > 1 ? { x: Math.min(...sel.map((s) => boxOf(s).x)), y: Math.min(...sel.map((s) => boxOf(s).y)), w: 0, h: 0 } : null;

  return (
    <div
      ref={wrap}
      className={cn("relative w-full", p.zoom && "overflow-auto", dropping && "outline-dashed outline-2 outline-accent")}
      style={p.zoom ? { maxHeight: "calc(100vh - 230px)" } : undefined}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        const f = [...e.dataTransfer.files].find((x) => /^image\/(png|jpe?g|gif)$/.test(x.type));
        setDropping(false);
        if (f) {
          e.preventDefault();
          p.onDropFile(f);
        }
      }}
    >
      <div className="relative mx-auto my-6 rounded-md shadow-[0_2px_18px_rgb(0_0_0/0.22)]" style={{ width }} role="group" aria-label="slide" data-stage>
        {width > 0 && (
          <SlideCanvas
            view={view}
            theme={theme}
            width={width}
            number={p.number}
            editor={{
              live,
              editing,
              onSlotPointerDown: (e, s) => startDrag(e, s, "move"),
              onSlotDoubleClick: open,
              onSlotContextMenu: (e, s) => {
                e.preventDefault();
                if (!selected.includes(s.name)) p.onSelect([s.name]);
                const r = (e.currentTarget as HTMLElement).closest("[data-stage]")!.getBoundingClientRect();
                setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, slot: s.name });
              },
              onBackgroundPointerDown: startBand,
              richEditor: (s) => (
                <RichEdit
                  key={s.name}
                  s={s}
                  onCommit={(md) => {
                    if (md !== (s.md ?? "")) p.onText(s.name, md);
                    p.onEditing(null);
                  }}
                  onCancel={() => p.onEditing(null)}
                />
              ),
            }}
          >
            {/* Frames: the selection (solid), the rest on hover. */}
            {view.slots.map((s) => {
              const b = boxOf(s);
              const on = selected.includes(s.name);
              return (
                <div
                  key={s.name}
                  aria-hidden
                  className={cn("pointer-events-none absolute rounded-[2px]", on ? "outline outline-2 outline-accent" : "")}
                  style={{ left: b.x * perInch, top: b.y * perInch, width: b.w * perInch, height: b.h * perInch, transform: b.rotate ? `rotate(${b.rotate}deg)` : undefined }}
                  data-frame={s.name}
                />
              );
            })}
            {guides.map((g, i) =>
              g.axis === "x" ? <div key={i} className="pointer-events-none absolute top-0 h-full w-px bg-[#ec4899]" style={{ left: g.at * perInch }} /> : <div key={i} className="pointer-events-none absolute left-0 h-px w-full bg-[#ec4899]" style={{ top: g.at * perInch }} />,
            )}
            {/* Open comments: a pin on the box they are about, the slide's own at its top right. */}
            {Object.entries(p.pins ?? {}).map(([name, count]) => {
              const s = view.slots.find((x) => x.name === name);
              const left = s ? (s.x + s.w) * perInch - 10 : width - 30;
              const top = s ? s.y * perInch - 10 : 8;
              return (
                <button key={`pin:${name}`} type="button" aria-label={`${count} comment${count === 1 ? "" : "s"}${name ? ` on ${name}` : " on this slide"}`} className="absolute z-20 grid h-5 min-w-5 place-items-center rounded-full rounded-bl-none bg-[#f59e0b] px-1 text-[11px] font-semibold text-black shadow" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onClick={() => p.onComments?.(name || undefined)}>
                  {count}
                </button>
              );
            })}
            {(p.others ?? []).map((o) => {
              const b = view.slots.find((x) => x.name === o.slot);
              if (!b) return null;
              return (
                <div key={`other:${o.who}:${o.slot}`} role="note" aria-label={`${o.who} is on ${o.slot}`} className="pointer-events-none absolute z-10 rounded-[2px]" style={{ left: b.x * perInch, top: b.y * perInch, width: b.w * perInch, height: b.h * perInch, outline: `2px solid ${o.color}`, transform: b.rotate ? `rotate(${b.rotate}deg)` : undefined }}>
                  <span className="absolute -top-[18px] right-0 whitespace-nowrap rounded-t px-1.5 text-[11px] font-semibold leading-[18px] text-white" style={{ background: o.color }}>
                    {o.who}
                  </span>
                </div>
              );
            })}
            {band && <div className="pointer-events-none absolute border border-accent bg-accent/10" style={{ left: band.x * perInch, top: band.y * perInch, width: band.w * perInch, height: band.h * perInch }} />}
            {one && outer && editing !== one.name && (
              <>
                {(["nw", "ne", "sw", "se"] as const).map((m) => (
                  <span
                    key={m}
                    role="presentation"
                    aria-label={`resize ${one.name} ${m}`}
                    className={cn(handle, m === "nw" || m === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize")}
                    style={{ left: (m.includes("w") ? outer.x : outer.x + outer.w) * perInch - 5, top: (m.includes("n") ? outer.y : outer.y + outer.h) * perInch - 5 }}
                    onPointerDown={(e) => startDrag(e, one, m)}
                  />
                ))}
                <span
                  role="presentation"
                  aria-label={`rotate ${one.name}`}
                  title="rotate (snaps to 15°; ⌥ for free)"
                  className="absolute grid size-4 cursor-grab place-items-center rounded-full border-2 border-accent bg-white"
                  style={{ left: (outer.x + outer.w / 2) * perInch - 8, top: (outer.y + outer.h) * perInch + 10 }}
                  onPointerDown={(e) => startDrag(e, one, "rotate")}
                >
                  <Icon name="rotate_right" className="text-[11px] leading-none text-accent" />
                </span>
              </>
            )}
          </SlideCanvas>
        )}
        {one && outer && !Object.keys(live).length && !menu && (
          <FormatBar
            s={one}
            editing={editing === one.name}
            theme={theme}
            style={{ left: Math.max(0, Math.min(outer.x * perInch, width - 640)), top: outer.y * perInch - 42 }}
            onPatch={(patch) => p.onPatches({ [one.name]: patch })}
            onReset={one.changed ? () => p.onPatches({ [one.name]: null }) : undefined}
            onEdit={() => open(one)}
            onRemove={() => p.onRemove([one.name])}
            onDuplicate={() => p.onDuplicate([one.name])}
            onAsk={(quick) => p.onAsk(one.name, quick)}
            onFormat={p.onFormat}
          />
        )}
        {sel.length > 1 && groupBox && !Object.keys(live).length && !menu && (
          <div role="toolbar" aria-label="selection" className="absolute z-30 flex items-center gap-0.5 rounded-lg border border-line bg-surface px-1 py-0.5 text-xs shadow-[var(--elev-pop)]" style={{ left: Math.max(0, groupBox.x * perInch), top: groupBox.y * perInch - 42 }} onPointerDown={(e) => e.stopPropagation()}>
            <span className="px-1.5 font-semibold">{sel.length} boxes</span>
            {(["left", "center", "right", "top", "middle", "bottom"] as const).map((a) => (
              <button key={a} type="button" className={BAR_BTN} aria-label={`align ${a}`} title={`align ${a}`} onClick={() => alignAll(a)}>
                <Icon name={a === "left" ? "align_horizontal_left" : a === "center" ? "align_horizontal_center" : a === "right" ? "align_horizontal_right" : a === "top" ? "align_vertical_top" : a === "middle" ? "align_vertical_center" : "align_vertical_bottom"} className="ms-sm" />
              </button>
            ))}
            <span className="mx-0.5 h-4 w-px bg-line" />
            <button type="button" className={BAR_BTN} aria-label="duplicate" title="duplicate (⌘D)" onClick={() => p.onDuplicate(sel.map((s) => s.name))}>
              <Icon name="content_copy" className="ms-sm" />
            </button>
            <button type="button" className={BAR_BTN} aria-label="remove boxes" title="remove (Delete)" onClick={() => p.onRemove(sel.map((s) => s.name))}>
              <Icon name="delete" className="ms-sm" />
            </button>
          </div>
        )}
        {menu && (
          <Menu label="box" onClose={() => setMenu(null)} className="absolute w-[240px]" style={{ left: Math.min(menu.x, width - 240), top: Math.max(0, Math.min(menu.y, width * (h / STAGE_W) - 360)) }}>
            {(() => {
              const names = sel.map((s) => s.name);
              const run = (f: () => void) => () => {
                f();
                setMenu(null);
              };
              return (
                <>
                  <MenuItem icon="content_copy" title="Copy" keys="⌘C" onClick={run(() => p.onCopy(names))} />
                  <MenuItem icon="content_paste" title="Paste" keys="⌘V" disabled={!p.canPaste} onClick={run(p.onPaste)} />
                  <MenuItem icon="library_add" title="Duplicate" keys="⌘D" onClick={run(() => p.onDuplicate(names))} />
                  <MenuSep />
                  <MenuItem icon="flip_to_front" title="Bring to front" onClick={run(() => layers("front"))} />
                  <MenuItem icon="arrow_upward" title="Bring forward" onClick={run(() => layers("forward"))} />
                  <MenuItem icon="arrow_downward" title="Send backward" onClick={run(() => layers("backward"))} />
                  <MenuItem icon="flip_to_back" title="Send to back" onClick={run(() => layers("back"))} />
                  <MenuSep />
                  <MenuItem icon="auto_awesome" title="Ask an agent about this…" onClick={run(() => p.onAsk(menu.slot))} />
                  {p.onComments && <MenuItem icon="add_comment" title="Comment…" onClick={run(() => p.onComments!(menu.slot))} />}
                  <MenuItem icon="tune" title="Format…" onClick={run(p.onFormat)} />
                  <MenuSep />
                  <MenuItem icon="delete" title="Delete" keys="⌫" danger onClick={run(() => p.onRemove(names))} />
                </>
              );
            })()}
          </Menu>
        )}
      </div>
    </div>
  );
}

const BAR_BTN = "inline-grid size-7 place-items-center rounded-md text-fg-2 hover:bg-surface-2 hover:text-fg";

/** The bar over the selected box: how its text looks; while typing, bold, italic and lists. */
function FormatBar({ s, editing, theme, style, onPatch, onReset, onEdit, onRemove, onDuplicate, onAsk, onFormat }: { s: SlotView; editing: boolean; theme: StageTemplate; style: CSSProperties; onPatch: (p: SlotPatch) => void; onReset?: () => void; onEdit: () => void; onRemove: () => void; onDuplicate: () => void; onAsk: (quick?: string) => void; onFormat: () => void }) {
  const [asking, setAsking] = useState(false);
  const textual = s.kind === "text" || s.kind === "markdown" || s.kind === "table" || s.kind === "html" || s.kind === "chart";
  const on = "bg-accent-soft text-on-accent-soft";
  const size = s.size ?? 18;
  const exec = (cmd: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.execCommand(cmd);
  };
  const swatches = Object.entries(theme.colors).filter(([n]) => !["surface", "line", "onAccent"].includes(n));
  return (
    <div role="toolbar" aria-label={`${s.name} format`} className="absolute z-30 flex items-center gap-0.5 whitespace-nowrap rounded-lg border border-line bg-surface px-1 py-0.5 text-xs text-fg shadow-[var(--elev-pop)]" style={style} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => editing && e.preventDefault()}>
      <span className="relative">
        <button type="button" className="flex h-7 items-center gap-1 rounded-md px-1.5 text-fg-2 hover:bg-surface-2 hover:text-fg" title="ask an agent to change this box" aria-label="ask an agent about this box" aria-haspopup="menu" aria-expanded={asking} onClick={() => setAsking((v) => !v)}>
          <Icon name="auto_awesome" className="ms-sm" />
          <span>ask</span>
          <Icon name="expand_more" className="ms-sm" />
        </button>
        {asking && (
          <Menu label="ask an agent" onClose={() => setAsking(false)} className="absolute left-0 top-[calc(100%+4px)] w-[240px]">
            {QUICK_ASKS.map((q) => (
              <MenuItem key={q.label} icon={q.icon} title={q.label} onClick={() => (setAsking(false), onAsk(q.text))} />
            ))}
            <MenuSep />
            <MenuItem icon="chat" title="Something else…" onClick={() => (setAsking(false), onAsk())} />
          </Menu>
        )}
      </span>
      <span className="mx-0.5 h-4 w-px bg-line" />
      {editing ? (
        <>
          <button type="button" className={BAR_BTN} aria-label="bold" title="bold (⌘B)" onMouseDown={exec("bold")}>
            <Icon name="format_bold" className="ms-sm" />
          </button>
          <button type="button" className={BAR_BTN} aria-label="italic" title="italic (⌘I)" onMouseDown={exec("italic")}>
            <Icon name="format_italic" className="ms-sm" />
          </button>
          {s.kind !== "text" && (
            <>
              <button type="button" className={BAR_BTN} aria-label="bulleted list" title="bulleted list" onMouseDown={exec("insertUnorderedList")}>
                <Icon name="format_list_bulleted" className="ms-sm" />
              </button>
              <button type="button" className={BAR_BTN} aria-label="numbered list" title="numbered list" onMouseDown={exec("insertOrderedList")}>
                <Icon name="format_list_numbered" className="ms-sm" />
              </button>
            </>
          )}
          <span className="px-1 text-fg-2">⌘↩ done · esc drop</span>
        </>
      ) : (
        <>
          <button type="button" className={BAR_BTN} title={s.kind === "image" ? "choose a picture" : sourceKind(s) ? "edit the source" : "edit the text (double click)"} aria-label="edit" onClick={onEdit}>
            <Icon name={s.kind === "image" ? "image" : sourceKind(s) ? "code" : "edit"} className="ms-sm" />
          </button>
          {textual && (
            <>
              <select
                aria-label="font"
                className="h-7 max-w-[118px] cursor-pointer rounded-md border-0 bg-transparent px-1 text-xs text-fg outline-none hover:bg-surface-2"
                value={s.font ?? "body"}
                onChange={(e) => onPatch({ font: e.target.value === "body" ? undefined : e.target.value })}
              >
                <option value="body">{theme.fonts.body} (body)</option>
                <option value="heading">{theme.fonts.heading} (heading)</option>
                {FONT_CHOICES.filter((f) => f !== theme.fonts.body && f !== theme.fonts.heading).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <button type="button" className={BAR_BTN} aria-label="smaller" title="smaller" onClick={() => onPatch({ size: Math.max(6, size - (size > 24 ? 4 : 1)) })}>
                <Icon name="text_decrease" className="ms-sm" />
              </button>
              <span className="min-w-[2.6rem] text-center tabular-nums" aria-label="font size">
                {size} pt
              </span>
              <button type="button" className={BAR_BTN} aria-label="larger" title="larger" onClick={() => onPatch({ size: Math.min(160, size + (size >= 24 ? 4 : 1)) })}>
                <Icon name="text_increase" className="ms-sm" />
              </button>
              <button type="button" className={cn(BAR_BTN, s.bold && on)} aria-label="bold" aria-pressed={!!s.bold} title="bold" onClick={() => onPatch({ bold: !s.bold })}>
                <Icon name="format_bold" className="ms-sm" />
              </button>
              <button type="button" className={cn(BAR_BTN, s.italic && on)} aria-label="italic" aria-pressed={!!s.italic} title="italic" onClick={() => onPatch({ italic: !s.italic })}>
                <Icon name="format_italic" className="ms-sm" />
              </button>
              {(["left", "center", "right"] as const).map((a) => (
                <button key={a} type="button" className={cn(BAR_BTN, (s.align ?? "left") === a && on)} aria-label={`align ${a}`} aria-pressed={(s.align ?? "left") === a} title={`align ${a}`} onClick={() => onPatch({ align: a })}>
                  <Icon name={`format_align_${a}`} className="ms-sm" />
                </button>
              ))}
              <span className="mx-0.5 h-4 w-px bg-line" />
              {swatches.slice(0, 5).map(([n, hex]) => (
                <button key={n} type="button" aria-label={`color ${n}`} title={n} aria-pressed={(s.color ?? "text") === n} className={cn("mx-0.5 size-4 rounded-full border", (s.color ?? "text") === n ? "border-accent ring-2 ring-accent/40" : "border-line-strong")} style={{ background: hex }} onClick={() => onPatch({ color: n })} />
              ))}
            </>
          )}
          <span className="mx-0.5 h-4 w-px bg-line" />
          <button type="button" className={BAR_BTN} aria-label="format" title="everything about this box" onClick={onFormat}>
            <Icon name="tune" className="ms-sm" />
          </button>
          <button type="button" className={BAR_BTN} aria-label="duplicate" title="duplicate (⌘D)" onClick={onDuplicate}>
            <Icon name="content_copy" className="ms-sm" />
          </button>
          {onReset && (
            <button type="button" className={BAR_BTN} aria-label="back to the layout" title="back to the layout's position and look" onClick={onReset}>
              <Icon name="restart_alt" className="ms-sm" />
            </button>
          )}
          <button type="button" className={BAR_BTN} aria-label={s.own ? "remove box" : "clear"} title={s.own ? "remove this box (Delete)" : "clear this slot (Delete)"} onClick={onRemove}>
            <Icon name="delete" className="ms-sm" />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A slot being typed into where it stands: the slide's own fonts, sizes,
 * colors and list markers, because it is the slide. ⌘B, ⌘I as anywhere;
 * ⌘↩ or a click elsewhere keeps it (Enter too in a one-line slot),
 * Escape drops it. Markdown in, markdown out.
 */
function RichEdit({ s, onCommit, onCancel }: { s: SlotView; onCommit: (md: string) => void; onCancel: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const inline = s.kind === "text";
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    node.innerHTML = s.html ? clean(s.html) : inline ? "" : "<p><br></p>";
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Mounted once per edit: the text is the editor's from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    if (keep && el.current) onCommit(htmlToMd(el.current, inline));
    else onCancel();
  };
  return (
    <div
      ref={el}
      role="textbox"
      aria-label={`${s.name} on the slide`}
      aria-multiline={!inline}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      className="deck-content cursor-text select-text"
      style={{ outline: "none", minHeight: "1.2em" }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onPaste={(e) => {
        // Plain text only: what is pasted takes the slide's look, not the source's.
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey || inline)) {
          e.preventDefault();
          finish(true);
        }
      }}
    />
  );
}

/* ---------- the format panel ---------- */

const num = (v: string): number | undefined => (v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

function NumberField({ label, value, step = 0.05, min, max, onChange }: { label: string; value: number | undefined; step?: number; min?: number; max?: number; onChange: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-line bg-bg px-1.5">
      <span className="text-[11px] text-fg-2">{label}</span>
      <input
        aria-label={label}
        type="number"
        value={text}
        step={step}
        min={min}
        max={max}
        className="h-7 w-full min-w-0 border-0 bg-transparent text-xs tabular-nums text-fg outline-none"
        onChange={(e) => {
          setText(e.target.value);
          const n = num(e.target.value);
          if (n !== undefined || e.target.value === "") onChange(n);
        }}
      />
    </label>
  );
}

function Swatches({ label, theme, value, allowNone, onChange }: { label: string; theme: StageTemplate; value?: string; allowNone?: boolean; onChange: (v: string | undefined) => void }) {
  const custom = value && /^#/.test(value) ? value : undefined;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {allowNone && (
        <button type="button" aria-label={`${label} none`} title="none" aria-pressed={!value} className={cn("grid size-5 place-items-center rounded-full border text-fg-2", !value ? "border-accent ring-2 ring-accent/40" : "border-line-strong")} onClick={() => onChange(undefined)}>
          <Icon name="block" className="text-[13px]" />
        </button>
      )}
      {Object.entries(theme.colors).map(([n, hex]) => (
        <button key={n} type="button" aria-label={`${label} ${n}`} title={n} aria-pressed={value === n} className={cn("size-5 rounded-full border", value === n ? "border-accent ring-2 ring-accent/40" : "border-line-strong")} style={{ background: hex }} onClick={() => onChange(n)} />
      ))}
      <label className={cn("relative grid size-5 cursor-pointer place-items-center overflow-hidden rounded-full border", custom ? "border-accent ring-2 ring-accent/40" : "border-line-strong")} title="custom color" style={{ background: custom ?? "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
        <input type="color" aria-label={`${label} custom`} className="absolute inset-0 cursor-pointer opacity-0" value={custom ?? "#888888"} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      </label>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex flex-col gap-1.5 border-t border-line pt-2.5 first:border-t-0 first:pt-0">
    <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-2">{title}</div>
    {children}
  </div>
);

/**
 * Everything a box can be (position, rotation, type, colors, fill, corners,
 * border, shadow, opacity, layer, how a picture fits) — or, with nothing
 * selected, the slide: its background (a color or a picture), whether it
 * is shown. Changes land as the slide's own settings.
 */
export function FormatPanel({
  theme,
  slide,
  view,
  selected,
  assets,
  onPatches,
  onSlide,
  numbers,
  onNumbers,
  onUpload,
  onClose,
}: {
  theme: StageTemplate;
  slide: SlideDef;
  view: SlideView;
  selected: string[];
  assets: string[];
  onPatches: (changes: Record<string, SlotPatch | null>, mark?: string) => void;
  onSlide: (patch: Partial<SlideDef>) => void;
  /** The deck's slide numbers: on unless its headmatter says `numbers: false`. */
  numbers: boolean;
  onNumbers: (on: boolean) => void;
  onUpload: (f: File) => Promise<string | null>;
  onClose: () => void;
}) {
  const sel = view.slots.filter((s) => selected.includes(s.name));
  const one = sel.length === 1 ? sel[0] : null;
  const set = (patch: SlotPatch, mark?: string) => onPatches(Object.fromEntries(sel.map((s) => [s.name, patch])), mark);
  const canvasW = STAGE_W / PPI;
  const canvasH = stageHeight(theme.size) / PPI;
  const btn = "inline-grid h-7 min-w-7 place-items-center rounded-md border border-line px-1 text-fg-2 hover:bg-surface-2 hover:text-fg";
  const on = "border-accent bg-accent-soft text-on-accent-soft";
  const pick = useRef<HTMLInputElement>(null);
  const bgIsPicture = !!slide.background && /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(slide.background);
  return (
    <div className="sticky top-3 flex max-h-[calc(100vh-130px)] flex-col gap-3 overflow-auto rounded-xl border border-line bg-surface p-3 text-sm" role="region" aria-label="format">
      <div className="flex items-center gap-2">
        <Icon name="tune" className="ms-sm text-fg-2" />
        <span className="font-semibold">{one ? one.name : sel.length > 1 ? `${sel.length} boxes` : "Slide"}</span>
        <span className="flex-1" />
        <button type="button" className={BAR_BTN} aria-label="close format" onClick={onClose}>
          <Icon name="close" className="ms-sm" />
        </button>
      </div>
      {sel.length === 0 ? (
        <>
          <Section title="Background">
            <Swatches label="background" theme={theme} value={bgIsPicture ? undefined : slide.background} allowNone onChange={(v) => onSlide({ background: v })} />
            <div className="flex flex-wrap items-center gap-1.5">
              <select aria-label="background picture" className="h-7 min-w-0 flex-1 rounded-md border border-line bg-bg px-1 text-xs text-fg" value={bgIsPicture ? slide.background : ""} onChange={(e) => onSlide({ background: e.target.value || undefined })}>
                <option value="">no picture</option>
                {assets.map((a) => (
                  <option key={a} value={a}>
                    {a.replace(/^assets\//, "")}
                  </option>
                ))}
              </select>
              <button type="button" className={btn} title="upload a picture as background" onClick={() => pick.current?.click()}>
                <Icon name="upload" className="ms-sm" />
              </button>
              <input
                ref={pick}
                type="file"
                accept="image/png,image/jpeg,image/gif"
                className="hidden"
                aria-label="background picture file"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const path = await onUpload(f);
                  if (path) onSlide({ background: path });
                }}
              />
            </div>
          </Section>
          <Section title="Slide">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                aria-label="hide slide"
                checked={slide.extra?.hidden === true}
                onChange={(e) => {
                  const extra = { ...slide.extra };
                  if (e.target.checked) extra.hidden = true;
                  else delete extra.hidden;
                  onSlide({ extra });
                }}
              />
              hidden — kept in the deck, left out of present mode and the exports
            </label>
            {/* Slide numbers like an Insert › slide numbers dialog: the deck's switch, then this slide's. The theme draws them (title and section slides usually go without). */}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" aria-label="slide numbers" checked={numbers} onChange={(e) => onNumbers(e.target.checked)} />
              slide numbers — on every slide of the deck
            </label>
            <label className={cn("flex items-center gap-2 text-xs", !numbers && "opacity-50")}>
              <input
                type="checkbox"
                aria-label="number on this slide"
                disabled={!numbers}
                checked={numbers && slide.extra?.number !== false}
                onChange={(e) => {
                  const extra = { ...slide.extra };
                  if (e.target.checked) delete extra.number;
                  else extra.number = false;
                  onSlide({ extra });
                }}
              />
              number on this slide
            </label>
            <label className="flex items-center gap-2 text-xs">
              <span className="w-[70px] text-fg-2">transition</span>
              <select aria-label="transition" className="h-7 min-w-0 flex-1 rounded-md border border-line bg-bg px-1 text-xs text-fg" value={slide.transition ?? ""} onChange={(e) => onSlide({ transition: e.target.value || undefined })}>
                <option value="">fade (default)</option>
                <option value="slide">slide in</option>
                <option value="zoom">zoom in</option>
                <option value="none">none (cut)</option>
              </select>
            </label>
          </Section>
          <span className="text-xs text-fg-2">Select a box on the slide (⇧ or a frame for several) to format it.</span>
        </>
      ) : (
        <>
          {one && (
            <Section title="Position">
              <div className="flex gap-1">
                <NumberField label="x" value={one.x} onChange={(v) => v !== undefined && set({ x: v }, "pos")} />
                <NumberField label="y" value={one.y} onChange={(v) => v !== undefined && set({ y: v }, "pos")} />
              </div>
              <div className="flex gap-1">
                <NumberField label="w" value={one.w} min={0.1} onChange={(v) => v && set({ w: v }, "pos")} />
                <NumberField label="h" value={one.h} min={0.1} onChange={(v) => v && set({ h: v }, "pos")} />
                <NumberField label="°" value={one.rotate ?? 0} step={1} onChange={(v) => set({ rotate: v || undefined }, "rot")} />
              </div>
              <div className="flex gap-1" role="group" aria-label="align to slide">
                {(
                  [
                    ["left", "align_horizontal_left", { x: 0 }],
                    ["center", "align_horizontal_center", { x: round(canvasW / 2 - one.w / 2) }],
                    ["right", "align_horizontal_right", { x: round(canvasW - one.w) }],
                    ["top", "align_vertical_top", { y: 0 }],
                    ["middle", "align_vertical_center", { y: round(canvasH / 2 - one.h / 2) }],
                    ["bottom", "align_vertical_bottom", { y: round(canvasH - one.h) }],
                  ] as const
                ).map(([n, icon, patch]) => (
                  <button key={n} type="button" className={btn} aria-label={`to slide ${n}`} title={`to the slide's ${n}`} onClick={() => set(patch)}>
                    <Icon name={icon} className="ms-sm" />
                  </button>
                ))}
              </div>
            </Section>
          )}
          {sel.some((s) => s.kind !== "image" && s.kind !== "embed") && (
            <Section title="Type">
              <select aria-label="font family" className="h-7 rounded-md border border-line bg-bg px-1 text-xs text-fg" value={one?.font ?? "body"} onChange={(e) => set({ font: e.target.value === "body" ? undefined : e.target.value })}>
                <option value="body">{theme.fonts.body} (body)</option>
                <option value="heading">{theme.fonts.heading} (heading)</option>
                {FONT_CHOICES.filter((f) => f !== theme.fonts.body && f !== theme.fonts.heading).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap items-center gap-1">
                <NumberField label="pt" value={one?.size ?? 18} step={1} min={4} onChange={(v) => v && set({ size: v }, "size")} />
                <button type="button" className={cn(btn, one?.bold && on)} aria-label="bold" aria-pressed={!!one?.bold} onClick={() => set({ bold: !one?.bold || undefined })}>
                  <Icon name="format_bold" className="ms-sm" />
                </button>
                <button type="button" className={cn(btn, one?.italic && on)} aria-label="italic" aria-pressed={!!one?.italic} onClick={() => set({ italic: !one?.italic || undefined })}>
                  <Icon name="format_italic" className="ms-sm" />
                </button>
                <button type="button" className={cn(btn, one?.underline && on)} aria-label="underline" aria-pressed={!!one?.underline} onClick={() => set({ underline: !one?.underline || undefined })}>
                  <Icon name="format_underlined" className="ms-sm" />
                </button>
                <button type="button" className={cn(btn, one?.strike && on)} aria-label="strikethrough" aria-pressed={!!one?.strike} onClick={() => set({ strike: !one?.strike || undefined })}>
                  <Icon name="strikethrough_s" className="ms-sm" />
                </button>
              </div>
              <div className="flex gap-1">
                {(["left", "center", "right"] as const).map((a) => (
                  <button key={a} type="button" className={cn(btn, (one?.align ?? "left") === a && on)} aria-label={`text ${a}`} onClick={() => set({ align: a })}>
                    <Icon name={`format_align_${a}`} className="ms-sm" />
                  </button>
                ))}
                <span className="w-2" />
                {(["top", "middle", "bottom"] as const).map((a) => (
                  <button key={a} type="button" className={cn(btn, (one?.valign ?? "top") === a && on)} aria-label={`text ${a}`} onClick={() => set({ valign: a })}>
                    <Icon name={a === "top" ? "vertical_align_top" : a === "middle" ? "vertical_align_center" : "vertical_align_bottom"} className="ms-sm" />
                  </button>
                ))}
              </div>
              <span className="text-xs text-fg-2">Text color</span>
              <Swatches label="text color" theme={theme} value={one?.color} onChange={(v) => set({ color: v })} />
            </Section>
          )}
          <Section title="Box">
            <span className="text-xs text-fg-2">Fill</span>
            <Swatches label="fill" theme={theme} value={one?.fill} allowNone onChange={(v) => set({ fill: v })} />
            <div className="flex gap-1">
              <NumberField label="corners" value={one?.radius} step={1} min={0} onChange={(v) => set({ radius: v || undefined }, "radius")} />
              <NumberField label="border" value={one?.border} step={0.5} min={0} onChange={(v) => set({ border: v || undefined }, "border")} />
            </div>
            {!!one?.border && (
              <>
                <span className="text-xs text-fg-2">Border color</span>
                <Swatches label="border color" theme={theme} value={one?.borderColor} onChange={(v) => set({ borderColor: v })} />
              </>
            )}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" aria-label="shadow" checked={!!one?.shadow} onChange={(e) => set({ shadow: e.target.checked || undefined })} />
              shadow
            </label>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-fg-2">opacity</span>
              <input type="range" aria-label="opacity" min={0.1} max={1} step={0.05} value={one?.opacity ?? 1} className="flex-1" onChange={(e) => set({ opacity: Number(e.target.value) >= 1 ? undefined : Number(e.target.value) }, "opacity")} />
              <span className="w-9 text-right tabular-nums">{Math.round((one?.opacity ?? 1) * 100)}%</span>
            </label>
            {sel.some((s) => s.kind === "image") && (
              <label className="flex items-center gap-2 text-xs">
                <span className="text-fg-2">picture</span>
                <select aria-label="picture fit" className="h-7 rounded-md border border-line bg-bg px-1 text-xs text-fg" value={one?.fit ?? "contain"} onChange={(e) => set({ fit: e.target.value === "cover" ? "cover" : undefined })}>
                  <option value="contain">fits inside the box</option>
                  <option value="cover">fills the box (cropped)</option>
                </select>
              </label>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/** The source of a slot that is not typed on the slide (HTML, chart data, an embed, markdown with HTML), beside it; the slide follows as you type. */
/**
 * A chart's data as a grid, like ChatGPT's chart editor: kind and title,
 * a row per category, a column per series; every change writes the chart
 * block back (`chartSource`), so the slide follows as you type.
 */
function ChartGrid({ data, fenced, onChange }: { data: ChartData; fenced: boolean; onChange: (md: string) => void }) {
  const [c, setC] = useState<ChartData>(data);
  const put = (next: ChartData) => {
    setC(next);
    onChange(chartSource(next, fenced));
  };
  const cell = "h-7 w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 text-xs text-fg outline-none hover:border-line focus:border-accent";
  const setValue = (j: number, i: number, raw: string) => {
    const v = Number(raw.replace(",", "."));
    if (raw.trim() === "" || Number.isNaN(v)) return;
    put({ ...c, series: c.series.map((x, k) => (k === j ? { ...x, values: x.values.map((y, n) => (n === i ? v : y)) } : x)) });
  };
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="chart data">
      <div className="flex gap-2">
        <select value={c.kind} aria-label="chart kind" className="h-8 rounded-md border border-line bg-bg px-1.5 text-xs text-fg" onChange={(e) => put({ ...c, kind: e.target.value as ChartData["kind"] })}>
          {CHART_KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input value={c.title ?? ""} aria-label="chart title" placeholder="title" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-xs text-fg outline-none focus:border-accent" onChange={(e) => put({ ...c, title: e.target.value || undefined })} />
      </div>
      <div className="max-h-[360px] overflow-auto rounded-md border border-line">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-surface-2">
              <th className="w-[34%] p-0.5" />
              {c.series.map((x, j) => (
                <th key={j} className="p-0.5">
                  <div className="flex items-center">
                    <input value={x.name} aria-label={`series ${j + 1} name`} className={cn(cell, "font-semibold")} onChange={(e) => put({ ...c, series: c.series.map((y, k) => (k === j ? { ...y, name: e.target.value } : y)) })} />
                    {c.series.length > 1 && (
                      <button type="button" className="text-fg-2 hover:text-bad" aria-label={`remove series ${j + 1}`} onClick={() => put({ ...c, series: c.series.filter((_, k) => k !== j) })}>
                        <Icon name="close" className="ms-sm" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-7 p-0.5">
                <button type="button" className="text-fg-2 hover:text-fg" aria-label="add series" onClick={() => put({ ...c, series: [...c.series, { name: `Series ${c.series.length + 1}`, values: c.categories.map(() => 0) }] })}>
                  <Icon name="add" className="ms-sm" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {c.categories.map((cat, i) => (
              <tr key={i} className="border-t border-line">
                <td className="p-0.5">
                  <input value={cat} aria-label={`category ${i + 1}`} className={cell} onChange={(e) => put({ ...c, categories: c.categories.map((y, n) => (n === i ? e.target.value : y)) })} />
                </td>
                {c.series.map((x, j) => (
                  <td key={j} className="p-0.5">
                    <input defaultValue={String(x.values[i])} inputMode="decimal" aria-label={`${x.name || `series ${j + 1}`} · ${cat || `row ${i + 1}`}`} className={cn(cell, "text-right tabular-nums")} onChange={(e) => setValue(j, i, e.target.value)} />
                  </td>
                ))}
                <td className="p-0.5 text-center">
                  {c.categories.length > 1 && (
                    <button type="button" className="text-fg-2 hover:text-bad" aria-label={`remove row ${i + 1}`} onClick={() => put({ ...c, categories: c.categories.filter((_, n) => n !== i), series: c.series.map((x) => ({ ...x, values: x.values.filter((_, n) => n !== i) })) })}>
                      <Icon name="close" className="ms-sm" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="flex w-fit items-center gap-1 text-xs text-fg-2 hover:text-fg" aria-label="add row" onClick={() => put({ ...c, categories: [...c.categories, `Item ${c.categories.length + 1}`], series: c.series.map((x) => ({ ...x, values: [...x.values, 0] })) })}>
        <Icon name="add" className="ms-sm" />
        row
      </button>
    </div>
  );
}

export function SourcePanel({ s, onChange, onClose }: { s: SlotView; onChange: (md: string) => void; onClose: () => void }) {
  const [text, setText] = useState(s.md ?? "");
  const parse = (): ChartData | null => {
    if (s.kind !== "chart") return null;
    try {
      return parseChart(s.md ?? "");
    } catch {
      return null;
    }
  };
  const [mode, setMode] = useState<"data" | "source">(() => (parse() ? "data" : "source"));
  // Read again on each switch to "data": the source may have changed meanwhile (a source that does not parse stays in source).
  const chart = useMemo(parse, [s.kind, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const what = s.kind === "chart" ? "chart data (YAML)" : s.kind === "embed" ? "embed: a URL, or a whole page (scripts run, sandboxed)" : s.kind === "html" ? "HTML" : "markdown (with HTML)";
  return (
    <div className="sticky top-3 flex flex-col gap-2 rounded-xl border border-line bg-surface p-3" role="region" aria-label={`${s.name} source`}>
      <div className="flex items-center gap-2">
        <Icon name={s.kind === "chart" ? "bar_chart" : s.kind === "embed" ? "public" : "code"} className="ms-sm text-fg-2" />
        <span className="text-sm font-semibold">{s.name}</span>
        <span className="text-xs text-fg-2">{what}</span>
        <span className="flex-1" />
        {s.kind === "chart" && (
          <div className="flex rounded-md border border-line p-0.5 text-xs" role="tablist" aria-label="chart editor">
            {(["data", "source"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={cn("rounded px-2 py-0.5", mode === m ? "bg-surface-2 text-fg" : "text-fg-2")} onClick={() => (m === "source" && setText(s.md ?? ""), setMode(m))}>
                {m}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={BAR_BTN} aria-label="close source" onClick={onClose}>
          <Icon name="close" className="ms-sm" />
        </button>
      </div>
      {chart && mode === "data" ? (
        <ChartGrid data={chart} fenced={/^\s*```/.test(s.md ?? "")} onChange={(md) => (setText(md), onChange(md))} />
      ) : (
      <textarea
        value={text}
        aria-label={`${s.name} source text`}
        spellCheck={false}
        autoFocus
        className="min-h-[340px] resize-y rounded-md border border-line bg-bg p-2 font-mono text-[12.5px] leading-5 text-fg outline-none focus:border-accent"
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            e.preventDefault();
            const t = e.currentTarget;
            const at = t.selectionStart;
            const next = `${text.slice(0, at)}  ${text.slice(t.selectionEnd)}`;
            setText(next);
            onChange(next);
            requestAnimationFrame(() => t.setSelectionRange(at + 2, at + 2));
          }
        }}
      />
      )}
      {s.error && <span className="text-xs text-bad">{s.error}</span>}
      <span className="text-xs text-fg-2">{s.kind === "chart" ? "kind: column, bar, line, area, pie or doughnut · categories · series with name and values" : s.kind === "html" ? "Use the theme's classes (cards, kpis, flow, timeline, callout, compare, cols) or inline styles; SVG works." : s.kind === "embed" ? "A page of your own runs in a sandbox: no access to kraftwerk." : "Markdown and HTML mixed."}</span>
    </div>
  );
}
