import type { AgentProtocol, Harness, HarnessId } from "../harness.js";
import { acpHarness } from "./acp.js";
import { claudeHarness } from "./claude.js";
import { codexHarness } from "./codex.js";
import { piHarness } from "./pi.js";

/**
 * Maps an agent's `harness` (+ `protocol`) to the adapter that runs it.
 * Default is claude over the CLI — an agent without a harness runs on
 * `claude -p`; `protocol: acp` drives the same harness over the Agent
 * Client Protocol instead.
 */

const HARNESSES: Partial<Record<HarnessId, Harness>> = {
  claude: claudeHarness,
  codex: codexHarness,
  pi: piHarness,
};

export function harnessFor(id: HarnessId = "claude", protocol: AgentProtocol = "cli"): Harness {
  if (protocol === "acp") return acpHarness(id);
  const harness = HARNESSES[id];
  if (!harness) {
    throw new Error(
      `harness "${id}" is not registered (available: ${Object.keys(HARNESSES).join(", ")})`
    );
  }
  return harness;
}
