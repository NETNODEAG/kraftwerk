import type { MouseEvent, ReactNode } from "react";
import { Link } from "../shared";
import { cn } from "./cn";

/**
 * The one list row: something leading (an icon, an emoji, a dot), a title
 * with an optional line under it, meta on the right, and actions that show
 * on hover. A link (`href`), a button (`onClick`) or plain (neither).
 * Every list in the interface is built from it: the rail, the context
 * column, files, trash, notifications, Home.
 */
export type RowTone = "bad" | "accent" | "plain";

export function ListRow({
  leading,
  title,
  sub,
  subTone = "plain",
  meta,
  actions,
  href,
  onClick,
  active,
  dim,
  size = "md",
  className,
  titleExtra,
  label,
  over,
  actionsAlways,
  innerProps,
}: {
  leading?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  subTone?: RowTone;
  meta?: ReactNode;
  /** Shown on hover and focus, right of the meta. */
  actions?: ReactNode;
  href?: string;
  onClick?: (e: MouseEvent) => void;
  active?: boolean;
  /** Greyed out: a link whose target is gone. */
  dim?: boolean;
  size?: "sm" | "md";
  className?: string;
  /** Right after the title on its line: a count, a dot. */
  titleExtra?: ReactNode;
  /** Accessible name when the title alone is ambiguous. */
  label?: string;
  /** A small line above the title: whose it is ("🐻 Max", "📁 Relaunch"). */
  over?: ReactNode;
  /** Actions always visible, not only on hover (a fold chevron). */
  actionsAlways?: boolean;
  /** Extra attributes for the link or button itself: a tooltip, data-* hooks. */
  innerProps?: Record<string, string | undefined>;
}) {
  const body = (
    <>
      {leading !== undefined && <span className="grid w-6 shrink-0 place-items-center text-[15px] text-fg-2">{leading}</span>}
      <span className="grid min-w-0 flex-1">
        {over && <span className="truncate text-xs font-semibold text-fg-2">{over}</span>}
        <span className={cn("flex min-w-0 items-center gap-1.5 text-fg", over ? "font-normal" : "font-semibold", size === "sm" ? "text-sm" : "text-base")}>
          <span className="min-w-0 truncate">{title}</span>
          {titleExtra}
        </span>
        {sub && (
          <span className={cn("truncate text-xs", subTone === "bad" ? "text-bad" : subTone === "accent" ? "text-accent" : "text-fg-2")}>{sub}</span>
        )}
      </span>
      {meta !== undefined && <span className="shrink-0 text-xs tabular-nums text-fg-2">{meta}</span>}
    </>
  );
  const rowCls = cn(
    "flex min-w-0 flex-1 items-center gap-2.5 rounded-control text-left no-underline text-inherit",
    size === "sm" ? "px-2.5 py-1.5" : "px-2.5 py-2",
    (href || onClick) && "cursor-pointer",
    dim && "opacity-55"
  );
  const inner = href ? (
    <Link href={href} onClick={onClick} className={rowCls} aria-label={label} aria-current={active ? "page" : undefined} {...innerProps}>
      {body}
    </Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} className={cn(rowCls, "border-0 bg-transparent font-[inherit]")} aria-label={label} {...innerProps}>
      {body}
    </button>
  ) : (
    <div className={rowCls}>{body}</div>
  );
  return (
    <div
      className={cn(
        "group/row relative flex items-center rounded-control transition-colors",
        active ? "bg-surface shadow-[inset_0_0_0_1px_var(--line)]" : (href || onClick) && "hover:bg-surface-2",
        className
      )}
    >
      {inner}
      {actions && (
        <span className={cn("flex shrink-0 items-center gap-0.5 pr-1.5", !actionsAlways && "opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100")}>
          {actions}
        </span>
      )}
    </div>
  );
}
