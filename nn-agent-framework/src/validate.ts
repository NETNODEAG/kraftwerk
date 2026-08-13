import path from "node:path";
import { loadWorkflow } from "./yaml.js";

/**
 * Validate workflow files/folders without executing them: runs the full
 * loader (JSON Schema + semantic checks + referenced files). Returns the
 * number of failures. Used by the `validate` CLI subcommand
 * (`npm start -- validate <path> ...`) and runnable standalone
 * (`npm run validate -- <path> ...` in the framework).
 */
export async function validateWorkflows(paths: string[]): Promise<number> {
  let failures = 0;
  for (const p of paths) {
    try {
      const workflow = await loadWorkflow(p);
      console.log(`✔ ${p}: OK — workflow "${workflow.name}" (${workflow.description})`);
    } catch (err) {
      failures += 1;
      console.error(`✖ ${p}: ${(err as Error).message}`);
    }
  }
  return failures;
}

// Standalone entry: tsx src/validate.ts <path> [<path> ...]
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("Usage: npm run validate -- <workflow.yml | workflow-folder> ...");
    process.exit(1);
  }
  const failures = await validateWorkflows(paths);
  process.exit(failures > 0 ? 1 : 0);
}
