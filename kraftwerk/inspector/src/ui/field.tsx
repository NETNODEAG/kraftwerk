import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

const controlBase =
  "rounded-control border border-line bg-surface text-fg placeholder:text-fg-2 " +
  "focus:border-accent focus:outline-none disabled:opacity-60";

/** Which utilities a default competes with: a caller's `h-7` replaces the default `h-9`, `w-auto` the default `w-full`. */
const GROUPS: Array<[RegExp, RegExp]> = [
  [/^font-(sans|mono|reading|serif)$/, /^font-(sans|mono|reading|serif)$/],
  [/^text-(2xs|xs|sm|base|md|lg|xl)$/, /^text-(2xs|xs|sm|base|md|lg|xl|2xl|\[\d)/],
  [/^w-/, /^w-/],
  [/^h-/, /^h-/],
  [/^px-/, /^px-/],
  [/^pr-/, /^(pr|px)-/],
  [/^py-/, /^py-/],
  [/^leading-/, /^leading-/],
];

/**
 * The shared control look plus per-control defaults. A default gives way to
 * the caller's utility of the same kind (`font-mono text-sm` on a markdown
 * box, `h-7` on a compact field): two utilities of one kind on an element
 * are decided by stylesheet order, not by who asked.
 */
function control(defaults: string, className?: string): string {
  const mine = (className ?? "").split(/\s+/).filter(Boolean);
  const kept = defaults.split(" ").filter((d) => {
    const group = GROUPS.find(([own]) => own.test(d));
    return !group || !mine.some((m) => group[1].test(m));
  });
  return cn(controlBase, ...kept, className);
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextField({ className, ...rest }, ref) {
  return <input ref={ref} className={control("w-full h-9 px-3 font-sans text-base", className)} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={control("w-full px-3 py-2 font-sans text-base leading-normal", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={control("w-full h-9 cursor-pointer px-3 pr-8 font-sans text-base", className)} {...rest}>
      {children}
    </select>
  );
}

/** A label above a control, with an optional hint under it. */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-sm font-semibold text-fg">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-2">{hint}</span>}
    </label>
  );
}

/** A form inside a panel: fields stacked, the panel's padding. */
export function FormStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-3.5 p-[18px]", className)}>{children}</div>;
}

/** Fields side by side, stacked on a narrow screen. */
export function FieldRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-end gap-2.5 max-[900px]:flex-col max-[900px]:items-stretch", className)}>{children}</div>;
}

/**
 * A checkbox with what it turns on. `hint` follows the label in grey; the
 * whole line is the label, so `getByLabel` finds the box by either. `mono`
 * sets the label as an identifier (a slug, a skill name).
 */
export function Checkbox({
  checked,
  onChange,
  children,
  hint,
  mono,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
  mono?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm text-fg", disabled && "cursor-default opacity-60", className)}>
      <input type="checkbox" className="size-[15px] flex-none accent-accent" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        {mono ? <b className="font-mono text-xs font-semibold">{children}</b> : children}
        {hint && <span className="text-xs text-fg-2"> — {hint}</span>}
      </span>
    </label>
  );
}

/** The look of an on/off switch, for a control that is a switch as a whole (a row with a label). */
export function SwitchTrack({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className={cn("relative inline-block h-6 w-11 flex-none rounded-full border-2 transition-colors", checked ? "border-accent bg-accent" : "border-line bg-surface-2")}>
      <span className={cn("absolute top-1/2 size-4 -translate-y-1/2 rounded-full transition-[left,background-color]", checked ? "left-[22px] bg-on-accent" : "left-1 bg-fg-2")} />
    </span>
  );
}

/** An on/off switch. `label` is what a screen reader says; show it beside the switch yourself if needed. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex flex-none cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default disabled:opacity-50"
    >
      <SwitchTrack checked={checked} />
    </button>
  );
}

/** A switch as a row: headline, optional supporting text, and the toggle. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="flex cursor-pointer items-center gap-4 rounded-control border-0 bg-transparent py-2 pr-3 pl-2 text-left transition-colors hover:bg-surface-2"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base text-fg">{label}</span>
        {hint && <span className="text-xs text-fg-2">{hint}</span>}
      </span>
      <SwitchTrack checked={checked} />
    </button>
  );
}
