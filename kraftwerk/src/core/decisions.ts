import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * A human decision inside a run. A step that needs one writes
 * decision-request.json into the run folder and waits; the run page renders
 * it as a form; the answer lands next to it as decision.json (or the file
 * the request names) — a plain artifact, so the waiting step and any gate
 * read it like every other file. Nothing here answers on anyone's behalf:
 * the answer is always a person's click, and it is written once.
 */

export const DECISION_REQUEST = "decision-request.json";
export const DECISION_DEFAULT_FILE = "decision.json";

export interface DecisionOption {
  value: string;
  label?: string;
}

export interface DecisionRequest {
  title?: string;
  prompt?: string;
  options: DecisionOption[];
  /** Free text next to the choice: optional (default), required, or none. */
  note?: "optional" | "required" | false;
  /** Answer file name in the run folder (default decision.json). */
  file?: string;
}

export interface DecisionAnswer {
  decision: string;
  note?: string;
  decidedAt: string;
  by: "human";
}

export interface DecisionView {
  request: DecisionRequest;
  /** Where the answer goes (or went). */
  file: string;
  answer?: DecisionAnswer;
}

const safeAnswerFile = (name: unknown): string | null => {
  const s = typeof name === "string" && name.trim() ? name.trim() : DECISION_DEFAULT_FILE;
  if (s !== path.basename(s) || !s.endsWith(".json") || s === DECISION_REQUEST) return null;
  return s;
};

/** Parse decision-request.json leniently: options may be strings or {value,label}. */
function normalizeRequest(raw: unknown): { request: DecisionRequest; file: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const options = (Array.isArray(r.options) ? r.options : [])
    .map((o): DecisionOption | null => {
      if (typeof o === "string" && o.trim()) return { value: o.trim() };
      if (o && typeof o === "object" && typeof (o as DecisionOption).value === "string" && (o as DecisionOption).value.trim()) {
        const v = o as DecisionOption;
        return { value: v.value.trim(), ...(typeof v.label === "string" ? { label: v.label } : {}) };
      }
      return null;
    })
    .filter(Boolean) as DecisionOption[];
  if (options.length === 0) return null;
  const file = safeAnswerFile(r.file);
  if (!file) return null;
  const note = r.note === "required" || r.note === false ? r.note : "optional";
  return {
    request: {
      ...(typeof r.title === "string" ? { title: r.title } : {}),
      ...(typeof r.prompt === "string" ? { prompt: r.prompt } : {}),
      options,
      note,
      file,
    },
    file,
  };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** The run's decision, if a step asked for one: the request and, once given, the answer. */
export async function readDecision(runDir: string): Promise<DecisionView | undefined> {
  const parsed = normalizeRequest(await readJson(path.join(runDir, DECISION_REQUEST)));
  if (!parsed) return undefined;
  const raw = await readJson(path.join(runDir, parsed.file));
  const answer =
    raw && typeof raw === "object" && typeof (raw as DecisionAnswer).decision === "string"
      ? {
          decision: (raw as DecisionAnswer).decision,
          ...(typeof (raw as DecisionAnswer).note === "string" && (raw as DecisionAnswer).note ? { note: (raw as DecisionAnswer).note } : {}),
          decidedAt: typeof (raw as DecisionAnswer).decidedAt === "string" ? (raw as DecisionAnswer).decidedAt : "",
          by: "human" as const,
        }
      : undefined;
  return { request: parsed.request, file: parsed.file, ...(answer ? { answer } : {}) };
}

/** True while a request is on disk and nothing has answered it yet. */
export async function awaitingDecision(runDir: string): Promise<boolean> {
  const d = await readDecision(runDir);
  return !!d && !d.answer;
}

export type DecideResult =
  | { ok: true; answer: DecisionAnswer }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** Write a person's answer — once, and only one of the offered options. */
export async function decide(runDir: string, body: { decision?: unknown; note?: unknown }): Promise<DecideResult> {
  const d = await readDecision(runDir);
  if (!d) return { ok: false, status: 404, error: "this run is not asking for a decision" };
  if (d.answer) return { ok: false, status: 409, error: `already decided: ${d.answer.decision}` };
  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  if (!d.request.options.some((o) => o.value === decision)) {
    return { ok: false, status: 400, error: `decision must be one of: ${d.request.options.map((o) => o.value).join(", ")}` };
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (d.request.note === "required" && !note) return { ok: false, status: 400, error: "a note is required for this decision" };
  const answer: DecisionAnswer = { decision, ...(note ? { note } : {}), decidedAt: new Date().toISOString(), by: "human" };
  try {
    // wx: two people answering at once — the second one loses, nothing is overwritten.
    await fs.writeFile(path.join(runDir, d.file), JSON.stringify(answer, null, 2) + "\n", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, status: 409, error: "already decided" };
    throw err;
  }
  return { ok: true, answer };
}
