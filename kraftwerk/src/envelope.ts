/**
 * Typed JSON envelope: every agent phase must end its final message with one
 * fenced ```json block reporting what it did. The orchestrator parses and
 * validates it — the agent's prose is ignored, only the envelope (plus the
 * file gates) decides whether the phase passed.
 */

export interface Envelope {
  phase: string;
  status: "ok" | "blocked";
  artifacts: string[];
  summary?: string;
  reason?: string;
}

export function parseEnvelope(text: string, expectedPhase: string): Envelope {
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (fences.length === 0) {
    throw new Error("Envelope missing: no ```json code block in the final answer");
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fences[fences.length - 1][1]);
  } catch (err) {
    throw new Error(`Envelope is not valid JSON: ${(err as Error).message}`);
  }

  if (raw.phase !== expectedPhase) {
    throw new Error(`Envelope reports phase "${raw.phase}", expected "${expectedPhase}"`);
  }
  if (raw.status !== "ok" && raw.status !== "blocked") {
    throw new Error(`Envelope has invalid status "${raw.status}" (allowed: ok | blocked)`);
  }
  if (
    !Array.isArray(raw.artifacts) ||
    raw.artifacts.some((a) => typeof a !== "string")
  ) {
    throw new Error('Envelope field "artifacts" must be an array of strings');
  }

  return {
    phase: raw.phase,
    status: raw.status,
    artifacts: raw.artifacts as string[],
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
  };
}

/**
 * The output contract appended to every agent phase prompt. Owned by the
 * framework because `parseEnvelope` is what enforces it.
 */
export const envelopeContract = (phase: string) =>
  `
End your final answer with EXACTLY ONE json code block (the envelope):

\`\`\`json
{"phase": "${phase}", "status": "ok", "artifacts": ["<files written>"], "summary": "<one sentence>"}
\`\`\`

If you cannot complete the task, set "status": "blocked" and add a
"reason" field. At most one sentence of text before the code block.
`.trim();

/** Gate failed: correct in the SAME session instead of a cold restart. */
export const correctionPrompt = (phase: string, failures: string[]) =>
  `
The orchestrator checked your phase "${phase}". The following checks
failed:

${failures.map((f) => `- ${f}`).join("\n")}

Fix exactly these points (edit the files directly).

${envelopeContract(phase)}
`.trim();
