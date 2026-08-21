import { useEffect, useRef, useState } from "react";

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
