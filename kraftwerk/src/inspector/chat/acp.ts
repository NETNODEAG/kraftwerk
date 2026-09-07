import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  RequestError,
  type Client,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  adapterEnv,
  airMeta,
  connectAcp,
  EXT_METHODS,
  EXT_NOTIFICATIONS,
  fileChangeReportMeta,
  openSession,
  withAdapter,
  type AcpAgent,
  type AcpExtensionNotification,
} from "../../acp.js";
import type { BackendHooks, BackendTuning, ChatBackend, PromptFile } from "./backend.js";
import { unattendedMode } from "./permissions.js";
import type {
  AgentCommand,
  AuthStatus,
  ChatEvent,
  Compaction,
  ConfigOption,
  ElicitationField,
  PlanEntry,
  SessionFailure,
} from "./types.js";

/**
 * ACP-backed chat: spawn an adapter (claude-agent-acp / codex-acp) as a
 * subprocess, speak Agent Client Protocol over its stdio, and translate
 * session/update notifications into chat events. One subprocess lives for
 * the whole chat; the ACP session id carries the conversation and is
 * handed back so a later backend (after a restart, or the idle reaper)
 * resumes it. The adapter plumbing is shared with the workflow ACP
 * harness (src/acp.ts).
 *
 * Beyond text and tool calls the chat takes everything the adapters
 * offer that a thread can show or a human can act on: subagents as their
 * own sessions and background work as async tasks (AIR extension),
 * session failures with a recommended action, the agent's plan, context
 * and cost usage, its slash commands, its session settings, who it is
 * signed in as, the files it says it changed, and its questions (form
 * elicitations) — plus steering a message into the running turn.
 */

function contentText(content: ContentBlock): string {
  return content.type === "text" ? content.text : "";
}

/** The compaction facts on a synthetic "Compact conversation" tool call, if it is one. */
function compactionOf(meta: unknown): Compaction | undefined {
  const m = (meta as { contextCompaction?: Record<string, unknown> } | null | undefined)?.contextCompaction;
  if (!m || typeof m !== "object") return undefined;
  const c: Compaction = {};
  if (m.trigger === "manual" || m.trigger === "automatic") c.trigger = m.trigger;
  if (typeof m.preTokens === "number") c.preTokens = m.preTokens;
  if (typeof m.postTokens === "number") c.postTokens = m.postTokens;
  if (typeof m.durationMs === "number") c.durationMs = m.durationMs;
  if (typeof m.error === "string") c.error = m.error;
  return c;
}

const FAILURE_CATEGORIES = new Set(["connection", "access", "limit", "request", "service", "unknown"]);
const FAILURE_ACTIONS = new Set(["retry", "login", "new_session"]);

/** The session failure a `session_info_update` carries, if it is one (AIR `sessionFailure` in `_meta`). */
export function failureOf(meta: unknown): SessionFailure | undefined {
  const f = airMeta<Record<string, unknown>>(meta, "sessionFailure");
  if (!f || typeof f.id !== "string" || typeof f.title !== "string") return undefined;
  const actions = Array.isArray(f.actions) ? f.actions.filter((a): a is SessionFailure["actions"][number] => FAILURE_ACTIONS.has(String(a))) : [];
  return {
    id: f.id,
    revision: typeof f.revision === "number" ? f.revision : 1,
    category: FAILURE_CATEGORIES.has(String(f.category)) ? (f.category as SessionFailure["category"]) : "unknown",
    severity: f.severity === "warning" ? "warning" : "error",
    title: f.title,
    ...(typeof f.details === "string" && f.details ? { details: f.details } : {}),
    ...(typeof f.reason === "string" && f.reason ? { reason: f.reason } : {}),
    actions,
  };
}

