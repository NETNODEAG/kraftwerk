import { createContext, useContext, type ReactNode } from "react";
import { Icon } from "../shared";
import { cn } from "./cn";

/** The small uppercase heading above a group ("needs you", "team", "files"). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-2xs font-semibold uppercase tracking-[0.08em] text-fg-2", className)}>{children}</span>;
}

/**
 * A titled group of rows or content, with an optional count and action on the right.
 * `sm` (default) labels it with an eyebrow; `lg` is a real heading, for a page
 * that reads top to bottom in sections (the context column's overview).
 */
export function Section({
  title,
  count,
  action,
  size = "sm",
  children,
  className,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  size?: "sm" | "lg";
  children: ReactNode;
  className?: string;
}) {
  if (size === "lg") {
    return (
      <section className={cn("mt-4 border-t border-line pt-4 first:mt-0 first:border-t-0 first:pt-0", className)}>
        <div className="flex items-center gap-2 px-2.5 pb-1.5">
          <h3 className="m-0 text-[17px] leading-tight font-[750] tracking-[-0.01em] text-fg first-letter:uppercase">{title}</h3>
          {count !== undefined && <span className="rounded-full bg-surface-2 px-2 py-px text-xs font-semibold tabular-nums text-fg-2">{count}</span>}
          <span className="flex-1" />
          {action}
        </div>
        {children}
      </section>
    );
  }
  return (
    <section className={cn("mt-3 first:mt-0", className)}>
      <div className="flex items-center gap-2 px-2.5 pb-1 pt-1">
        <Eyebrow>{title}</Eyebrow>
        {count !== undefined && <span className="text-2xs font-semibold tabular-nums text-fg-2">{count}</span>}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

/** A card: white panel, hairline, the card radius; an optional head with title and actions. */
export function Panel({
  title,
  count,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-card border border-line bg-surface", className)}>
      {(title || actions) && (
        <div className="flex min-h-12 items-center gap-2 border-b border-line px-[18px] py-2">
          {title && <Eyebrow className="text-fg">{title}</Eyebrow>}
          {count !== undefined && count > 0 && <span className="text-xs font-bold tabular-nums text-bad">{count}</span>}
          <span className="flex-1" />
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** A heading: `md` for a pane or a chat, `lg` for the thing a page is about (an agent, a project, a run). */
export function Title({ children, size = "md", className }: { children: ReactNode; size?: "md" | "lg"; className?: string }) {
  return <h1 className={cn("m-0 font-semibold tracking-[-0.01em] text-fg", size === "lg" ? "text-2xl" : "text-xl", className)}>{children}</h1>;
}

/** A page's head: an icon, the title, an optional line under it, actions on the right. */
export function PageHeader({ title, sub, actions, icon }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      {typeof icon === "string" ? <Icon name={icon} className="text-[26px] text-fg-2" /> : icon}
      <div className="min-w-0">
        <Title>{title}</Title>
        {sub && <div className="text-sm text-fg-2">{sub}</div>}
      </div>
      <span className="flex-1" />
      {actions}
    </header>
  );
}

/**
 * A page's column: `narrow` for a form or a fresh pane in the conversation
 * column (new chat, new agent, the editors), `wide` for a page of the
 * workspace (git, trash, workspaces). Its parts stack with one gap.
 */
export function Page({ children, width = "wide", className }: { children: ReactNode; width?: "narrow" | "wide"; className?: string }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full animate-rise flex-col gap-4",
        // new-chat: shell.css gives a pane in the conversation column room for the context's sign.
        width === "narrow" ? "new-chat max-w-[640px]" : "max-w-[960px]",
        className
      )}
    >
      {children}
    </div>
  );
}

/** The big round mark of an agent or a project: its emoji in the accent's wash. */
export function Avatar({ children }: { children: ReactNode }) {
  return <span className="grid size-14 flex-none place-items-center rounded-full bg-accent-soft text-[28px] leading-none">{children}</span>;
}

/** An icon in a tonal circle, leading a panel row. */
export function RowIcon({ name }: { name: string }) {
  return (
    <span className="grid size-8 flex-none place-items-center rounded-full bg-accent-soft text-on-accent-soft">
      <Icon name={name} className="text-[17px]" />
    </span>
  );
}

/**
 * A row of a panel that lists parts of something (an agent's workflows,
 * a project's links): an icon, a title, what it holds under it, an action.
 * Rows in one panel sit a hairline apart (`PanelRows`).
 */
export function PanelRow({
  icon,
  title,
  children,
  action,
  className,
  ...data
}: { icon: string; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string } & { [k: `data-${string}`]: string | undefined }) {
  return (
    <div className={cn("flex items-center gap-3.5 px-[18px] py-3", className)} {...data}>
      <RowIcon name={icon} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex items-center gap-2 text-[13.5px] font-medium text-fg">{title}</span>
        {children}
      </span>
      {action}
    </div>
  );
}

export function PanelRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col divide-y divide-line py-1", className)}>{children}</div>;
}

/** A panel's list of facts, hairlines between them; `compact` puts label and value on one line (the context column). */
const CompactFacts = createContext(false);

export function Facts({ compact = false, children }: { compact?: boolean; children: ReactNode }) {
  return (
    <CompactFacts.Provider value={compact}>
      <div className="py-1 [&>*+*]:border-t [&>*+*]:border-line">{children}</div>
    </CompactFacts.Provider>
  );
}

export function Fact({ label, dim, mono, children }: { label: ReactNode; dim?: boolean; mono?: boolean; children: ReactNode }) {
  const compact = useContext(CompactFacts);
  return (
    <div className={cn("flex", compact ? "items-baseline gap-3 px-3.5 py-1.5" : "flex-col gap-[3px] px-[18px] py-2.5")}>
      <Eyebrow className={cn(compact && "w-[84px] flex-none")}>{label}</Eyebrow>
      <span
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-2 break-words",
          compact ? "text-xs" : "text-[12.5px]",
          dim ? "text-fg-2" : "text-fg",
          mono && "font-mono break-all"
        )}
      >
        {children}
      </span>
    </div>
  );
}
