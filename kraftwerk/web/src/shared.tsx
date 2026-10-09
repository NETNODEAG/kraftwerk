import { createContext, useContext, useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
// cn straight from its module: ui/ imports this file, the index would be a cycle.
import { cn } from "./ui/cn";
import { api, failure } from "./api";

/* ---------- icons ---------- */

/**
 * Material Symbols Rounded (self-hosted variable font, imported in
 * main.tsx). `name` is the symbol's ligature name, e.g. "edit",
 * "play_arrow". `fill` switches to the filled variant (M3 active state).
 */
export function Icon({ name, fill, className }: { name: string; fill?: boolean; className?: string }) {
  return (
    <span
      className={`ms material-symbols-rounded${fill ? " ms-fill" : ""}${name === "progress_activity" ? " ms-spin" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden
    >
      {name}
    </span>
  );
}

/* ---------- hash routing ---------- */

/** Current route path from the hash: "#/runs/x" → "/runs/x". */
export function useHashPath(): string {
  const [path, setPath] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const onChange = () => setPath(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}

/**
 * Browser-tab title: app.tsx owns the base ("<project> — kraftwerk"),
 * screens may prepend a page part ("<session> · <agent>") while mounted.
 */
let baseTitle = "kraftwerk inspector";
let pageTitle = "";
let attention = 0;
function applyTitle(): void {
  const t = pageTitle ? `${pageTitle} — ${baseTitle}` : baseTitle;
  // Unread bell items lead the title so a background tab shows "(2) …".
  document.title = attention > 0 ? `(${attention}) ${t}` : t;
}
/** Unread attention items (the bell) — shown as a "(n)" prefix in the tab title. */
export function setAttentionCount(n: number): void {
  if (n === attention) return;
  attention = n;
  applyTitle();
}
export function setBaseTitle(t: string): void {
  baseTitle = t;
  applyTitle();
}
export function setPageTitle(t: string): void {
  pageTitle = t;
  applyTitle();
}

/** Routes that are a conversation (the middle column); everything else is the workspace column. */
export const CHAT_ROUTES = new Set(["agents", "team", "chats", "projects", "channels"]);
export const columnOf = (path: string): "chat" | "side" => (CHAT_ROUTES.has(path.split("?")[0].split("/").filter(Boolean)[0] ?? "") ? "chat" : "side");

/** A column's screen resolved where it wants to be without touching the hash (see navigate). */
export const COLUMN_PATH_EVENT = "kw-column-path";

/** A conversation's edit or create route: rendered as a modal over the columns, not in them (edit-modal.tsx). */
export function isEditPath(path: string): boolean {
  const seg = path.split("/").filter(Boolean);
  const slug = seg[1] ? decodeURIComponent(seg[1]) : "";
  if (!slug || slug === "chats") return false;
  if (slug === "new") return ["projects", "agents", "team", "channels"].includes(seg[0]) && !seg[2];
  if (seg[0] === "projects") return seg[2] === "info";
  if (seg[0] === "agents" || seg[0] === "team") return seg[2] === "info" || seg[2] === "edit";
  if (seg[0] === "channels") return seg[2] === "edit";
  return false;
}

export function navigate(to: string, opts?: { replace?: boolean }): void {
  // Two columns share one hash. A screen that redirects on landing (a bare
  // #/runs to the latest run, a bare #/agents/chats to the latest chat) may
  // be the column the hash is not about — another column, or the
  // conversation under an edit modal: then the hash stays, and the column
  // alone follows the redirect.
  const at = window.location.hash.slice(1) || "/";
  if (opts?.replace && (columnOf(to) !== columnOf(at) || (isEditPath(at) && !isEditPath(to) && columnOf(to) === "chat"))) {
    window.dispatchEvent(new CustomEvent(COLUMN_PATH_EVENT, { detail: to }));
    return;
  }
  if (opts?.replace) window.location.replace(`#${to}`);
  else window.location.hash = to;
}

/**
 * Ask this instance to spawn `kraftwerk ui` for a stopped workspace and
 * resolve with its URL once the new inspector answers. The target is
 * another origin (no CORS), so our own server does the probing and reports
 * the entry live through /api/meta.
 */
export async function startWorkspace(root: string): Promise<string> {
  const r = await api.request("workspaces.start", { body: { root } });
  if (!r.ok) throw new Error(failure(r));
  const d = r.data;
  if (d.live && d.url) return d.url;
  for (let i = 0; i < 12; i++) {
    await new Promise((res) => setTimeout(res, 1_000));
    try {
      const m = await api.call("meta.get");
      // Manual entries carry no root or live flag; only discovered ones match.
      const hit = (m.switcher as { root?: string; live?: boolean; url: string }[]).find((e) => e.root === root && e.live);
      if (hit) return hit.url;
    } catch {}
  }
  throw new Error("started, but the UI did not answer yet — see ~/.kraftwerk/logs");
}

/**
 * A screen embedded somewhere other than its route (the context column shows
 * a bundle, a workflow, a vibeable) hands its links to the host: the handler
 * gets the href and answers true when it took it — the hash then stays and
 * the host re-renders the screen at that path. Links it declines (a run's
 * page, the editor) still go to the hash as usual.
 */
export const LocalNav = createContext<((href: string) => boolean) | null>(null);

export function Link({
  href,
  onClick,
  ...rest
}: { href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const local = useContext(LocalNav);
  return (
    <a
      href={`#${href}`}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !local) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // a new tab still gets the real route
        if (local(href)) e.preventDefault();
      }}
      {...rest}
    />
  );
}

/* ---------- expert mode ---------- */

// Expert mode = the full view (tool activity, harness names, paths).
// Off = radically simplified UI for non-technical use. Persisted per
// browser; also mirrored to <html data-expert> so CSS can hide chrome.
const EXPERT_KEY = "kw-expert";
let expertOn = (() => {
  try {
    return localStorage.getItem(EXPERT_KEY) !== "off";
  } catch {
    return true;
  }
})();
const expertListeners = new Set<() => void>();
document.documentElement.dataset.expert = expertOn ? "on" : "off";

export function setExpertMode(on: boolean): void {
  expertOn = on;
  document.documentElement.dataset.expert = on ? "on" : "off";
  try {
    localStorage.setItem(EXPERT_KEY, on ? "on" : "off");
  } catch {}
  expertListeners.forEach((fn) => fn());
}

export function useExpertMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      expertListeners.add(cb);
      return () => expertListeners.delete(cb);
    },
    () => expertOn
  );
}

