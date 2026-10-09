import type { ButtonHTMLAttributes, MouseEventHandler, ReactNode } from "react";
import { Icon, Link } from "../shared";
import { cn } from "./cn";

/**
 * Buttons. Three kinds, so a screen reads at a glance:
 * - primary: the one thing this screen is for (filled, the workspace accent)
 * - secondary: a real action next to it (hairline)
 * - quiet: everything else (text only, a tint on hover)
 * plus `danger` for what deletes or stops. All share the control radius;
 * pills are for status labels only. `href` makes it a hash link.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

const base =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-colors " +
  "disabled:cursor-default disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-live cursor-pointer no-underline";
const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border border-line bg-transparent text-fg hover:bg-surface-2",
  quiet: "bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg",
  danger: "bg-transparent text-bad hover:bg-bad-soft",
};
const sizes = { sm: "h-7 px-2.5 text-sm", md: "h-9 px-3.5 text-base" };

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md", extra?: string): string {
  return cn(base, variants[variant], sizes[size], extra);
}

type Common = {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** A Material Symbols name shown before the label. */
  icon?: string;
  /** Spinner instead of the icon, and disabled. */
  busy?: boolean;
  children?: ReactNode;
  className?: string;
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  busy,
  children,
  className,
  href,
  ...rest
}: Common & { href?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  const inner = (
    <>
      {(icon || busy) && <Icon name={busy ? "progress_activity" : icon!} className="ms-sm" />}
      {children}
    </>
  );
  const cls = buttonClass(variant, size, className);
  if (href)
    return (
      <Link href={href} className={cls} title={rest.title} aria-label={rest["aria-label"]} onClick={rest.onClick as MouseEventHandler<HTMLAnchorElement> | undefined}>
        {inner}
      </Link>
    );
  return (
    <button type="button" className={cls} {...rest} disabled={busy || rest.disabled}>
      {inner}
    </button>
  );
}

/**
 * An icon-only button. `label` is required: it is the tooltip and what a
 * screen reader says.
 */
export function IconButton({
  icon,
  label,
  variant = "quiet",
  size = "md",
  className,
  href,
  ...rest
}: { icon: string; label: string; variant?: "quiet" | "danger"; size?: "sm" | "md"; className?: string; href?: string } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
>) {
  const cls = cn(
    "inline-grid shrink-0 place-items-center rounded-control transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-default no-underline",
    variant === "danger" ? "text-bad hover:bg-bad-soft" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
    size === "sm" ? "size-7" : "size-8",
    className
  );
  if (href) return <Link href={href} className={cls} title={label} aria-label={label}><Icon name={icon} className="ms-sm" /></Link>;
  return (
    <button type="button" className={cls} title={label} aria-label={label} {...rest}>
      <Icon name={icon} className="ms-sm" />
    </button>
  );
}
