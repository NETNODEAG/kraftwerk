import type { ReactNode } from "react";

/**
 * Small building blocks the agent screens share: row sublines, chip and
 * checklist wrappers, the code textarea style.
 */

/** The line under a profile row's title. */
export const SUB = "text-xs leading-[1.5] text-fg-2 [&_a]:text-inherit [&_code]:text-2xs";


export function Chips({ children }: { children: ReactNode }) {
  return <span className="mt-[3px] flex flex-wrap gap-1.5">{children}</span>;
}

/** A checklist of things to connect: workflows, bundles, apps, skills. */
export function Checks({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[7px] py-1">{children}</div>;
}

/** Markdown and prompts are edited as code. */
export const CODE_AREA = "resize-y font-mono text-[12.5px] leading-[1.65]";
