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
  Compaction,
  SessionFailure,
  StoredChatEvent,
  AgentCommand,
  Attachment,
  AuthStatus,
  ConfigOption,
  ElicitationField,
  PlanEntry,
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
export type { VibeableConfig, VibeableDev, VibeableEvent, VibeableInfo, VibeableStatus, VibeablesView } from "../../src/inspector/vibeables";
export type { LinkState, ProjectDetail, ProjectLinks, ProjectStatus, ProjectSummary, ProjectsView, SystemOfRecord } from "../../src/inspector/projects";
export type { Notification, NotificationKind, NotificationsView } from "../../src/inspector/notifications";
export type { Channel, ChannelSummary } from "../../src/inspector/channels";
export type { Author } from "../../src/inspector/chat/types";

/** A channel as /api/channels returns it: the definition plus its transcript's chat id and live state. */
export type ChannelView = import("../../src/inspector/channels").Channel & { chatId: string; busy: boolean; awaitingApproval: boolean; updatedAt: string };
