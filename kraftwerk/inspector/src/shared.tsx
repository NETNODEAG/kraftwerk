import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

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
function applyTitle(): void {
  document.title = pageTitle ? `${pageTitle} — ${baseTitle}` : baseTitle;
}
export function setBaseTitle(t: string): void {
  baseTitle = t;
  applyTitle();
}
export function setPageTitle(t: string): void {
  pageTitle = t;
  applyTitle();
}

export function navigate(to: string, opts?: { replace?: boolean }): void {
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
  const r = await fetch("/api/projects/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ root }),
  });
  const d = (await r.json()) as { ok?: boolean; live?: boolean; url?: string; error?: string };
  if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`);
  window.dispatchEvent(new Event("kw-meta-refresh"));
  if (d.live && d.url) return d.url;
  for (let i = 0; i < 12; i++) {
    await new Promise((res) => setTimeout(res, 1_000));
    try {
      const m = (await fetch("/api/meta", { cache: "no-store" }).then((r) => r.json())) as {
        switcher?: { root?: string; live?: boolean; url: string }[];
      };
      const hit = m.switcher?.find((e) => e.root === root && e.live);
      if (hit) return hit.url;
    } catch {}
  }
  throw new Error("started, but the UI did not answer yet — see ~/.kraftwerk/logs");
}

export function Link({
  href,
  ...rest
}: { href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return <a href={`#${href}`} {...rest} />;
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

// Which optional features kraftwerk.yml turns on (git, repos, vibeables).
// app.tsx sets them from /api/meta; screens read them to show or hide
// entry points, so a chat never offers a vibeable in a workspace without them.
export interface Features {
  git: boolean;
  repos: boolean;
  vibeables: boolean;
}
let features: Features = { git: false, repos: false, vibeables: false };
const featureListeners = new Set<() => void>();

export function setFeatures(next: Features): void {
  if (next.git === features.git && next.repos === features.repos && next.vibeables === features.vibeables) return;
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
 * (`ambiguous`), so two ⚡ projects still tell apart at a glance.
 */
export function WorkspaceTile({
  icon,
  name,
  color,
  seed,
  ambiguous,
  className,
}: {
  icon?: string;
  name: string;
  color?: string;
  seed: string;
  ambiguous?: boolean;
  className?: string;
}) {
  const style = { "--ws-c": workspaceColor(color, seed) } as CSSProperties;
  return (
    <span className={`ws-tile${icon ? "" : " ws-tile-mono"}${className ? ` ${className}` : ""}`} style={style} aria-hidden>
      {icon || monogram(name)}
      {icon && ambiguous && <span className="ws-tile-badge">{monogram(name)}</span>}
    </span>
  );
}

/* ---------- polling ---------- */

/** JSON POST; a non-2xx without an error body gets "HTTP <status>". */
export async function post<T extends object = {}>(
  url: string,
  body?: unknown
): Promise<T & { ok?: boolean; error?: string }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const d = (await r.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!r.ok && !d.error) d.error = `HTTP ${r.status}`;
  return d;
}

/** Poll a JSON endpoint; tightens the interval while `fast` (live run). */
export function usePoll<T>(url: string, fast: boolean, intervalMs = 6000): T | null {
  const [data, setData] = useState<T | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(urlRef.current, { cache: "no-store" });
        if (res.ok && alive) setData(await res.json());
      } catch {}
      if (alive) timer = setTimeout(tick, fast ? 1500 : intervalMs);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url, fast, intervalMs]);

  return data;
}

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
  return <span className="num">{fmtDuration(Date.now() - Date.parse(since))}</span>;
}

export function Lamp({ status }: { status: string }) {
  return <span className={`lamp ${status}`} />;
}

export function StatusWord({ status }: { status: string }) {
  return <span className={`status-word ${status}`}>{status}</span>;
}
