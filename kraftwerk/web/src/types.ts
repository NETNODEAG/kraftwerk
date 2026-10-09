/**
 * API payload types, re-exported from the server implementation in
 * ../../src/core/ (same package) — one source of truth, types only,
 * erased at build time.
 */
export type {
  RunStatus,
  GateView,
  PhaseView,
  FileView,
  RunListItem,
  RunDetail,
} from "../../src/core/runs";
export type {
  AgentInfo,
  StepInfo,
  WorkflowSummary,
  WorkflowDetail,
} from "../../src/core/workflows";
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
} from "../../src/core/chat/types";
export type {
  KnowledgeIndex,
  BundleDetail,
} from "../../src/core/knowledge";
export type {
  Agent,
  AgentDetail,
  AgentSummary,
} from "../../src/core/agents";
export type { SkillDetail, SkillInfo } from "../../src/core/skills";
export type { GitFile, GitStatus, GitDiff } from "../../src/core/git";
export type { AgentSearch, WorkspaceAgents } from "../../src/core/search";
export type {
  Routine,
  RoutineStatus,
} from "../../src/core/routines";
export type {
  BundleInfo,
  ConceptInfo,
  ConceptDetail,
  SourceEntry,
  VerifiedEntry,
  TrustTier,
} from "../../src/okf";
export type { RepoCommit, RepoDetail, RepoFile, RepoInfo, ReposView } from "../../src/core/repos";
export type { VibeableConfig, VibeableDev, VibeableEvent, VibeableInfo, VibeableStatus, VibeablesView } from "../../src/core/vibeables";
export type { LinkState, ProjectDetail, ProjectHit, ProjectLayout, ProjectLinks, ProjectStatus, ProjectSummary, ProjectsView, SystemOfRecord } from "../../src/core/projects";
export type { Notification, NotificationKind, NotificationsView } from "../../src/core/notifications";
export type { Channel, ChannelSummary } from "../../src/core/channels";
export type { Author } from "../../src/core/chat/types";
export type { AgentStatus } from "../../src/core/agent-status";
export type { AttentionItem, AttentionOwner, AttentionView } from "../../src/core/attention";
export type { FileEntry, FilesListing, FilesScopeInfo } from "../../src/core/files";

/** A channel as /api/channels returns it: the definition plus its transcript's chat id and live state. */
export type ChannelView = import("../../src/core/channels").Channel & { chatId: string; busy: boolean; awaitingApproval: boolean; updatedAt: string };
export type { DecisionView, DecisionRequest, DecisionAnswer, DecisionOption } from "../../src/core/decisions";
