import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/* ---------- icons ---------- */

/**
 * Material Symbols Rounded (self-hosted variable font, imported in
 * main.tsx). `name` is the symbol's ligature name, e.g. "edit",
 * "play_arrow". `fill` switches to the filled variant (M3 active state).
 */
export function Icon({ name, fill, className }: { name: string; fill?: boolean; className?: string }) {
  return (
    <span className={`ms material-symbols-rounded${fill ? " ms-fill" : ""}${className ? ` ${className}` : ""}`} aria-hidden>
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

/* ---------- polling ---------- */

/** Poll a JSON endpoint; tightens the interval while `fast` (live run). */
export function usePoll<T>(url: string, fast: boolean): T | null {
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
      if (alive) timer = setTimeout(tick, fast ? 1500 : 6000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url, fast]);

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
