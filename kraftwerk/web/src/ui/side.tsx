import type { InputHTMLAttributes, ReactNode } from "react";
import { Icon } from "../shared";
import { IconButton } from "./button";
import { cn } from "./cn";
import { TextField } from "./field";
import { Eyebrow } from "./layout";

/*
 * A screen's sidebar, inside its <aside className="runs-side"> (shell.css
 * places it): a head, maybe a search, the list. The same parts in every
 * sidebar, so they read alike: knowledge, skills, workflows, runs, apps,
 * projects, channels, agents, files, a conversation's chats.
 */

/** What the list is, its count, a way back and an action. `divided` starts a second group in the same list. */
export function SideHead({
  title,
  count,
  back,
  action,
  divided,
}: {
  title: ReactNode;
  count?: ReactNode;
  back?: { href: string; label: string };
  action?: ReactNode;
  divided?: boolean;
}) {
  return (
    <div className={cn("flex min-h-11 items-center gap-2 pt-3 pb-1", divided ? "mt-2.5 border-t border-line px-2" : "px-3.5")}>
      {back && <IconButton icon="arrow_back" label={back.label} size="sm" href={back.href} className="-ml-1.5" />}
      <Eyebrow>{title}</Eyebrow>
      {count !== undefined && <span className="text-2xs font-semibold tabular-nums text-fg-2">{count}</span>}
      <span className="flex-1" />
      {action}
    </div>
  );
}

/** The list's search or filter box. */
export function SideSearch({ icon = "search", ...rest }: { icon?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="relative mx-2 mt-1 mb-1 block">
      <Icon name={icon} className="ms-sm pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-2" />
      <TextField type="search" className="h-8 rounded-full pl-8 text-sm" {...rest} />
    </label>
  );
}

/** The rows. With `label` it is a navigation landmark of that name. */
export function SideList({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  const cls = cn("flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5", className);
  return label ? (
    <nav className={cls} aria-label={label}>
      {children}
    </nav>
  ) : (
    <div className={cls}>{children}</div>
  );
}

/** What a list says when it has nothing to show. */
export function SideNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("m-0 px-3 py-2.5 text-xs text-fg-2", className)}>{children}</p>;
}
