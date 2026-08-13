import { validateWorkflows } from "./validate.js";
import type { WorkflowDefinition } from "./workflow.js";

/**
 * CLI registry dispatch: one entry point, one name per workflow. A consumer's
 * whole entry file is one call:
 *
 *   runCli({ [contentWorkflow.name]: contentWorkflow });
 *
 *   npm start -- <workflow> "topic or source URL"
 *   npm start -- <workflow> --yes "..."       # auto-approve
 *   npm start -- <workflow> --verbose "..."   # + agent narration
 *   npm start -- validate <path> ...          # validate YAML workflows
 */
export function runCli(workflows: Record<string, WorkflowDefinition>): void {
  const usage: () => never = () => {
    console.error('Usage: npm start -- <workflow> [--yes] [--verbose] "<topic or source URL>"');
    console.error('       npm start -- validate <workflow.yml | workflow-folder> ...');
    console.error("\nAvailable workflows:");
    for (const wf of Object.values(workflows)) {
      console.error(`  ${wf.name.padEnd(12)} ${wf.description}`);
    }
    process.exit(1);
  };

  const main = async () => {
    const args = process.argv.slice(2);
    const autoApprove = args.includes("--yes");
    const verbose = args.includes("--verbose") || args.includes("-v");
    const positional = args.filter((a) => !["--yes", "--verbose", "-v"].includes(a));

    const [name, ...rest] = positional;

    // Reserved subcommand: validate YAML workflows without executing them.
    if (name === "validate") {
      if (rest.length === 0) usage();
      process.exit((await validateWorkflows(rest)) > 0 ? 1 : 0);
    }
    const workflow = name ? workflows[name] : undefined;
    if (!workflow) usage();

    const request = rest.join(" ").trim();
    if (!request) usage();

    await workflow.run({ request, autoApprove, verbose });
  };

  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
