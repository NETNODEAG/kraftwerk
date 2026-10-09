import type { ReactNode } from "react";
import { Link } from "../shared";
import { cn } from "./cn";

type Tab<T> = { id: T; label: ReactNode; count?: number; href?: string };

/**
 * Underlined tabs: the same everywhere a view has parts. A tab with `href`
 * is a route (a link), otherwise a button that calls `onChange`. `bare`
 * drops the hairline and side padding, for tabs set inside a header.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  label,
  bare,
}: {
  items: Tab<T>[];
  value: T;
  onChange?: (id: T) => void;
  className?: string;
  label?: string;
  bare?: boolean;
}) {
  return (
    // A phone scrolls the tabs sideways instead of wrapping them onto a second row.
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "flex flex-wrap gap-x-4 max-[800px]:flex-nowrap max-[800px]:overflow-x-auto max-[800px]:overflow-y-hidden max-[800px]:[scrollbar-width:none] max-[800px]:[&>*]:flex-none",
        !bare && "border-b border-line px-4",
        className,
      )}
    >
      {items.map((t) => {
        const on = t.id === value;
        const cls = cn(
          "-mb-px inline-flex cursor-pointer items-center gap-1.5 border-0 border-b-2 bg-transparent px-0 pt-2 pb-[7px] text-sm font-semibold no-underline transition-colors",
          on ? "border-accent text-accent" : "border-transparent text-fg-2 hover:text-fg"
        );
        const body = (
          <>
            {t.label}
            {t.count !== undefined && <span className="text-2xs font-semibold tabular-nums opacity-70">{t.count}</span>}
          </>
        );
        return t.href ? (
          <Link key={t.id} href={t.href} role="tab" aria-selected={on} className={cls}>
            {body}
          </Link>
        ) : (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange?.(t.id)} className={cls}>
            {body}
          </button>
        );
      })}
    </div>
  );
}
