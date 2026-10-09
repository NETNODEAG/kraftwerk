import { useEffect, useRef, useState } from "react";
import { Icon } from "./shared";
import { cn, IconButton } from "./ui";

/** Ask the context column to show a url in its browser (a new tab, or the tab that already has this exact url). */
export const BROWSE_EVENT = "kw-browse";
export function browse(url: string): void {
  window.dispatchEvent(new CustomEvent(BROWSE_EVENT, { detail: url }));
}

/**
 * Add a small "open here" icon after every external link in rendered
 * markdown, so a page an agent mentions can be read beside the conversation.
 * Works on sanitized HTML; the click is handled by delegation (onBrowseClick).
 */
export function withBrowseIcons(html: string): string {
  if (!/<a\s/i.test(html)) return html;
  const box = document.createElement("template");
  box.innerHTML = html;
  for (const a of box.content.querySelectorAll<HTMLAnchorElement>('a[href^="http://"], a[href^="https://"]')) {
    if (a.classList.contains("md-browse")) continue;
    const icon = document.createElement("a");
    // md-browse is what the click delegation (onBrowseClick) finds; the rest is its look.
    icon.className =
      "md-browse ml-0.5 inline-grid size-[18px] place-items-center rounded-[5px] align-[-3px] text-fg-2 no-underline opacity-55 transition " +
      "hover:bg-surface-2 hover:text-accent hover:opacity-100 [&_.ms]:align-[0] [&_.ms]:text-[14px]";
    icon.href = a.getAttribute("href") ?? "";
    icon.title = "Open beside the conversation";
    icon.setAttribute("aria-label", "Open beside the conversation");
    icon.innerHTML = '<span class="ms material-symbols-rounded ms-sm" aria-hidden="true">open_in_new</span>';
    a.after(icon);
  }
  return box.innerHTML;
}

/** Click delegation for a container of rendered markdown: the browse icons open in the context browser. */
export function onBrowseClick(e: React.MouseEvent): void {
  const icon = (e.target as HTMLElement).closest?.("a.md-browse") as HTMLAnchorElement | null;
  if (!icon) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  browse(icon.href);
}

interface Tab {
  id: number;
  url: string;
}

const STORE = "kw-browser-tabs";

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Accept what was typed: a bare host gets https. */
function normalize(input: string): string {
  const s = input.trim();
  if (!s) return "";
  return /^[a-z]+:\/\//i.test(s) ? s : `https://${s}`;
}

/**
 * The browser in the context column, one per context (its tabs are that
 * conversation's reading): tabs of iframes, an address bar, and the page. Every tab stays mounted, so switching keeps the pages as they
 * are. A url asked for (browse()) opens once: the tab that already shows it
 * comes to the front instead of a second one. Sites that refuse to be
 * embedded show their own blank frame; "open in a window" is always there.
 */
