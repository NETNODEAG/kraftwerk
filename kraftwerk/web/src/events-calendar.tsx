import { useEffect, useState } from "react";
import { Icon } from "./shared";
import { cn } from "./ui";

/**
 * Events on a dense month calendar: weeks from Monday, each day with its
 * events as one-line chips (time first when the event has one), multi-day
 * events on every day they span. With one selected the calendar shows its
 * month and marks it; ‹ › and "today" page through months. A chip is a
 * button: clicking it calls `onPick` with the event's slug.
 */
export interface CalEvent {
  slug: string;
  title: string;
  /** "2026-11-03" or "2026-11-03T14:00". */
  start: string;
  end?: string;
}

const day = (s: string): string => s.slice(0, 10);
const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthOf = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, 1);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function EventsCalendar({ events, selected, onPick }: { events: CalEvent[]; selected?: string; onPick: (slug: string) => void }) {
  const sel = events.find((e) => e.slug === selected);
  const [month, setMonth] = useState<Date>(() => (sel ? monthOf(sel.start) : monthOf(iso(new Date()))));
  // A selection elsewhere (the list on the left) brings its month.
  useEffect(() => {
    if (sel) setMonth(monthOf(sel.start));
  }, [sel?.slug, sel?.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = new Date(month);
  const lead = (first.getDay() + 6) % 7; // days before the 1st, from Monday
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((lead + daysIn) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const today = iso(new Date());
  const on = (d: string) =>
    events
      .filter((e) => day(e.start) <= d && d <= day(e.end || e.start))
      .sort((a, b) => a.start.localeCompare(b.start));
  const inMonth = events.filter((e) => day(e.start) <= iso(cells[cells.length - 1]) && day(e.end || e.start) >= iso(cells[0])).length;
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div className="events-calendar flex min-h-0 flex-1 flex-col gap-2" role="region" aria-label="calendar of the events">
      <div className="flex flex-none items-center gap-1">
        <h3 className="m-0 flex-1 text-base font-semibold text-fg" aria-live="polite">
          {month.toLocaleDateString([], { month: "long", year: "numeric" })}
          <span className="ms-2 text-xs font-normal text-fg-2">
            {inMonth} event{inMonth === 1 ? "" : "s"}
          </span>
        </h3>
        <button type="button" className="cursor-pointer rounded-full px-2.5 py-1 text-xs text-fg-2 hover:bg-surface-2 hover:text-fg" onClick={() => setMonth(monthOf(today))}>
          today
        </button>
        <button type="button" aria-label="previous month" className="grid size-7 cursor-pointer place-items-center rounded-full text-fg-2 hover:bg-surface-2 hover:text-fg" onClick={() => shift(-1)}>
          <Icon name="chevron_left" className="ms-sm" />
        </button>
        <button type="button" aria-label="next month" className="grid size-7 cursor-pointer place-items-center rounded-full text-fg-2 hover:bg-surface-2 hover:text-fg" onClick={() => shift(1)}>
          <Icon name="chevron_right" className="ms-sm" />
        </button>
      </div>
      <div className="grid flex-none grid-cols-7 text-center text-2xs tracking-wide text-fg-2 uppercase">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto rounded-lg border border-line bg-line" style={{ gridTemplateRows: `repeat(${weeks}, minmax(44px, 1fr))`, gap: 1 }}>
        {cells.map((c) => {
          const d = iso(c);
          const evs = on(d);
          const out = c.getMonth() !== month.getMonth();
          return (
            <div key={d} data-day={d} className={cn("flex min-h-0 min-w-0 flex-col gap-px overflow-hidden bg-surface p-0.5", out && "bg-[color-mix(in_srgb,var(--color-surface-2)_35%,var(--color-surface))]")}>
              <span className={cn("self-end px-1 text-2xs tabular-nums", out ? "text-fg-2/60" : "text-fg-2", d === today && "rounded-full bg-accent px-1.5 font-semibold text-on-accent")}>{c.getDate()}</span>
              {evs.slice(0, 4).map((e) => {
                const time = day(e.start) === d && e.start.length > 10 ? e.start.slice(11, 16) : "";
                return (
                  <button
                    key={e.slug}
                    type="button"
                    data-event={e.slug}
                    aria-pressed={e.slug === selected}
                    title={`${e.title} · ${e.start.replace("T", " ")}${e.end ? `–${e.end.replace("T", " ")}` : ""}`}
                    className={cn(
                      "block w-full cursor-pointer truncate rounded px-1 text-left text-2xs leading-4",
                      e.slug === selected ? "bg-accent text-on-accent" : "bg-[color-mix(in_srgb,#a16207_16%,var(--color-surface))] text-fg hover:brightness-95",
                    )}
                    onClick={() => onPick(e.slug)}
                  >
                    {time && <span className="me-1 tabular-nums opacity-70">{time}</span>}
                    {e.title}
                  </button>
                );
              })}
              {evs.length > 4 && <span className="px-1 text-2xs text-fg-2">+{evs.length - 4} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
