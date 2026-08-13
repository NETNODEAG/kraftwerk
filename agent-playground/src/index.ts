import path from "node:path";
import { loadWorkflow, runCli } from "nn-agent-framework";

// Workflows are YAML folders (workflow.yml + prompt files) — loaded and
// registered like any other WorkflowDefinition.
const workflowDir = (name: string) => path.join(import.meta.dirname, "workflows", name);

const tagline = await loadWorkflow(workflowDir("tagline"));
const pitch = await loadWorkflow(workflowDir("pitch"));

runCli({
  [tagline.name]: tagline,
  [pitch.name]: pitch,
});
