import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { getProjectRoot } from "./context.js";
import { resolveProject } from "../config.js";
import { listAgents, safeAgentSlug, slugFromName, type Agent } from "./agents.js";

/**
 * Channels: one transcript shared by several agents and humans — a Slack
 * channel where the coworkers are agents. The definition is git-tracked
 * with the workspace so the whole team sees the same channels:
 *
 *   channels/<slug>/channel.yml   # name, purpose, members (agent slugs), responder, maxHops
 *
 * The transcript itself is a chat (scope { kind: "channel", slug }) under
 * <output>/chats/, run-state like every other chat. sessions.ts gives each
 * member agent its own seat (process) in that chat and routes messages:
 * an @mention wakes that agent, no mention wakes the channel's responder,
 * an agent mentioning another hands over — bounded by maxHops per human
 * message so two agents never talk forever.
 */

export interface Channel {
  slug: string;
  name: string;
  purpose?: string;
  /** Agent slugs that sit in the channel. */
  members: string[];
  /** Who answers a message that mentions nobody; absent = nobody does. */
  responder?: string;
  /** Agent-to-agent handovers allowed per human message. */
  maxHops: number;
}

export const DEFAULT_MAX_HOPS = 3;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;

export async function channelsRoot(): Promise<string> {
  const project = await resolveProject(getProjectRoot());
  return path.resolve(project.root, "channels");
}

export function safeChannelSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid channel slug "${slug}"`);
  return slug;
}

interface ChannelYaml {
  name?: unknown;
  purpose?: unknown;
  members?: unknown;
  responder?: unknown;
  maxHops?: unknown;
}

function normalize(slug: string, raw: ChannelYaml): Channel {
  const members = Array.isArray(raw.members) ? [...new Set(raw.members.map(String))] : [];
  const responder = typeof raw.responder === "string" && members.includes(raw.responder) ? raw.responder : undefined;
  const hops = typeof raw.maxHops === "number" && Number.isInteger(raw.maxHops) && raw.maxHops >= 0 ? raw.maxHops : DEFAULT_MAX_HOPS;
  return {
    slug,
    name: String(raw.name ?? slug),
    ...(raw.purpose ? { purpose: String(raw.purpose) } : {}),
    members,
    ...(responder ? { responder } : {}),
    maxHops: hops,
  };
}

export async function listChannels(): Promise<Channel[]> {
  const root = await channelsRoot();
  let entries: string[];
  try {
    entries = (await fs.readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && SLUG_RE.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const channels = await Promise.all(entries.map((slug) => getChannel(slug)));
  return (channels.filter(Boolean) as Channel[]).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getChannel(slug: string): Promise<Channel | null> {
  const file = path.join(await channelsRoot(), safeChannelSlug(slug), "channel.yml");
  try {
    const raw = parse(await fs.readFile(file, "utf8"));
    return normalize(slug, (raw ?? {}) as ChannelYaml);
  } catch {
    return null;
  }
}

export interface SaveChannelInput {
  slug?: string;
  name?: string;
  purpose?: string;
  members?: string[];
  /** Agent slug, or "" / null to clear. */
  responder?: string | null;
  maxHops?: number;
}

/** Members must be existing, non-archived agents; returns them in the order given. */
async function checkMembers(slugs: string[]): Promise<Agent[]> {
  const agents = await listAgents();
  return slugs.map((slug) => {
    const a = agents.find((m) => m.slug === safeAgentSlug(slug));
    if (!a) throw new Error(`agent "${slug}" not found`);
    if (a.archived) throw new Error(`agent "${slug}" is archived`);
    return a;
  });
}

/** Create (no slug: derived from the name) or update a channel definition. */
export async function saveChannel(input: SaveChannelInput): Promise<Channel> {
  const existing = input.slug ? await getChannel(safeChannelSlug(input.slug)) : null;
  const name = (input.name ?? existing?.name ?? "").trim();
  if (!name) throw new Error("name is required");
  const slug = input.slug ? safeChannelSlug(input.slug) : slugFromName(name);
  if (!input.slug && (await getChannel(slug))) throw new Error(`channel "${slug}" exists already`);
  const members = input.members !== undefined ? [...new Set(input.members.map(String))] : existing?.members ?? [];
  if (members.length === 0) throw new Error("a channel needs at least one agent");
  await checkMembers(members);
  let responder = existing?.responder;
  if (input.responder !== undefined) responder = input.responder ? input.responder : undefined;
  if (responder && !members.includes(responder)) responder = undefined;
  const maxHops =
    input.maxHops !== undefined
      ? Number.isInteger(input.maxHops) && input.maxHops >= 0
        ? input.maxHops
        : (() => {
            throw new Error("maxHops must be a whole number");
          })()
      : existing?.maxHops ?? DEFAULT_MAX_HOPS;
  const channel: Channel = {
    slug,
    name,
    ...(input.purpose !== undefined
      ? input.purpose.trim()
        ? { purpose: input.purpose.trim() }
        : {}
      : existing?.purpose
        ? { purpose: existing.purpose }
        : {}),
    members,
    ...(responder ? { responder } : {}),
    maxHops,
  };
  const dir = path.join(await channelsRoot(), slug);
  await fs.mkdir(dir, { recursive: true });
  const { slug: _s, ...body } = channel;
  await fs.writeFile(path.join(dir, "channel.yml"), stringify(body));
  return channel;
}

export async function deleteChannel(slug: string): Promise<void> {
  await fs.rm(path.join(await channelsRoot(), safeChannelSlug(slug)), { recursive: true, force: true });
}

/**
 * Who a channel message wakes. @mentions of members win (in text order, each
 * once); a message that mentions nobody goes to the responder, or to nobody.
 * `self` (the author, when an agent) never wakes itself.
 */
export function mentionTargets(text: string, channel: Pick<Channel, "members" | "responder">, self?: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(^|[^\w@])@([a-z0-9][a-z0-9-]*)/g)) {
    const slug = m[2];
    if (channel.members.includes(slug) && slug !== self && !out.includes(slug)) out.push(slug);
  }
  if (out.length === 0 && channel.responder && channel.responder !== self && !self) return [channel.responder];
  return out;
}
