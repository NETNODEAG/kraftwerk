import type {
  AgentCommand,
  Attachment,
  ChatEvent,
  ConfigOption,
  ElicitationAnswer,
  ElicitationField,
  SessionFailure,
} from "./types.js";

/** An attachment as the backend gets it: where the file is, and what it is. */
export interface PromptFile extends Attachment {
  path: string;
}

/**
 * A chat backend is one live agent conversation: prompt() runs a full turn
 * (resolves when the agent finishes), streaming intermediate activity
 * through the hooks. ACP agents (claude, codex) keep a subprocess alive for
 * the whole chat; pi respawns per message and resumes via --session-id.
 */

export interface BackendHooks {
  /** Stream a thread event (text chunk, tool call, ...) to the session. */
  emit(ev: ChatEvent): void;
  /**
   * Surface a permission request to the user; resolves with the chosen
   * optionId, or null when the user (or a cancel) dismissed it.
   */
  askPermission(
    title: string,
    options: Array<{ optionId: string; name: string; kind?: string }>
  ): Promise<string | null>;
  /** The agent asks the user a question (form); resolves with the answer, or a decline/cancel. */
  askElicitation(message: string, fields: ElicitationField[]): Promise<ElicitationAnswer>;
}

/**
 * Optional per-chat model/effort overrides (from an agent definition).
 * Each backend maps them onto whatever its agent actually supports.
 */
export interface BackendTuning {
  model?: string;
  effort?: string;
  /** claude: restrict native skill discovery to these names (undefined = all). */
  skills?: string[];
  /** pi: skill folders to load explicitly via --skill. */
  skillDirs?: string[];
  /** claude: extra directories the session may work in (e.g. project root for run chats). */
  addDirs?: string[];
  /** The session's scratch folder (core/temp.ts): handed to the process as TMPDIR and KRAFTWERK_TEMP. */
  temp?: string;
  /** The agent this seat is (its slug), handed to the process as KRAFTWERK_AGENT, with KRAFTWERK_ACTOR = <slug>/<harness>; absent for a project assistant or Ralv. */
  agent?: string;
  /**
   * Nobody is watching this session live (routine runs). The backend selects
   * the harness's own hands-off permission mode — the harness keeps deciding
   * what still needs a human; kraftwerk never answers for one.
   */
  unattended?: boolean;
  /** ACP agents: the session id to continue (from ChatMeta.sessions) instead of opening a new one. */
  resume?: string;
}

/**
 * Who the process is, for the CLI it runs: `kraftwerk tasks pick`, `tasks log`,
 * `journal` and `knowledge put` read KRAFTWERK_AGENT / KRAFTWERK_ACTOR so an
 * agent never has to name itself. A seat that is no agent (a project
 * assistant, Ralv) is the actor `kraftwerk-chat/<harness>` — the name its
 * context already tells it to write with — and has no KRAFTWERK_AGENT, so
 * `tasks pick` still asks who picks.
 */
export const identityEnv = (harness: string, tuning: BackendTuning): Record<string, string> =>
  tuning.agent ? { KRAFTWERK_AGENT: tuning.agent, KRAFTWERK_ACTOR: `${tuning.agent}/${harness}` } : { KRAFTWERK_ACTOR: `kraftwerk-chat/${harness}` };

/**
 * How a turn ended. `failure` is the typed session failure the agent
 * attached to the turn's own outcome (a usage limit, a rate limit, a
 * provider error): ACP hands those back on the prompt response rather
 * than as a mid-turn notification, and without it the turn would look
 * like an ordinary empty `end_turn`.
 */
export interface TurnEnd {
  stopReason: string;
  failure?: SessionFailure;
}

export interface ChatBackend {
  /** The agent's own session id, when it has one to resume later (ACP agents). */
  sessionId?: string;
  /** This backend continues an earlier session: the agent still has the conversation in context. */
  resumed?: boolean;
  /** The resumed session turned out unusable at its first prompt — its id must not be resumed again. */
  resumeFailed?: boolean;
  /** Send one user message (plus files dropped into it); resolves with how the turn ended. */
  prompt(text: string, files?: PromptFile[]): Promise<TurnEnd>;
  /** Branch the conversation: a new session id with this session's history (ACP agents that offer session/fork). */
  fork?(): Promise<string>;
  /**
   * Hand a message into the running turn instead of queueing it as the
   * next prompt. "promptRequired": no turn is running — send it as a prompt.
   */
  steer?(text: string, files?: PromptFile[]): Promise<"injected" | "promptRequired">;
  /** Stop one background task without cancelling the turn. */
  stopTask?(taskId: string): Promise<void>;
  /** Change a session setting; resolves with the options as they now stand. */
  setConfig?(configId: string, value: string | boolean): Promise<ConfigOption[]>;
  /** Slash commands the agent offers, as last announced. */
  commands?: AgentCommand[];
  /** Interrupt the current turn (the running prompt() still resolves). */
  cancel(): void;
  /** Kill the agent subprocess, if any. */
  dispose(): void;
}
