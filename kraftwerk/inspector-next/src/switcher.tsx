import { useState, type CSSProperties } from "react";
import { getMeta, instanceOrigin, startWorkspace, type Meta, type SwitcherEntry } from "./api";
import { useMenu } from "./menu";

/** Same seed → hue hash as the inspector, so a workspace keeps its colour in both UIs. */
function workspaceColor(color: string | undefined, seed: string): string {
  if (color) return color;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return `hsl(${(h >>> 0) % 360} 58% 46%)`;
}

const isLoopback = (url: string): boolean => {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * Go to another instance. Built, this UI sits under /next/ on every
 * instance's own server. In dev there is one page for all of them: the
 * `kw-target` cookie re-points the dev server's /api proxy (vite.config.ts).
 */
function switchTo(url: string): void {
  if (import.meta.env.DEV && isLoopback(url)) {
    document.cookie = `kw-target=${encodeURIComponent(url)}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
    return;
  }
  window.location.assign(import.meta.env.DEV ? url : `${url.replace(/\/+$/, "")}/next/`);
}

/** Start a stopped workspace and wait until its server answers. */
async function startAndWait(root: string): Promise<string> {
  const started = await startWorkspace(root);
  if (started.live && started.url) return started.url;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    const hit = (await getMeta().catch(() => null))?.switcher.find((e) => e.root === root && e.live);
    if (hit) return hit.url;
  }
  throw new Error("started, but it does not answer yet");
}

const host = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/+$/, "");

/** Where a workspace is: its folder, and its address while it has one. A stopped one only remembers its last port. */
const whereabouts = (rootLabel: string | undefined, url: string, running: boolean): string =>
  [rootLabel, running || !rootLabel ? host(url) : ""].filter(Boolean).join(" · ");

function Tile({ icon, name, color }: { icon?: string; name: string; color: string }) {
  return (
    <span className="ws-tile" style={{ "--ws-c": color } as CSSProperties} aria-hidden>
      {icon || name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Entry({ entry }: { entry: SwitcherEntry }) {
  const [state, setState] = useState<"idle" | "starting">("idle");
  const [error, setError] = useState("");
  const stopped = entry.live === false;
  const missing = stopped && entry.exists === false;

  const go = async () => {
    if (!stopped) return switchTo(entry.url);
    if (!entry.root) return;
    setState("starting");
    setError("");
    try {
      switchTo(await startAndWait(entry.root));
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
    }
  };

  return (
    <button className="switcher-item" role="menuitem" disabled={missing || state === "starting"} onClick={go}>
      <Tile icon={entry.icon} name={entry.name} color={workspaceColor(entry.color, entry.root ?? entry.url)} />
      <span className="switcher-text">
        <span className="switcher-name">{entry.name}</span>
        <span className="switcher-sub">{error || whereabouts(entry.rootLabel, entry.url, entry.live === true)}</span>
      </span>
      <span className="switcher-state">
        {missing ? "folder missing" : state === "starting" ? "starting…" : stopped ? "start" : entry.live ? "running" : "open"}
      </span>
    </button>
  );
}

export function Switcher({ meta }: { meta: Meta }) {
  const { open, setOpen, wrap } = useMenu<HTMLSpanElement>();

  const color = workspaceColor(meta.projectColor, meta.projectRoot || meta.projectName);
  const groups = [
    { label: "running", items: meta.switcher.filter((e) => e.live === true) },
    { label: "stopped", items: meta.switcher.filter((e) => e.live === false) },
    { label: "linked", items: meta.switcher.filter((e) => e.live === undefined) },
  ].filter((g) => g.items.length > 0);

  return (
    <span className="switcher" ref={wrap}>
      <button
        className="switcher-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={meta.projectRootLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <Tile icon={meta.projectIcon} name={meta.projectName} color={color} />
        <span className="switcher-current">{meta.projectName}</span>
        <span className="switcher-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="switcher-pop" role="menu">
          <div className="switcher-item switcher-self" aria-current="true">
            <Tile icon={meta.projectIcon} name={meta.projectName} color={color} />
            <span className="switcher-text">
              <span className="switcher-name">{meta.projectName}</span>
              <span className="switcher-sub">{whereabouts(meta.projectRootLabel, instanceOrigin(), true)}</span>
            </span>
            <span className="switcher-state">this one</span>
          </div>
          {groups.length === 0 && <div className="switcher-empty">No other workspaces on this machine yet.</div>}
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <div className="switcher-group">{g.label}</div>
              {g.items.map((e) => (
                <Entry key={e.root ?? e.url} entry={e} />
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
