/**
 * The contract between the CLI registry and a concrete workflow (ADW).
 * A workflow owns its run directory, roster, prompts, and gates; the
 * framework only provides the phase runner and the CLI dispatch.
 */

export interface WorkflowRunOptions {
  request: string;
  autoApprove: boolean;
  verbose: boolean;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  run(opts: WorkflowRunOptions): Promise<void>;
}

/** Local-time run-folder stamp: "2026-08-13-1432-07" (sortable, no colons). */
export function runStamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}
