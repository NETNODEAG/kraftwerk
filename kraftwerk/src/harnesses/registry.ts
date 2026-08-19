import type { Harness, HarnessId } from "../harness.js";
import { claudeHarness } from "./claude.js";
import { codexHarness } from "./codex.js";
import { piHarness } from "./pi.js";

/**
 * Maps an agent's `harness` field to the adapter that runs it.
 * Default is claude — an agent without a harness runs on `claude -p`.
 */

const HARNESSES: Partial<Record<HarnessId, Harness>> = {
  claude: claudeHarness,
  codex: codexHarness,
  pi: piHarness,
};

export function harnessFor(id: HarnessId = "claude"): Harness {
  const harness = HARNESSES[id];
  if (!harness) {
    throw new Error(
      `harness "${id}" is not registered (available: ${Object.keys(HARNESSES).join(", ")})`
    );
  }
  return harness;
}
