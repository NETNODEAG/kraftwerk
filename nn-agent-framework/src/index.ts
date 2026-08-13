/**
 * nn-agent-framework — deterministic workflow-as-code over headless agent
 * harnesses. "Agent proposes, code disposes."
 *
 * An agent is persona + model/effort + tools + harness (defineAgent); the
 * Run executes it inside bounded phases (agentPhase/codePhase), judges the
 * result (envelope + gates), corrects in the same session, and accounts for
 * time/tokens/cost. Harnesses: claude -p (default), codex exec, pi.
 */

export { defineAgent, type AgentDefinition, type EffortLevel } from "./agent.js";
export {
  type AgentInvocation,
  type AgentResult,
  type Harness,
  type HarnessId,
  type TokenUsage,
} from "./harness.js";
export { harnessFor } from "./harnesses/registry.js";
export { Run, type RunOptions } from "./run.js";
export {
  correctionPrompt,
  envelopeContract,
  parseEnvelope,
  type Envelope,
} from "./envelope.js";
export { containsText, fileNonEmpty, slotsFilled, type Gate } from "./gates.js";
export {
  fmtDuration,
  fmtTokens,
  phaseStatsLine,
  summaryTable,
  totalIn,
  type PhaseStats,
  type RunTotals,
} from "./stats.js";
export { runStamp, type WorkflowDefinition, type WorkflowRunOptions } from "./workflow.js";
export { runCli } from "./cli.js";
export { loadWorkflow, loadWorkflowYaml } from "./yaml.js";
export { validateWorkflows } from "./validate.js";