/** The file change report a `session_info_update` carries, if it is one (AIR `agentFileChangeReport`). */
export function filesChangedOf(meta: unknown): Extract<ChatEvent, { type: "files_changed" }> | undefined {
  const r = airMeta<Record<string, unknown>>(meta, "agentFileChangeReport");
  if (!r || typeof r.status !== "string") return undefined;
  if (r.status === "reported") {
    const paths = Array.isArray(r.paths) ? r.paths.filter((p): p is string => typeof p === "string") : [];
    return {
      type: "files_changed",
      paths,
      complete: r.declaredComplete === true && r.truncated !== true,
      ...(typeof r.uncertainty === "string" && r.uncertainty ? { uncertainty: r.uncertainty } : {}),
    };
  }
  return { type: "files_changed", paths: [], complete: false, unavailable: typeof r.reason === "string" ? r.reason : r.status };
}

const PLAN_PRIORITIES = new Set(["high", "medium", "low"]);
const PLAN_STATUSES = new Set(["pending", "in_progress", "completed"]);

function planEntries(entries: Array<{ content: string; priority: string; status: string }>): PlanEntry[] {
  return entries.map((e) => ({
    content: e.content,
    priority: PLAN_PRIORITIES.has(e.priority) ? (e.priority as PlanEntry["priority"]) : "medium",
    status: PLAN_STATUSES.has(e.status) ? (e.status as PlanEntry["status"]) : "pending",
  }));
}

/** The protocol's config options -> the chat's (select choices flattened, groups kept as a label). */
export function configOptions(options: SessionConfigOption[] | null | undefined): ConfigOption[] {
  const out: ConfigOption[] = [];
  for (const o of options ?? []) {
    const base = {
      id: o.id,
      name: o.name,
      ...(o.description ? { description: o.description } : {}),
      ...(o.category ? { category: String(o.category) } : {}),
    };
    if (o.type === "boolean") out.push({ ...base, type: "boolean", value: o.currentValue });
    else if (o.type === "select") {
      const choices: Extract<ConfigOption, { type: "select" }>["choices"] = [];
      for (const item of o.options as Array<Record<string, unknown>>) {
        if (Array.isArray(item.options)) {
          for (const c of item.options as Array<{ value: string; name: string; description?: string | null }>) {
            choices.push({ value: c.value, name: c.name, ...(c.description ? { description: c.description } : {}), group: String(item.name ?? item.group) });
          }
        } else {
          const c = item as { value: string; name: string; description?: string | null };
          choices.push({ value: c.value, name: c.name, ...(c.description ? { description: c.description } : {}) });
        }
      }
      out.push({ ...base, type: "select", value: o.currentValue, choices });
    }
  }
  return out;
}

/** The adapter's auth status notification -> the chat's. */
export function authStatusOf(params: unknown): AuthStatus | undefined {
  const a = (params as { authStatus?: Record<string, unknown> } | null | undefined)?.authStatus;
  if (!a || typeof a.label !== "string") return undefined;
  const kinds = new Set(["account", "api_key", "gateway", "external", "none"]);
  const account = (a.account ?? {}) as Record<string, unknown>;
  return {
    kind: kinds.has(String(a.kind)) ? (a.kind as AuthStatus["kind"]) : "external",
    label: a.label,
    ...(typeof a.detail === "string" && a.detail ? { detail: a.detail } : {}),
    ...(typeof account.email === "string" ? { email: account.email } : {}),
    ...(typeof account.organization === "string" ? { organization: account.organization } : {}),
    ...(typeof account.plan === "string" ? { plan: account.plan } : {}),
  };
}

/**
 * A form elicitation's schema -> fields the UI can render. Claude's
 * AskUserQuestion arrives as one select (oneOf) per question plus an
 * "Other" text field flagged as its custom answer; MCP elicitations bring
 * plain string/number/boolean/enum properties. Unknown property types
 * degrade to text.
 */