export function ContextBrowser({ storeKey, onTabs }: {
  /** Tabs belong to a context (an agent, a project, a channel, the general chat): the host keys the browser by it. */
  storeKey: string;
  onTabs?: (n: number) => void;
}) {
  const store = `${STORE}:${storeKey}`;
  const [tabs, setTabs] = useState<Tab[]>(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem(store) ?? "[]") as Tab[];
      return Array.isArray(v) ? v.filter((t) => typeof t.url === "string" && typeof t.id === "number") : [];
    } catch {
      return [];
    }
  });
  const [active, setActive] = useState<number | null>(() => tabs[0]?.id ?? null);
  const [address, setAddress] = useState("");
  const [reloadKey, setReloadKey] = useState<Record<number, number>>({});
  const nextId = useRef(Math.max(0, ...tabs.map((t) => t.id)) + 1);

  useEffect(() => {
    try {
      sessionStorage.setItem(store, JSON.stringify(tabs));
    } catch {}
    onTabs?.(tabs.length);
  }, [tabs, onTabs, store]);

  const open = (url: string) => {
    setTabs((prev) => {
      const hit = prev.find((t) => t.url === url);
      if (hit) {
        setActive(hit.id);
        return prev;
      }
      const tab = { id: nextId.current++, url };
      setActive(tab.id);
      return [...prev, tab];
    });
  };

  useEffect(() => {
    const onBrowse = (e: Event) => open((e as CustomEvent<string>).detail);
    window.addEventListener(BROWSE_EVENT, onBrowse);
    return () => window.removeEventListener(BROWSE_EVENT, onBrowse);
  }, []);

  const current = tabs.find((t) => t.id === active) ?? null;
  useEffect(() => setAddress(current?.url ?? ""), [current?.url]);

  const close = (id: number) => {
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (active === id) setActive(next[Math.min(i, next.length - 1)]?.id ?? null);
      return next;
    });
  };

  const go = () => {
    const url = normalize(address);
    if (!url) return;
    if (current) setTabs((prev) => prev.map((t) => (t.id === current.id ? { ...t, url } : t)));
    else open(url);
  };

  const bar = "grid size-[30px] flex-none place-items-center rounded-full text-fg-2 no-underline transition-colors hover:bg-surface hover:text-fg";
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex flex-none items-center gap-0.5 overflow-x-auto px-1.5 pt-1.5 [scrollbar-width:none]" role="tablist" aria-label="Browser tabs">
        {tabs.map((t) => (
          <div key={t.id} className={cn("flex max-w-[180px] items-center rounded-t-lg", t.id === active ? "bg-surface-2 text-fg" : "text-fg-2")}>
            <button
              role="tab"
              aria-selected={t.id === active}
              className="min-w-0 cursor-pointer truncate border-0 bg-transparent py-1.5 pr-1 pl-2.5 text-[12.5px] font-semibold text-inherit"
              title={t.url}
              onClick={() => setActive(t.id)}
            >
              {hostOf(t.url)}
            </button>
            <IconButton icon="close" label={`Close ${hostOf(t.url)}`} className="size-6 text-inherit" onClick={() => close(t.id)} />
          </div>
        ))}
        <IconButton
          icon="add"
          label="New tab"
          className="ml-1 size-6"
          onClick={() => {
            setActive(null);
            setAddress("");
          }}
        />
      </div>
      <form
        className="flex flex-none items-center gap-1 border-y border-line bg-surface-2 px-2 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <button
          type="button"
          className={cn(bar, "cursor-pointer border-0 bg-transparent disabled:pointer-events-none disabled:opacity-40")}
          title="Reload"
          aria-label="Reload"
          disabled={!current}
          onClick={() => current && setReloadKey((k) => ({ ...k, [current.id]: (k[current.id] ?? 0) + 1 }))}
        >
          <Icon name="refresh" />
        </button>
        <input
          className="h-[30px] min-w-0 flex-1 rounded-full border border-line bg-surface px-3 font-sans text-[13px] text-fg focus:border-fg focus:outline-none"
          value={address}
          placeholder="https://…"
          aria-label="Address"
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button type="submit" className={cn(bar, "cursor-pointer border-0 bg-transparent")} title="Go" aria-label="Go">
          <Icon name="arrow_forward" />
        </button>
        <a
          className={cn(bar, !current && "pointer-events-none opacity-40")}
          href={current?.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in a window"
          aria-label="Open in a window"
        >
          <Icon name="open_in_new" />
        </a>
      </form>
      {/* The page itself stays white whatever the theme: sites expect a white canvas. */}
      <div className="relative min-h-0 flex-1 bg-white">
        {tabs.map((t) => (
          <iframe
            key={`${t.id}:${reloadKey[t.id] ?? 0}`}
            className="block size-full border-0 bg-white [&[hidden]]:hidden"
            src={t.url}
            title={hostOf(t.url)}
            hidden={t.id !== active}
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-downloads"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ))}
        {!current && (
          <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 bg-surface p-6 text-center text-fg-2">
            <Icon name="public" className="text-[32px]" />
            <p className="m-0 max-w-[36ch] text-[13.5px]">
              Read a page beside the conversation: type an address, or click the <Icon name="open_in_new" className="ms-sm align-[-3px]" /> next to a link in the chat.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
