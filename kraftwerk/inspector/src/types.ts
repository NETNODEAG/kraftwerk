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
  Agent,
  AgentDetail,
  AgentSummary,
} from "../../src/inspector/agents";
export type { SkillDetail, SkillInfo } from "../../src/inspector/skills";
export type { GitFile, GitStatus, GitDiff } from "../../src/inspector/git";
export type { AgentSearch, WorkspaceAgents } from "../../src/inspector/search";
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
export type { RepoInfo, ReposView } from "../../src/inspector/repos";