export function elicitationFields(schema: unknown): ElicitationField[] {
  const s = schema as { properties?: Record<string, Record<string, unknown>>; required?: string[] | null } | undefined;
  const required = new Set(s?.required ?? []);
  const fields: ElicitationField[] = [];
  const option = (o: unknown): { value: string; label: string; description?: string } | null => {
    if (typeof o === "string") return { value: o, label: o };
    const e = o as { const?: unknown; title?: unknown; description?: unknown };
    if (typeof e?.const !== "string") return null;
    return { value: e.const, label: typeof e.title === "string" ? e.title : e.const, ...(typeof e.description === "string" ? { description: e.description } : {}) };
  };
  for (const [key, p] of Object.entries(s?.properties ?? {})) {
    const common = {
      key,
      ...(typeof p.title === "string" ? { title: p.title } : {}),
      ...(typeof p.description === "string" ? { description: p.description } : {}),
      ...(required.has(key) ? { required: true } : {}),
    };
    const meta = (p._meta ?? {}) as Record<string, Record<string, unknown>>;
    const custom = Object.values(meta).some((m) => m && typeof m === "object" && m.isCustomAnswer === true);
    if (p.type === "boolean") fields.push({ ...common, kind: "boolean" });
    else if (p.type === "number" || p.type === "integer") fields.push({ ...common, kind: "number" });
    else if (p.type === "array") {
      const items = (p.items ?? {}) as { enum?: unknown[]; anyOf?: unknown[] };
      const options = (items.anyOf ?? items.enum ?? []).map(option).filter((o): o is NonNullable<typeof o> => !!o);
      fields.push({ ...common, kind: options.length ? "multiselect" : "text", ...(options.length ? { options } : {}) });
    } else {
      const raw = (p.oneOf ?? p.enum) as unknown[] | undefined;
      const options = Array.isArray(raw) ? raw.map(option).filter((o): o is NonNullable<typeof o> => !!o) : [];
      fields.push({ ...common, kind: options.length ? "select" : "text", ...(options.length ? { options } : {}), ...(custom ? { custom: true } : {}) });
    }
  }
  return fields;
}

/**
 * One standard session update -> the chat event it means, or null for
 * updates that carry no thread content (mode updates, ...).
 * Updates from a session other than `root` come from a subagent and are
 * tagged with that child's session id.
 */
export function translateUpdate(root: string, params: SessionNotification): ChatEvent | null {
  const u = params.update;
  const sub = params.sessionId !== root ? { subagent: params.sessionId } : {};
  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const text = contentText(u.content);
      return text ? { type: "text", text, ...sub } : null;
    }
    case "agent_thought_chunk": {
      const text = contentText(u.content);
      return text ? { type: "thought", text, ...sub } : null;
    }
    case "tool_call": {
      const compaction = compactionOf(u._meta);
      return {
        type: "tool_call",
        callId: u.toolCallId,
        title: u.title,
        kind: u.kind ?? undefined,
        status: u.status ?? undefined,
        ...sub,
        ...(compaction ? { compaction } : {}),
      };
    }
    case "tool_call_update": {
      const compaction = compactionOf(u._meta);
      return {
        type: "tool_update",
        callId: u.toolCallId,
        title: u.title ?? undefined,
        status: u.status ?? undefined,
        ...sub,
        ...(compaction ? { compaction } : {}),
      };
    }
    // A subagent's plan is its own business; the thread shows the main agent's.
    case "plan":
      return params.sessionId !== root ? null : { type: "plan", entries: planEntries(u.entries) };
    case "plan_update":
      // Only the item form is a checklist; a plan as file or markdown has no thread rendering yet.
      return params.sessionId !== root || u.plan.type !== "items" ? null : { type: "plan", entries: planEntries(u.plan.entries) };
    case "plan_removed":
      return params.sessionId !== root ? null : { type: "plan", entries: null };
    case "usage_update":
      return params.sessionId !== root
        ? null
        : { type: "usage", used: u.used, size: u.size, ...(typeof u.cost?.amount === "number" ? { costUsd: u.cost.amount } : {}) };
    case "available_commands_update": {
      const commands: AgentCommand[] = u.availableCommands.map((c) => ({
        name: c.name,
        description: c.description,
        ...(c.input && "hint" in c.input && typeof c.input.hint === "string" ? { hint: c.input.hint } : {}),
      }));
      return params.sessionId !== root ? null : { type: "commands", commands };
    }
    case "config_option_update":
      return params.sessionId !== root ? null : { type: "config", options: configOptions(u.configOptions) };
    case "session_info_update": {
      // Titles and timestamps carry nothing for the thread; failures and file reports do.
      const failure = failureOf(u._meta);
      if (failure) return { type: "failure", ...failure };
      return filesChangedOf(u._meta) ?? null;
    }
    default:
      return null;
  }
}

