import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon, navigate, useHashPath } from "./shared";
import type { AttentionItem, AttentionOwner } from "./types";
import { Kbd } from "./ui";

/**
 * What needs you (GET /api/attention), polled once for the whole page and
 * shared: the rail's counts, the bell's "needs you", the tab title and
 * "next" all read the same list. "next" is the way through it: each press
 * opens the next item where it lives, with its context around it, and the
 * chat scrolls to the waiting card and lights it up.
 */

let items: AttentionItem[] | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

async function tick(): Promise<void> {
  try {
    const r = await fetch("/api/attention", { cache: "no-store" });
    if (r.ok) {
      items = ((await r.json()) as { items: AttentionItem[] }).items;
      for (const l of listeners) l();
    }
  } catch {}
  timer = setTimeout(() => void tick(), 3000);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (listeners.size === 1) void tick();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) clearTimeout(timer);
  };
}

/** Fetch now instead of at the next tick (after answering, after "next" marked a failure read). */
export function refreshAttention(): void {
  if (timer) clearTimeout(timer);
  void tick();
}

export function useAttention(): AttentionItem[] | null {
  return useSyncExternalStore(subscribe, () => items);
}

/** Items that lead to one place in the rail. */
export const attentionFor = {
  agent: (xs: AttentionItem[], slug: string) => xs.filter((i) => i.owner.agent?.slug === slug),
  /** A project's own chats, and everything its agents wait on. */
  project: (xs: AttentionItem[], slug: string, agents: string[] = []) =>
    xs.filter((i) => i.owner.project?.slug === slug || (!!i.owner.agent && agents.includes(i.owner.agent.slug))),
  channel: (xs: AttentionItem[], slug: string) => xs.filter((i) => i.owner.channel === slug),
  general: (xs: AttentionItem[]) => xs.filter((i) => i.owner.general),
};

/** "📁 Relaunch · 🦊 Lisa", "🦊 Lisa", "#launch · 🐻 Max", "Ralv", "website-check run". */
export function ownerText(o: AttentionOwner): string {
  const agent = o.agent ? `${o.agent.emoji ? `${o.agent.emoji} ` : ""}${o.agent.name}` : "";
  const place = o.project ? `📁 ${o.project.title}` : o.channel ? `#${o.channel}` : o.general ? "Ralv" : o.workflow ? `${o.workflow} run` : "";
  return [place, agent].filter(Boolean).join(" · ") || "workspace";
}

const focusOf = (hash: string): string | null => new URLSearchParams(hash.split("?")[1] ?? "").get("focus");
const pathOf = (href: string): string => href.split("?")[0];

/** Where "next" goes from here: the item after the one on screen, else the oldest. */
export function nextItem(list: AttentionItem[], hash: string): AttentionItem | undefined {
  if (list.length === 0) return undefined;
  const at = list.findIndex((i) => i.href === hash || (focusOf(hash) === null && pathOf(i.href) === hash));
  return list[(at + 1) % list.length];
}

/** Open an item: its place, with the request in view; a failure counts as seen once opened. */
export function openAttention(item: AttentionItem): void {
  if (item.notificationId) {
    void fetch("/api/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [item.notificationId] }),
    })
      .then(() => refreshAttention())
      .catch(() => {});
  }
  // Already there: light the card up again instead of navigating nowhere.
  if ((window.location.hash.slice(1) || "/") === item.href) window.dispatchEvent(new Event(REFOCUS_EVENT));
  else navigate(item.href);
}

const REFOCUS_EVENT = "kw-refocus";

/**
 * The top bar's way through the work: "next" opens the next thing waiting
 * for you (⌥N from anywhere). Hidden when nothing waits.
 */
export function NextButton() {
  const list = useAttention() ?? [];
  const hash = useHashPath();
  const target = nextItem(list, hash);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== "KeyN") return;
      const t = nextItem(items ?? [], window.location.hash.slice(1) || "/");
      if (!t) return;
      e.preventDefault();
      openAttention(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!target) return null;
  return (
    <button
      type="button"
      className="next-btn inline-flex h-8 cursor-pointer items-center gap-2 rounded-control border-0 bg-bad/12 px-1.5 font-[inherit] text-sm text-fg hover:bg-bad/18"
      onClick={() => openAttention(target)}
      title={`next: ${ownerText(target.owner)} — ${target.title} (⌥N)`}
    >
      <span className="next-n inline-grid h-5 min-w-5 place-items-center rounded-full bg-bad px-1.5 text-2xs font-bold tabular-nums text-on-bad">{list.length}</span>
      <span className="text-fg-2 max-[640px]:hidden">waiting</span>
      <span className="inline-flex h-6 items-center gap-0.5 rounded-md bg-bad pl-2.5 pr-2 font-semibold text-on-bad">
        next <Icon name="arrow_forward" className="ms-sm" />
      </span>
      <Kbd className="mr-1 max-[800px]:hidden" aria-hidden>⌥N</Kbd>
    </button>
  );
}

/**
 * Land on the request: a route with ?focus=<request id> scrolls the chat to
 * that approval or question card and lights it up once the thread has
 * rendered it. Mounted once, in the app.
 */
export function useFocusRequest(): void {
  const hash = useHashPath();
  const focus = focusOf(hash);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    const bump = () => setAgain((n) => n + 1);
    window.addEventListener(REFOCUS_EVENT, bump);
    return () => window.removeEventListener(REFOCUS_EVENT, bump);
  }, []);
  useEffect(() => {
    if (!focus) return;
    let tries = 0;
    const t = setInterval(() => {
      const el = document.querySelector<HTMLElement>(`[data-request="${CSS.escape(focus)}"]`);
      if (el) {
        clearInterval(t);
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.remove("focus-flash");
        void el.offsetWidth; // restart the animation on a second visit
        el.classList.add("focus-flash");
      } else if (++tries > 40) clearInterval(t);
    }, 150);
    return () => clearInterval(t);
  }, [focus, hash, again]);
}
