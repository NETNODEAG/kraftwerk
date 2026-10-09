import { promises as fs } from "node:fs";
import path from "node:path";
import * as z from "zod";
import { getAgent } from "../../core/agents.js";
import {
  answerElicitation,
  cancelChat,
  createChat,
  deleteChat,
  forkChat,
  getChat,
  listAgentSessionsFor,
  listChats,
  postMessage,
  renameChat,
  resetSession,
  resolvePermission,
  setChatConfig,
  setChatVibeable,
  steerChat,
  stopChatTask,
  subscribeChat,
} from "../../core/chat/sessions.js";
import { attachmentPath, saveAttachment } from "../../core/chat/store.js";
import type { ChatAgentId, ChatScope } from "../../core/chat/types.js";
import { getProject } from "../../core/projects.js";
import { MIME } from "./mime.js";
import { projectErrors } from "./projects.js";
import { ApiError, fail, readRawBody, reply, route, type Ctx } from "./router.js";

const AGENTS: readonly string[] = ["claude", "codex", "pi"];

/** A chat id that names no chat folder (or a malformed one) is a 400. */
const validChat = <T>(p: Promise<T>, message = "invalid chat id"): Promise<T> =>
  p.catch((err) => {
    throw err instanceof ApiError ? err : new ApiError(400, message);
  });

/** Sessions report refusals as `{error, status?}`; the success value is the chat's meta. */
const metaOf = <M>(result: { error?: string; status?: number; meta?: M }): M => (result.error ? fail(result.status ?? 400, result.error) : (result.meta as M));

/** A message or steer: text plus references to files already uploaded (chats.attach). */
const Said = z.object({
  text: z.string().default(""),
  attachments: z.array(z.object({ name: z.string(), mimeType: z.string(), size: z.number().default(0) })).default([]),
});

/** Where a new chat runs; unknown kinds fall back to a general chat. */
const NewChat = z.object({
  agent: z.string().optional(),
  scope: z.object({ kind: z.string(), runId: z.string().optional(), bundle: z.string().optional(), slug: z.string().optional() }).optional(),
  resume: z.string().optional(),
});

/** An action on a running chat: `{ok}` when it went through, 409 with the reason when the chat refused. */
const act = <const N extends string, const P extends string, S extends z.ZodType>(
  name: N,
  path: P,
  summary: string,
  body: S,
  run: (c: Ctx<z.output<S>>, body: z.output<S>) => Promise<{ error?: string }>,
) =>
  route({ name, method: "POST", path, summary, errors: 400, body }, async (c) => {
    const result = await run(c as Ctx<z.output<S>>, await c.body<z.output<S>>());
    return result.error ? reply(409, result as { error: string }) : { ok: true as const };
  });

const textOf = (body: z.output<typeof Said>): string => {
  const text = body.text.trim();
  if (!text && body.attachments.length === 0) fail(400, "text is required");
  return text || "(see attached)";
};

/** The scope a new chat runs in; agent and project chats take their harness from the definition, not the caller. */
async function scopeOf(body: z.output<typeof NewChat>): Promise<{ agent: string; scope: ChatScope }> {
  const s = body.scope;
  if (s?.kind === "agent" && s.slug) {
    const def = await getAgent(s.slug).catch(() => null);
    if (!def) fail(404, "agent not found");
    return { agent: def.harness, scope: { kind: "agent", slug: def.slug } };
  }
  if (s?.kind === "project" && s.slug) {
    // A project chat needs its folder; a missing one is a 404 here, not a chat that apologizes.
    const found = await getProject(s.slug).catch((err: Error) => {
      throw new ApiError(projectErrors(err.message), err.message);
    });
    if (!found) fail(404, "project not found");
    return { agent: found.harness, scope: { kind: "project", slug: found.slug } };
  }
  const agent = body.agent ?? "";
  if (s?.kind === "run" && s.runId) return { agent, scope: { kind: "run", runId: s.runId } };
  if (s?.kind === "kraftwerk") return { agent, scope: { kind: "kraftwerk" } };
  if (s?.kind === "knowledge") return { agent, scope: { kind: "knowledge", ...(s.bundle ? { bundle: s.bundle } : {}) } };
  return { agent, scope: { kind: "general" } };
}

