import { channelsRoot, deleteChannel, getChannel, listChannels, saveChannel, type Channel, type SaveChannelInput } from "../channels.js";
import { convertChatToChannel, deleteChat, dropChannelSeats, ensureChannelChat, listChats } from "../chat/sessions.js";
import { readMeta } from "../chat/store.js";
import type { ChatMeta } from "../chat/types.js";
import { fail, route } from "./router.js";

/** A channel with its chat and that chat's live state. */
async function view(c: Channel) {
  const meta = await ensureChannelChat(c);
  const live = (await listChats()).find((x) => x.id === meta.id);
  return { ...c, chatId: meta.id, busy: live?.busy ?? false, awaitingApproval: live?.awaitingApproval ?? false, updatedAt: meta.updatedAt };
}

async function existing(slug: string): Promise<Channel> {
  return (await getChannel(slug)) ?? fail(404, "channel not found");
}

type Body = SaveChannelInput & { chatId?: string };

/** Channels: one shared transcript (channels/<slug>/channel.yml + one chat) with several agents. */
export const channelRoutes = [
  route({ name: "channels.list", method: "GET", path: "/api/channels", summary: "every channel with its chat's state", errors: 400 }, async () => ({
    root: await channelsRoot(),
    channels: await Promise.all((await listChannels()).map(view)),
  })),
  route({ name: "channels.create", method: "POST", path: "/api/channels", summary: "create one {name, purpose?, members, responder?}", errors: 400 }, async (c) => {
    const { chatId: _c, slug: _s, ...input } = await c.body<Body>();
    return view(await saveChannel(input));
  }),
  // An agent session becomes a channel; a project chat's coworkers work in that project — the chat decides, not the body.
  route({ name: "channels.fromChat", method: "POST", path: "/api/channels/from-chat", summary: "turn a chat into a channel {chatId, name, members, …}", errors: 400 }, async (c) => {
    const { chatId, slug: _s, project: _p, ...input } = await c.body<Body>();
    if (!chatId) fail(400, "chatId is required");
    const source: ChatMeta | null = await readMeta(chatId).catch(() => null);
    if (!source) fail(404, "chat not found");
    const channel = await saveChannel({ ...input, ...(source.scope.kind === "project" ? { project: source.scope.slug } : {}) });
    const converted = await convertChatToChannel(chatId, channel);
    if (converted.error) {
      await deleteChannel(channel.slug).catch(() => {});
      fail(409, converted.error);
    }
    return view(channel);
  }),
  route({ name: "channels.get", method: "GET", path: "/api/channels/:slug", summary: "one channel with its chat's state", errors: 400 }, async (c) => view(await existing(c.params.slug))),
  route({ name: "channels.save", method: "PUT", path: "/api/channels/:slug", summary: "save a channel; members who left lose their seat", errors: 400 }, async (c) => {
    const slug = c.params.slug;
    await existing(slug);
    const { chatId: _c, slug: _s, ...input } = await c.body<Body>();
    const saved = await saveChannel({ ...input, slug });
    await dropChannelSeats((await ensureChannelChat(saved)).id, saved.members);
    return view(saved);
  }),
  route({ name: "channels.delete", method: "DELETE", path: "/api/channels/:slug", summary: "delete a channel and its chat", errors: 400 }, async (c) => {
    const slug = c.params.slug;
    await existing(slug);
    const meta = (await listChats()).find((x) => x.scope.kind === "channel" && x.scope.slug === slug);
    if (meta) await deleteChat(meta.id);
    await deleteChannel(slug);
    return { ok: true };
  }),
];