/** One extension update (subagent / async task lifecycle) -> its chat event. */
export function translateExtension(n: AcpExtensionNotification): ChatEvent | null {
  const u = n.update;
  switch (u.sessionUpdate) {
    case "subagent_spawned":
      return { type: "subagent", sessionId: u.subagentSessionId, name: u.name, task: u.task };
    case "subagent_state_update":
      return { type: "subagent_state", sessionId: u.subagentSessionId, state: u.state };
    case "async_task_spawned":
      return {
        type: "task",
        taskId: u.asyncTaskId,
        name: u.name,
        taskType: u.taskType,
        description: u.description,
        ...(u.toolCallId ? { toolCallId: u.toolCallId } : {}),
        ...(u.canStop ? { canStop: true } : {}),
      };
    case "async_task_progress":
      return {
        type: "task_update",
        taskId: u.asyncTaskId,
        ...(u.description ? { description: u.description } : {}),
        ...(u.summary ? { summary: u.summary } : {}),
        ...(u.outputFilePath ? { outputFilePath: u.outputFilePath } : {}),
      };
    case "async_task_state_update":
      return {
        type: "task_update",
        taskId: u.asyncTaskId,
        state: u.state,
        ...(u.summary ? { summary: u.summary } : {}),
        ...(u.outputFilePath ? { outputFilePath: u.outputFilePath } : {}),
      };
    default:
      return null;
  }
}

/** Text files this large and smaller go into the prompt whole; bigger ones are referenced by path. */
const INLINE_TEXT_LIMIT = 200_000;
const TEXT_MIME = /^(text\/|application\/(json|xml|yaml|x-yaml|javascript|typescript|toml|sql)\b)/;

/**
 * A message with its files as ACP prompt blocks: images as image blocks
 * (the agent sees the screenshot), text files as embedded resources, and
 * anything else as a line naming the path — every file is on disk under
 * the chat, so the agent can open it itself.
 */
export async function promptBlocks(text: string, files: PromptFile[] = []): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  const mentions: string[] = [];
  for (const f of files) {
    try {
      if (f.mimeType.startsWith("image/")) {
        const data = await fs.readFile(f.path);
        blocks.push({ type: "image", mimeType: f.mimeType, data: data.toString("base64") });
        mentions.push(`${f.name} (image, ${f.path})`);
      } else if (TEXT_MIME.test(f.mimeType) && f.size <= INLINE_TEXT_LIMIT) {
        const content = await fs.readFile(f.path, "utf8");
        blocks.push({ type: "resource", resource: { uri: pathToFileURL(f.path).href, mimeType: f.mimeType, text: content } });
        mentions.push(`${f.name} (${f.path})`);
      } else {
        mentions.push(`${f.name} (${f.mimeType}, ${f.path})`);
      }
    } catch {
      mentions.push(`${f.name} (could not be read: ${f.path})`);
    }
  }
  const body = mentions.length ? `${text}\n\nAttached files:\n${mentions.map((m) => `- ${m}`).join("\n")}` : text;
  return [{ type: "text", text: body }, ...blocks];
}

/** The agent's own sessions in `cwd` (newest first), from a short-lived adapter. */
export async function listAgentSessions(
  agent: AcpAgent,
  cwd: string
): Promise<Array<{ sessionId: string; title?: string; updatedAt?: string; cwd: string }>> {
  return withAdapter(agent, cwd, async (conn) => {
    const res = await conn.listSessions({ cwd });
    return res.sessions
      .map((s) => ({
        sessionId: s.sessionId,
        cwd: s.cwd,
        ...(s.title ? { title: s.title } : {}),
        ...(s.updatedAt ? { updatedAt: s.updatedAt } : {}),
      }))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  });
}

