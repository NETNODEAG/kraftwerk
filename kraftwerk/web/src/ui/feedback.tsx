import type { HTMLAttributes, ReactNode } from "react";
import { Icon, Link } from "../shared";
import { cn } from "./cn";

/** A count that needs you: red, round, on rows and headers. Nothing when zero. */
export function Badge({ n, tone = "bad", title }: { n: number; tone?: "bad" | "neutral"; title?: string }) {
  if (!n) return null;
  return (
    <span
      data-ui="badge"
      className={cn(
        "inline-grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full px-1.5 text-2xs font-bold tabular-nums",
        tone === "bad" ? "bg-bad text-on-bad" : "bg-surface-2 text-fg-2"
      )}
      title={title}
      aria-label={title ?? `${n}`}
    >
      {n}
    </span>
  );
}

export type DotTone = "ok" | "bad" | "ask" | "live" | "working" | "idle";

/** A state as a small dot: working pulses, waiting is red. */
export function Dot({ tone, title }: { tone: DotTone; title?: string }) {
  return (
    <span
      data-ui="dot"
      data-tone={tone}
      title={title}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        tone === "ok" && "bg-ok",
        tone === "bad" && "bg-bad",
        tone === "ask" && "bg-ask",
        tone === "live" && "bg-live",
        tone === "working" && "animate-pulse bg-accent",
        tone === "idle" && "border-[1.5px] border-line"
      )}
    />
  );
}

/**
 * A status label: the one place for a pill shape ("running", "local only",
 * "static"). With `href` it links to what it names (a run, a bundle, an app).
 */
export function Tag({
  children,
  tone = "neutral",
  title,
  href,
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "bad" | "ask" | "accent";
  title?: string;
  href?: string;
  className?: string;
}) {
  const cls = cn(
    "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs font-semibold no-underline",
    tone === "neutral" && "bg-surface-2 text-fg-2",
    tone === "ok" && "bg-ok-soft text-ok",
    tone === "bad" && "bg-bad-soft text-on-bad-soft",
    tone === "ask" && "bg-ask-soft text-on-ask-soft",
    tone === "accent" && "bg-accent-soft text-on-accent-soft",
    href && "transition-opacity hover:opacity-80",
    className
  );
  return href ? (
    <Link href={href} title={title} className={cls}>
      {children}
    </Link>
  ) : (
    <span title={title} className={cls}>
      {children}
    </span>
  );
}

/** A key on the keyboard: ⌘K, ⌥N, esc. */
export function Kbd({ children, className, ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <kbd className={cn("rounded-[5px] border border-line px-[5px] py-[3px] font-mono text-[10.5px] leading-none text-fg-2", className)} {...rest}>
      {children}
    </kbd>
  );
}

/** A small explaining line: what a form does, where something lives, that a list is empty. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("m-0 text-xs text-fg-2 [&_code]:text-2xs", className)}>{children}</p>;
}

/** Nothing here yet: an icon, one sentence, and maybe the action that changes it. */
export function EmptyState({ icon, children, action, className }: { icon?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-fg-2", className)}>
      {icon && <Icon name={icon} className="text-[32px] opacity-70" />}
      <div>{children}</div>
      {action}
    </div>
  );
}

/** An error or a note in a line. */
export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "bad"; children: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-1.5 px-1.5 py-1 text-sm", tone === "bad" ? "text-bad" : "text-fg-2")}>
      {tone === "bad" && <Icon name="error" className="ms-sm" />}
      {children}
    </div>
  );
}
