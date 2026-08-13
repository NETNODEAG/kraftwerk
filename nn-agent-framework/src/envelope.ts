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
    throw new Error("Envelope fehlt: kein ```json Codeblock in der finalen Antwort");
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fences[fences.length - 1][1]);
  } catch (err) {
    throw new Error(`Envelope ist kein gueltiges JSON: ${(err as Error).message}`);
  }

  if (raw.phase !== expectedPhase) {
    throw new Error(`Envelope meldet Phase "${raw.phase}", erwartet war "${expectedPhase}"`);
  }
  if (raw.status !== "ok" && raw.status !== "blocked") {
    throw new Error(`Envelope hat ungueltigen status "${raw.status}" (erlaubt: ok | blocked)`);
  }
  if (
    !Array.isArray(raw.artifacts) ||
    raw.artifacts.some((a) => typeof a !== "string")
  ) {
    throw new Error('Envelope-Feld "artifacts" muss ein String-Array sein');
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
Beende deine finale Antwort mit GENAU EINEM json-Codeblock (dem Envelope):

\`\`\`json
{"phase": "${phase}", "status": "ok", "artifacts": ["<geschriebene Dateien>"], "summary": "<ein Satz>"}
\`\`\`

Kannst du die Aufgabe nicht erfuellen, setze "status": "blocked" und ergaenze
ein Feld "reason". Vor dem Codeblock hoechstens ein Satz Text.
`.trim();

/** Gate failed: correct in the SAME session instead of a cold restart. */
export const correctionPrompt = (phase: string, failures: string[]) =>
  `
Der Orchestrator hat deine Phase "${phase}" geprueft. Folgende Checks sind
fehlgeschlagen:

${failures.map((f) => `- ${f}`).join("\n")}

Behebe genau diese Punkte (Dateien direkt bearbeiten).

${envelopeContract(phase)}
`.trim();
