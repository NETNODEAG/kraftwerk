/**
 * API payload types, re-exported from the server implementation in
 * ../../src/inspector/ (same package) — one source of truth, types only,
 * erased at build time.
 */
export type {
  RunStatus,
  GateView,
  PhaseView,
  FileView,
  RunListItem,
  RunDetail,
} from "../../src/inspector/runs";
export type {
  AgentInfo,
  StepInfo,
  WorkflowSummary,
  WorkflowDetail,
} from "../../src/inspector/workflows";
