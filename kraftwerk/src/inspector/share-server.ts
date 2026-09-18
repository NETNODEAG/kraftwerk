import type http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgent, listAgents } from "./agents.js";
import { getChannel } from "./channels.js";
import { listWorkflows } from "./workflows.js";
import {
  cancelChat,
  createChat,
  ensureChannelChat,
  getChat,
  listChats,
  postMessage,
  subscribeChat,
} from "./chat/sessions.js";
import { saveAttachment } from "./chat/store.js";
import { getShare, verifyBasic, type Share } from "./shares.js";

/**
 * The customer-facing surface: everything reachable under `/s/<token>`.
 *
 * This is a separate router on purpose. The inspector's own API is not
 * mounted here and no flag switches it on — the customer cannot reach the
 * workspace, the other agents, the settings or the runs because those
 * routes do not exist on this path, not because a check says no.
 *
 * What a share can do: open threads with its one agent, send messages, read
 * its own transcript, stop a turn. Every chat id is checked against the
 * share's own token first, so one share can never address another's thread.
 */

const frameworkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGE = path.join(frameworkDir, "share", "index.html");

type Res = http.ServerResponse;

function json(res: Res, body: unknown, status = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function challenge(res: Res): void {
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="kraftwerk", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end("Sign in to use this agent.\n");
}

/** The raw bytes of an upload, refused past the limit rather than buffered. */
async function readRaw(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("file too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** What one person may hand over in a single file. */
const UPLOAD_LIMIT = 25_000_000;

async function readBody(req: http.IncomingMessage, limit = 256 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Does this share own that chat? The one gate every thread route passes.
 *
 * An agent share owns the threads it created — they carry its token. A
 * channel share owns the channel's single transcript, which the workspace
 * writes to as well: sharing a channel means sharing that conversation,
 * history included.
 */
const owns = (share: Share, meta: { share?: string; scope: { kind: string; slug?: string } }): boolean =>
  share.kind === "channel"
    ? meta.scope.kind === "channel" && meta.scope.slug === share.slug
    : meta.share === share.token;

/** Every thread this share may open, newest first. */
async function threadsOf(share: Share): Promise<Array<{ id: string; title: string; updatedAt: string }>> {
  if (share.kind === "channel") {
    const channel = await getChannel(share.slug).catch(() => null);
    if (!channel) return [];
    const meta = await ensureChannelChat(channel);
    return [{ id: meta.id, title: channel.name, updatedAt: meta.updatedAt }];
  }
  return (await listChats())
    .filter((c) => owns(share, c))
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function ownedChat(share: Share, id: string): Promise<Awaited<ReturnType<typeof getChat>>> {
  const chat = await getChat(id);
  if (!chat || !owns(share, chat.meta)) return null;
  return chat;
}

/**
 * The workflows behind this link, as the customer may see them: the ones
 * granted to the agent (or to any member of the channel), and nothing else.
 *
 * The page does not run them itself — it writes the request into the
 * conversation and the agent runs it in its own sandbox. That keeps one
 * surface instead of two, puts the run in the transcript where the audit
 * trail already lives, and means the grants need no second enforcement: a
 * workflow that is not mounted cannot be run however it is asked for.
 */
async function workflowsFor(slugs: string[]): Promise<Array<Record<string, unknown>>> {
  if (slugs.length === 0) return [];
  const all = await listWorkflows().catch(() => ({ workflows: [] }));
  return all.workflows
    .filter((w) => slugs.includes(w.slug) && !w.error)
    .map((w) => ({
      slug: w.slug,
      name: w.name ?? w.slug,
      ...(w.description ? { description: w.description } : {}),
      usesRequest: w.usesRequest,
    }));
}

/** What the page shows at the top: the agent, or the channel and its agents. */
async function targetOf(share: Share): Promise<Record<string, unknown>> {
  if (share.kind === "channel") {
    const channel = await getChannel(share.slug).catch(() => null);
    const roster = await listAgents().catch(() => []);
    const members = (channel?.members ?? []).map((slug) => {
      const a = roster.find((x) => x.slug === slug);
      return { slug, name: a?.name ?? slug, emoji: a?.emoji ?? "🤖" };
    });
    // Everything the channel can run, whichever member carries it.
    const granted = [...new Set(members.flatMap((m) => roster.find((a) => a.slug === m.slug)?.workflows ?? []))];
    return {
      kind: "channel",
      target: { name: channel?.name ?? share.slug, emoji: "#", description: channel?.purpose, members },
      workflows: await workflowsFor(granted),
    };
  }
  const agent = await getAgent(share.slug).catch(() => null);
  return {
    kind: "agent",
    target: agent
      ? { name: agent.name, emoji: agent.emoji, description: agent.description, members: [] }
      : { name: share.slug, emoji: "🤖", members: [] },
    workflows: await workflowsFor(agent?.workflows ?? []),
  };
}

/**
 * Handle a request under /s/. Returns false when the path is not a share
 * path, so the caller can fall through to the inspector.
 */
export async function handleShare(
  req: http.IncomingMessage,
  res: Res,
  url: URL
): Promise<boolean> {
  const seg = url.pathname.split("/").filter(Boolean); // ["s", token, ...]
  if (seg[0] !== "s") return false;
  const token = seg[1];
  if (!token) {
    json(res, { error: "not found" }, 404);
    return true;
  }
  const share = await getShare(token);
  // An unknown token answers exactly like a wrong password: a probe cannot
  // tell an expired link from a guessed one.
  if (!share || !(await verifyBasic(share, req.headers.authorization))) {
    challenge(res);
    return true;
  }

  const method = req.method ?? "GET";
  const rest = seg.slice(2);

  // GET /s/<token> — the page itself.
  if (rest.length === 0 && method === "GET") {
    const html = await fs.readFile(PAGE, "utf8").catch(() => null);
    if (html === null) {
      json(res, { error: "share page missing from this kraftwerk install" }, 500);
      return true;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
    return true;
  }

  if (rest[0] !== "api") {
    json(res, { error: "not found" }, 404);
    return true;
  }

  // GET /s/<token>/api/meta — who the customer is talking to, and which
  // threads they may open. A channel also names its agents, because in a
  // group transcript "who said that" is half the message.
  if (rest.length === 2 && rest[1] === "meta" && method === "GET") {
    json(res, { ...(await targetOf(share)), threads: await threadsOf(share) });
    return true;
  }

  // POST /s/<token>/api/chats — a new thread. A channel has exactly one
  // transcript, so this hands back that one instead of making another.
  if (rest.length === 2 && rest[1] === "chats" && method === "POST") {
    if (share.kind === "channel") {
      const channel = await getChannel(share.slug).catch(() => null);
      if (!channel) {
        json(res, { error: "this channel is no longer available" }, 404);
        return true;
      }
      json(res, { id: (await ensureChannelChat(channel)).id });
      return true;
    }
    const agent = await getAgent(share.slug).catch(() => null);
    if (!agent) {
      json(res, { error: "this agent is no longer available" }, 404);
      return true;
    }
    const meta = await createChat({
      agent: agent.harness,
      scope: { kind: "agent", slug: share.slug },
      share: share.token,
    });
    json(res, { id: meta.id });
    return true;
  }

  // GET /s/<token>/api/chats/:id — transcript so far.
  if (rest.length === 3 && rest[1] === "chats" && method === "GET") {
    const chat = await ownedChat(share, rest[2]);
    if (!chat) {
      json(res, { error: "not found" }, 404);
      return true;
    }
    json(res, { title: chat.meta.title, busy: chat.busy, events: chat.events });
    return true;
  }

  // GET /s/<token>/api/chats/:id/events?after=N — SSE.
  if (rest.length === 4 && rest[1] === "chats" && rest[3] === "events" && method === "GET") {
    if (!(await ownedChat(share, rest[2]))) {
      json(res, { error: "not found" }, 404);
      return true;
    }
    const after = Number(url.searchParams.get("after") ?? "0") || 0;
    let unsubscribe: (() => void) | null = null;
    try {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      unsubscribe = await subscribeChat(rest[2], after, (ev: { seq: number }) => {
        res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
      });
    } catch {
      res.end();
      return true;
    }
    if (!unsubscribe) {
      res.end();
      return true;
    }
    const heartbeat = setInterval(() => res.write(":hb\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe?.();
    });
    return true;
  }

  // POST /s/<token>/api/chats/:id/attachments — raw file body, x-file-name
  // names it. Stored under the chat like any other attachment; a sandboxed
  // agent is handed a copy in its own read-only uploads mount, never this
  // folder, because the transcripts live here too.
  if (rest.length === 4 && rest[1] === "chats" && rest[3] === "attachments" && method === "POST") {
    if (!(await ownedChat(share, rest[2]))) {
      json(res, { error: "not found" }, 404);
      return true;
    }
    try {
      const data = await readRaw(req, UPLOAD_LIMIT);
      if (data.length === 0) {
        json(res, { error: "empty file" }, 400);
        return true;
      }
      const mimeType = (req.headers["content-type"] ?? "application/octet-stream").split(";")[0].trim();
      const name = await saveAttachment(
        rest[2],
        decodeURIComponent(String(req.headers["x-file-name"] ?? "file")),
        data
      );
      json(res, { name, mimeType, size: data.length });
    } catch (err) {
      json(res, { error: (err as Error).message }, 400);
    }
    return true;
  }

  // POST /s/<token>/api/chats/:id/{message,cancel}
  if (rest.length === 4 && rest[1] === "chats" && method === "POST") {
    const chat = await ownedChat(share, rest[2]);
    if (!chat) {
      json(res, { error: "not found" }, 404);
      return true;
    }
    if (rest[3] === "cancel") {
      json(res, await cancelChat(rest[2]));
      return true;
    }
    if (rest[3] === "message") {
      let text = "";
      let from = "";
      let attachments: Array<{ name: string; mimeType: string; size: number }> = [];
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        text = String(body.text ?? "").trim();
        attachments = Array.isArray(body.attachments)
          ? (body.attachments as Array<Record<string, unknown>>)
              .filter((a) => a && typeof a.name === "string" && typeof a.mimeType === "string")
              .map((a) => ({ name: String(a.name), mimeType: String(a.mimeType), size: Number(a.size) || 0 }))
          : [];
        // Several people can hold the same link; their name signs the
        // message so the transcript is readable afterwards. It is a label
        // the poster chose, never an identity — the link is the credential.
        from = String(body.from ?? "").trim().slice(0, 60);
      } catch {
        json(res, { error: "invalid JSON body" }, 400);
        return true;
      }
      if (!text && attachments.length === 0) {
        json(res, { error: "text is required" }, 400);
        return true;
      }
      const result = await postMessage(rest[2], text || "(see attached)", {
        ...(from ? { from } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      json(res, result.error ? result : { ok: true }, result.error ? 400 : 200);
      return true;
    }
  }

  json(res, { error: "not found" }, 404);
  return true;
}