/* ---------- feature flags ---------- */

// Which optional features kraftwerk.yml turns on (git, repos, vibeables, projects).
// app.tsx sets them from /api/meta; screens read them to show or hide
// entry points, so a chat never offers a vibeable in a workspace without them.
export interface Features {
  git: boolean;
  repos: boolean;
  vibeables: boolean;
  projects: boolean;
}
let features: Features = { git: false, repos: false, vibeables: false, projects: false };
const featureListeners = new Set<() => void>();

export function setFeatures(next: Features): void {
  if (next.git === features.git && next.repos === features.repos && next.vibeables === features.vibeables && next.projects === features.projects) return;
  features = next;
  featureListeners.forEach((fn) => fn());
}

export function useFeatures(): Features {
  return useSyncExternalStore(
    (cb) => {
      featureListeners.add(cb);
      return () => featureListeners.delete(cb);
    },
    () => features
  );
}

/* ---------- workspace identity ---------- */

/** Stable 0–359 hue for a key (a root path or url): the same workspace gets the same colour everywhere. */
export function workspaceHue(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % 360;
}

/** The workspace accent: kraftwerk.yml `color`, else derived from the seed. */
export function workspaceColor(color: string | undefined, seed: string): string {
  return color || `hsl(${workspaceHue(seed)} 58% 46%)`;
}

type Rgb = [number, number, number];

/** "#rgb", "#rrggbb" or "hsl(h s% l%)" (what workspaceColor returns) → sRGB 0–255; null for anything else. */
function parseColor(c: string): Rgb | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((x) => x + x).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
  }
  const hsl = /^hsl\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%/i.exec(c.trim());
  if (!hsl) return null;
  const h = +hsl[1] / 360, sat = +hsl[2] / 100, l = +hsl[3] / 100;
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, pp = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return pp + (q - pp) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return pp + (q - pp) * (2 / 3 - t) * 6;
    return pp;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255)) as Rgb;
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as Rgb;
const hex = (c: Rgb) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Mix `c` toward `to` in small steps until it reads at `min` contrast against `on`. */
function settle(c: Rgb, on: Rgb, min: number, to: Rgb): Rgb {
  let out = c;
  for (let t = 0; t <= 1 && contrast(out, on) < min; t += 0.04) out = mix(c, to, t);
  return out;
}
const WHITE: Rgb = [255, 255, 255], BLACK: Rgb = [0, 0, 0];
const DARK_CARD: Rgb = [0x26, 0x25, 0x23];

/**
 * M3 primary and secondary-container roles for both schemes, derived from the
 * workspace colour so every button, toggle, selected state and focus ring
 * carries it. Each text/ground pair is pushed until it reads at 4.5:1, so a
 * pastel or a near-black workspace colour still produces usable buttons.
 * Keys are the CSS custom properties tokens.css reads under [data-ws-accent].
 */
