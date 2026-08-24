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
export type {
  ChatAgentId,
  ChatScope,
  ChatMeta,
  ChatEvent,
  StoredChatEvent,
} from "../../src/inspector/chat/types";
export type {
  KnowledgeIndex,
  BundleDetail,
} from "../../src/inspector/knowledge";
export type {
  TeamMember,
  TeamMemberDetail,
} from "../../src/inspector/team";
export type {
  Routine,
  RoutineStatus,
} from "../../src/inspector/routines";
export type {
  BundleInfo,
  ConceptInfo,
  ConceptDetail,
  SourceEntry,
  VerifiedEntry,
  TrustTier,
} from "../../src/okf";