/** Remove one of the agent's sessions for good (its transcript on disk), from a short-lived adapter. */
export async function deleteAgentSession(agent: AcpAgent, cwd: string, sessionId: string): Promise<void> {
  await withAdapter(agent, cwd, async (conn) => {
    await conn.deleteSession({ sessionId });
  });
}

export async function startAcpBackend(
  agent: AcpAgent,
  cwd: string,
  hooks: BackendHooks,
  tuning: BackendTuning = {}
): Promise<ChatBackend> {
  let dead = false;
  // Set once the session is open; updates before that belong to nobody.
  let sessionId = "";
  // Usage arrives after nearly every chunk; the thread keeps a step per
  // percent of the window and every cost total (turn ends), not each tick.
  let usagePercent = -1;
  const client: Client = {
    sessionUpdate(params: SessionNotification): void {
      const ev = translateUpdate(sessionId, params);
      if (!ev) return;
      if (ev.type === "commands") backend.commands = ev.commands;
      if (ev.type === "usage") {
        const pct = ev.size > 0 ? Math.floor((100 * ev.used) / ev.size) : 0;
        if (ev.costUsd == null && pct === usagePercent) return;
        usagePercent = pct;
      }
      hooks.emit(ev);
    },
    async requestPermission(
      params: RequestPermissionRequest
    ): Promise<RequestPermissionResponse> {
      const optionId = await hooks.askPermission(
        params.toolCall.title ?? params.toolCall.toolCallId,
        params.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind }))
      );
      return optionId
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } };
    },
    async createElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
      // Only forms: a url elicitation would need a browser on the user's side.
      if (params.mode !== "form") return { action: "decline" };
      const answer = await hooks.askElicitation(params.message, elicitationFields(params.requestedSchema));
      return answer.action === "accept" ? { action: "accept", content: answer.content } : { action: answer.action };
    },
    async extNotification(method: string, params: Record<string, unknown>): Promise<void> {
      if (method === EXT_NOTIFICATIONS.authStatus) {
        const auth = authStatusOf(params);
        if (auth) hooks.emit({ type: "auth", ...auth });
      }
    },
  };

  const { child, conn } = await connectAcp(agent, {
    cwd,
    env: adapterEnv(agent, tuning),
    client,
    clientName: "kraftwerk-inspector",
    elicitation: true,
    onExtension: (n) => {
      const ev = translateExtension(n);
      if (ev) hooks.emit(ev);
    },
    onError: (err) => {
      dead = true;
      hooks.emit({ type: "error", message: `could not start the ${agent} agent: ${err.message}` });
    },
    onClose: (code, stderr) => {
      dead = true;
      if (code !== 0 && code !== null) {
        hooks.emit({
          type: "error",
          message: `${agent} agent exited (code ${code})${stderr ? `: ${stderr.slice(-500)}` : ""}`,
        });
      }
    },
  });
  // Claude-only session options ride on _meta.claudeCode.options (the
  // adapter spreads them into the Agent SDK options): model override,
  // skill allowlist (undefined = all discovered skills), extra work dirs.
  const claudeOptions: Record<string, unknown> = {
    ...(tuning.model ? { model: tuning.model } : {}),
    ...(tuning.skills ? { skills: tuning.skills } : {}),
    ...(tuning.addDirs?.length ? { additionalDirectories: tuning.addDirs } : {}),
    // Chrome browser tools when available (needs subscription auth; a
    // no-op on API-key auth, where Claude Code keeps the integration off).
    extraArgs: { chrome: null },
  };
  const sessionReq = {
    cwd,
    mcpServers: [],
    ...(agent === "claude" && Object.keys(claudeOptions).length
      ? { _meta: { claudeCode: { options: claudeOptions } } }
      : {}),
  };
  const session = await openSession(conn, sessionReq, tuning.resume);
  sessionId = session.sessionId;
  if (session.resumeError) {
    hooks.emit({
      type: "error",
      message: `could not resume the previous ${agent} session (${session.resumeError}) — starting a fresh one; the agent gets the conversation so far as context, not as memory`,
    });
  }
  if (session.configOptions?.length) hooks.emit({ type: "config", options: configOptions(session.configOptions) });
  if (tuning.unattended) {
    // Nobody is watching: keep the harness's configured mode unless it is
    // one that never asks (see unattendedMode). The harness keeps deciding
    // which calls reach a human; kraftwerk only rules out "never ask".
    const modeId = unattendedMode(agent, session.modes?.currentModeId);
    if (modeId) {
      // A mode the adapter does not offer must not kill the session: the
      // harness default applies, and the thread shows why.
      await conn.setSessionMode({ sessionId, modeId }).catch((err: Error) => {
        hooks.emit({
          type: "error",
          message: `could not select the ${modeId} mode for this unattended session (${err.message}) — the ${agent} default applies`,
        });
      });
    }
  }

  const fail = (err: unknown, what: string): never => {
    if (err instanceof RequestError) throw new Error(`${agent} agent ${what}: ${err.message}`);
    throw err;
  };
  let turns = 0;
  const backend: ChatBackend = {
    sessionId,
    resumed: session.resumed,
    async prompt(text: string, files?: PromptFile[]): Promise<string> {
      if (dead) throw new Error(`${agent} agent process is gone — start a new chat`);
      try {
        const res = await conn.prompt({
          sessionId,
          prompt: await promptBlocks(text, files),
          // Ask for the list of files this turn changed (arrives as a files_changed event).
          _meta: fileChangeReportMeta(randomUUID()),
        });
        turns++;
        return res.stopReason;
      } catch (err) {
        // A resumed session that cannot even take its first prompt (the
        // agent's transcript is gone) must not be resumed again.
        if (session.resumed && turns === 0) backend.resumeFailed = true;
        return fail(err, "");
      }
    },
    async fork(): Promise<string> {
      if (dead) throw new Error(`${agent} agent process is gone`);
      try {
        const res = await conn.unstable_forkSession({ sessionId, ...sessionReq });
        return res.sessionId;
      } catch (err) {
        return fail(err, "cannot fork this session");
      }
    },
    async steer(text: string, files?: PromptFile[]): Promise<"injected" | "promptRequired"> {
      if (dead) throw new Error(`${agent} agent process is gone`);
      try {
        const res = await conn.extMethod(EXT_METHODS.steer, {
          sessionId,
          prompt: await promptBlocks(text, files),
          // Never start a turn behind kraftwerk's back: it owns the turn bookkeeping.
          _meta: { steering: { idleBehavior: "promptRequired" } },
        });
        return res.outcome === "promptRequired" ? "promptRequired" : "injected";
      } catch (err) {
        return fail(err, "cannot steer");
      }
    },
    async stopTask(taskId: string): Promise<void> {
      if (dead) throw new Error(`${agent} agent process is gone`);
      try {
        await conn.extMethod(EXT_METHODS.stopAsyncTask, { sessionId, asyncTaskId: taskId });
      } catch (err) {
        fail(err, "cannot stop the task");
      }
    },
    async setConfig(configId: string, value: string | boolean): Promise<ConfigOption[]> {
      if (dead) throw new Error(`${agent} agent process is gone`);
      try {
        const res = await conn.setSessionConfigOption(
          typeof value === "boolean" ? { sessionId, configId, type: "boolean", value } : { sessionId, configId, value }
        );
        const options = configOptions(res.configOptions);
        hooks.emit({ type: "config", options });
        return options;
      } catch (err) {
        return fail(err, "refused the setting");
      }
    },
    cancel(): void {
      if (!dead) void conn.cancel({ sessionId }).catch(() => {});
    },
    dispose(): void {
      if (dead) return;
      // Let the adapter close the session cleanly; the process goes either way.
      const kill = () => {
        if (!dead) child.kill("SIGTERM");
      };
      const timer = setTimeout(kill, 1500);
      timer.unref?.();
      void conn
        .closeSession({ sessionId })
        .catch(() => {})
        .finally(() => {
          clearTimeout(timer);
          kill();
        });
    },
  };
  return backend;
}