export function wsPalette(color: string): Record<string, string> | null {
  const ws = parseColor(color);
  if (!ws) return null;
  const lp = settle(ws, WHITE, 4.5, BLACK);
  const lpc = mix(ws, WHITE, 0.84);
  const lsc = mix(ws, WHITE, 0.88);
  const dp = settle(mix(ws, WHITE, 0.4), DARK_CARD, 4.5, WHITE);
  const dpc = mix(ws, BLACK, 0.42);
  const dsc = mix(ws, BLACK, 0.6);
  return {
    "--wsp-l-primary": hex(lp),
    "--wsp-l-on-primary": hex(WHITE),
    "--wsp-l-primary-container": hex(lpc),
    "--wsp-l-on-primary-container": hex(settle(mix(ws, BLACK, 0.6), lpc, 4.5, BLACK)),
    "--wsp-l-secondary-container": hex(lsc),
    "--wsp-l-on-secondary-container": hex(settle(mix(ws, BLACK, 0.65), lsc, 4.5, BLACK)),
    "--wsp-d-primary": hex(dp),
    "--wsp-d-on-primary": hex(settle(mix(ws, BLACK, 0.7), dp, 4.5, BLACK)),
    "--wsp-d-primary-container": hex(dpc),
    "--wsp-d-on-primary-container": hex(settle(mix(ws, WHITE, 0.8), dpc, 4.5, WHITE)),
    "--wsp-d-secondary-container": hex(dsc),
    "--wsp-d-on-secondary-container": hex(settle(mix(ws, WHITE, 0.85), dsc, 4.5, WHITE)),
  };
}

/** "NETNODE Base Camp" → NB, "agent-playground" → AP, "Fireplace" → FI. */
export function monogram(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "?";
  const m = words.length >= 2 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return m.toUpperCase();
}

/**
 * The icon tile of a workspace: the emoji on a tinted square in the
 * workspace colour. No emoji → the monogram fills the tile; an emoji that
 * another listed workspace also uses gets the monogram as a corner badge
 * (`ambiguous`), so two ⚡ workspaces still tell apart at a glance.
 */
export function WorkspaceTile({
  icon,
  name,
  color,
  seed,
  ambiguous,
  size = "md",
  className,
}: {
  icon?: string;
  name: string;
  color?: string;
  seed: string;
  ambiguous?: boolean;
  /** sm: the 32px home link in the top bar; md: the 40px list avatar. */
  size?: "sm" | "md";
  className?: string;
}) {
  const style = { "--ws-c": workspaceColor(color, seed) } as CSSProperties;
  return (
    <span
      className={cn(
        "relative grid flex-none place-items-center rounded-full leading-none",
        "bg-[color-mix(in_srgb,var(--ws-c,var(--text))_22%,var(--surface-2))]",
        size === "sm" ? "size-8" : "size-10",
        icon
          ? size === "sm" ? "text-[18px]" : "text-[22px]"
          : cn("font-sans font-medium tracking-[0.15px] text-[var(--ws-c,var(--text))]", size === "sm" ? "text-[13px]" : "text-base"),
        className
      )}
      style={style}
      aria-hidden
    >
      {icon || monogram(name)}
      {icon && ambiguous && (
        <span className="absolute -right-[3px] -bottom-[3px] grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--ws-c,var(--text))] px-1 font-sans text-[10px] font-medium leading-none tracking-[0.4px] text-white shadow-[0_0_0_2px_var(--surface-1)]">
          {monogram(name)}
        </span>
      )}
    </span>
  );
}

/** Every project's own chat, shown as its first agent: what Ralv is to the workspace, the assistant is to one project. */
export const PROJECT_ASSISTANT = { emoji: "🧭", name: "Assistant" };


/* ---------- formatting ---------- */

export function fmtDuration(ms?: number): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, "0")}s`;
}

export function fmtCost(usd?: number): string {
  if (usd == null) return "—";
  return `$${usd.toFixed(2)}`;
}

export function fmtTokens(n?: number): string {
  if (!n) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} K`;
  return `${(n / 1024 / 1024).toFixed(1)} M`;
}

export function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = d.toTimeString().slice(0, 5);
  return sameDay ? hm : `${d.toISOString().slice(5, 10)} ${hm}`;
}

/** Relative recency ("just now", "5m ago", "3d ago"); older than a week falls back to the date. */
export function fmtAgo(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60e3) return "just now";
  const m = Math.floor(ms / 60e3);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toISOString().slice(5, 10);
}

/** Live elapsed time for a running phase/run. */
export function Elapsed({ since }: { since?: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  return <span className="tabular-nums">{fmtDuration(Date.now() - Date.parse(since))}</span>;
}

/** Reasoning effort a project or an agent can pin; "" is the harness default. */
export const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