/** Chats: ACP sessions with a coding agent, their event stream, and what a person does in them. */
export const chatRoutes = [
  route({ name: "chats.list", method: "GET", path: "/api/chats", summary: "every chat with its live state" }, async () => ({ chats: await listChats() })),
  route({ name: "chats.create", method: "POST", path: "/api/chats", summary: "start a chat {agent, scope, resume?}", body: NewChat }, async (c) => {
    // `resume` continues one of the agent's own sessions (see agents.sessions).
    const body = await c.body();
    const { agent, scope } = await scopeOf(body);
    if (!AGENTS.includes(agent)) fail(400, "agent must be claude, codex, or pi");
    try {
      return await createChat({ agent: agent as ChatAgentId, scope, ...(body.resume ? { resume: body.resume } : {}) });
    } catch (err) {
      throw new ApiError(400, (err as Error).message);
    }
  }),
  route({ name: "agents.sessions", method: "GET", path: "/api/agent-sessions", summary: "the agent's own sessions in the workspace ?agent=claude|codex|pi", errors: 502 }, async (c) => {
    const agent = c.query.get("agent") ?? "claude";
    if (!AGENTS.includes(agent)) fail(400, "agent must be claude, codex, or pi");
    return { sessions: await listAgentSessionsFor(agent as ChatAgentId) };
  }),
  route({ name: "chats.get", method: "GET", path: "/api/chats/:id", summary: "the chat's meta and events" }, async (c) => (await validChat(getChat(c.params.id))) ?? fail(404, "not found")),
  route({ name: "chats.delete", method: "DELETE", path: "/api/chats/:id", summary: "delete the chat" }, async (c) => {
    const result = await validChat(deleteChat(c.params.id));
    return reply(result.error ? 404 : 200, result);
  }),
  route({ name: "chats.rename", method: "PATCH", path: "/api/chats/:id", summary: "rename the chat {title}", body: z.object({ title: z.string() }) }, async (c) => {
    const { title } = await c.body();
    const result = await validChat(renameChat(c.params.id, title), "invalid chat id or body");
    return reply(result.error ? (result.error === "not found" ? 404 : 400) : 200, result);
  }),
  // Replays from ?after=N, then streams new events as they happen.
  route({ name: "chats.events", method: "GET", path: "/api/chats/:id/events", summary: "SSE: the chat's events from ?after=N", raw: true }, async ({ req, res, params, query }) => {
    const afterSeq = Number(query.get("after") ?? "0") || 0;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const unsubscribe = await subscribeChat(params.id, afterSeq, (ev: { seq: number }) => res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`)).catch(() => null);
    if (!unsubscribe) return void res.end();
    const heartbeat = setInterval(() => res.write(":hb\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }),
  route(
    {
      name: "chats.setVibeable",
      method: "POST",
      path: "/api/chats/:id/vibeable",
      summary: "open an app {slug} in the chat's preview pane (cwd follows), or close it {slug: null}",
      errors: 400,
      body: z.object({ slug: z.string().nullable().optional() }),
    },
    async (c) => {
      const { slug } = await c.body();
      return metaOf(await setChatVibeable(c.params.id, slug || null));
    },
  ),
  route({ name: "chats.fork", method: "POST", path: "/api/chats/:id/fork", summary: "a new chat continuing a copy of this one's session", errors: 400 }, async (c) => metaOf(await forkChat(c.params.id))),
  route({ name: "chats.resetSession", method: "POST", path: "/api/chats/:id/reset-session", summary: "forget the agent's session; the next message starts fresh", errors: 400 }, async (c) =>
    metaOf(await resetSession(c.params.id)),
  ),
  // The body is the file itself; x-file-name names it, content-type types it.
  route({ name: "chats.attach", method: "POST", path: "/api/chats/:id/attachments", summary: "upload an attachment for the next message", errors: 400, upload: true }, async (c) => {
    if (!(await getChat(c.params.id))) fail(404, "not found");
    const data = await readRawBody(c.req, 25_000_000);
    if (data.length === 0) fail(400, "empty file");
    const mimeType = (c.req.headers["content-type"] ?? "application/octet-stream").split(";")[0].trim();
    const name = await saveAttachment(c.params.id, decodeURIComponent(String(c.req.headers["x-file-name"] ?? "file")), data);
    return { name, mimeType, size: data.length };
  }),
  route({ name: "chats.attachment", method: "GET", path: "/api/chats/:id/attachments/:name", summary: "a stored attachment", raw: true }, async ({ res, params }) => {
    let data: Buffer;
    let file: string;
    try {
      file = attachmentPath(params.id, params.name);
      data = await fs.readFile(file);
    } catch {
      return fail(404, "not found");
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": data.length,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    });
    res.end(data);
  }),

  // Channels: `from` is the poster's display name, which signs the message.
  act("chats.message", "/api/chats/:id/message", "send a message {text, attachments?, from?}", Said.extend({ from: z.string().optional() }), (c, body) =>
    postMessage(c.params.id, textOf(body), { from: body.from, attachments: body.attachments }),
  ),
  act("chats.steer", "/api/chats/:id/steer", "add to the running turn {text, attachments?}", Said, (c, body) => steerChat(c.params.id, textOf(body), body.attachments)),
  act(
    "chats.permission",
    "/api/chats/:id/permission",
    "answer a permission request {requestId, optionId | null}",
    z.object({ requestId: z.string().default(""), optionId: z.string().nullable().default(null) }),
    (c, body) => resolvePermission(c.params.id, body.requestId, body.optionId),
  ),
  // Channels: `agent` stops one member; without it every agent in the chat.
  act("chats.cancel", "/api/chats/:id/cancel", "stop the running turn {agent?}", z.object({ agent: z.string().optional() }), (c, body) => cancelChat(c.params.id, body.agent || undefined)),
  act(
    "chats.elicitation",
    "/api/chats/:id/elicitation",
    "answer the agent's question {requestId, action, content?}",
    z.object({
      requestId: z.string().default(""),
      action: z.enum(["accept", "decline", "cancel"]),
      content: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).default({}),
    }),
    (c, { requestId, action, content }) => answerElicitation(c.params.id, requestId, action === "accept" ? { action, content } : { action }),
  ),
  act("chats.stopTask", "/api/chats/:id/task-stop", "stop one background task {taskId}", z.object({ taskId: z.string().default("") }), (c, body) => stopChatTask(c.params.id, body.taskId)),
  act(
    "chats.config",
    "/api/chats/:id/config",
    "set a session option {configId, value}",
    z.object({ configId: z.string().default(""), value: z.union([z.string(), z.boolean()]).default("") }),
    (c, body) => setChatConfig(c.params.id, body.configId, body.value),
  ),
];
