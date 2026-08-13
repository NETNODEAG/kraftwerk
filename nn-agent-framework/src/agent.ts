import type { HarnessId } from "./harness.js";

/**
 * An agent is exactly four things:
 *
 *   persona     — WHO it is: the system prompt (role, voice, editorial rules)
 *   model       — WHAT thinks: the model id + optional effort level
 *   governance  — WHAT it may do: the allowed tools (capability boundary)
 *   harness     — WHERE it runs: the agent runtime (claude -p, codex exec, pi)
 *
 * Nothing else. The task an agent works on comes from the phase prompt at
 * call time (`run.agentPhase({ agent, prompt, gates })`), so one agent can
 * serve several phases. How an agent is executed (headless process, session
 * resume, envelope, gates) is entirely the framework's business — see
 * harness.ts, harnesses/, and run.ts.
 */

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentDefinition {
  /** Stable id, used in logs and trace.jsonl. */
  id: string;
  /** Human-readable role name, shown when the phase starts. */
  name: string;
  /** Model id in the harness's naming, e.g. "claude-opus-5" or "gpt-5.6-sol". */
  model: string;
  /** Reasoning effort for this agent. Omit for the model's default. */
  effort?: EffortLevel;
  /** System prompt: role, voice, and the rules this agent always applies. */
  persona: string;
  /** Governance: the only tools this agent is allowed to use. */
  tools: string[];
  /** Which runtime executes this agent. Default: "claude". */
  harness?: HarnessId;
}

export function defineAgent(agent: AgentDefinition): AgentDefinition {
  return agent;
}
