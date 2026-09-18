import { useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * The right column: what the workspace has, one tab per kind. Every panel
 * stays mounted, so a half-typed request survives a look at the other tab.
 * The active tab is the caller's: on a phone the bottom navigation picks it.
 */
export function Side({ tabs, active, onPick: pick }: {
  tabs: { id: string; label: string; content: ReactNode }[];
  active: string;
  onPick: (id: string) => void;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  // Arrow keys move between tabs, as the tab pattern asks.
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(tabs.findIndex((t) => t.id === active) + step + tabs.length) % tabs.length];
    pick(next.id);
    buttons.current.get(next.id)?.focus();
  };

  return (
    <section className="panel workflows" aria-label="Workspace">
      <header className="panel-head">
        <div className="tabs" role="tablist" onKeyDown={onKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.id}
              ref={(el) => void (el ? buttons.current.set(t.id, el) : buttons.current.delete(t.id))}
              id={`tab-${t.id}`}
              className="tab"
              role="tab"
              aria-selected={t.id === active}
              aria-controls={`tabpanel-${t.id}`}
              tabIndex={t.id === active ? 0 : -1}
              onClick={() => pick(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      {tabs.map((t) => (
        <div key={t.id} id={`tabpanel-${t.id}`} className="tab-panel" role="tabpanel" aria-labelledby={`tab-${t.id}`} hidden={t.id !== active}>
          {t.content}
        </div>
      ))}
    </section>
  );
}
