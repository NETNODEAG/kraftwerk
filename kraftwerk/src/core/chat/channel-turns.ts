import { getAgent } from "../agents.js";
import type { Attachment, Author } from "./types.js";
import { getChannel, mentionTargets, type Channel } from "../channels.js";
import { attachmentPath, writeMeta } from "./store.js";
import { scopeContext } from "./context.js";
import { ensureBackend } from "./seats.js";
import { type ChatState, type Seat, dropSeat, emit, forgetFailedResume, newSeat } from "./state.js";

/**
 * Channels: how a post wakes the agents it mentions, and how each agent
 * takes its turn on the shared transcript.
 */

/* ---------- channels ---------- */

/**
 * A human posts to a channel: the message is signed with their name and the
 * agents it wakes (mentions, else the responder) each run a turn — in
 * parallel, never blocking the humans, who can keep posting. An agent that
 * is still busy is woken again when its turn ends, so nothing is lost.
 */
export async function postChannelMessage(state: ChatState, slug: string, text: string, from?: string, attachments?: Attachment[]): Promise<{ error?: string }> {
  const channel = await getChannel(slug).catch(() => null);
  if (!channel) return { error: `channel "${slug}" has no definition under channels/` };
  const name = (from ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "you";
  emit(state, { type: "user_message", text, ...(attachments ? { attachments } : {}) }, { kind: "human", name });
  void writeMeta(state.meta).catch(() => {});
  for (const target of mentionTargets(text, channel)) void wakeSeat(state, channel, target, 0);
  return {};
}

/** Wake a member agent: run a turn now, or mark it to run again when its current turn ends. */
async function wakeSeat(state: ChatState, channel: Channel, slug: string, hops: number): Promise<void> {
  const def = await getAgent(slug).catch(() => null);
  if (!def) {
    emit(state, { type: "error", message: `@${slug} is in the channel but has no agent definition under agents/` });
    return;
  }
  let seat = state.seats.get(slug);
  if (!seat) {
    seat = newSeat(slug, def.harness);
    state.seats.set(slug, seat);
  }
  if (seat.busy) {
    seat.wake = { hops: Math.min(hops, seat.wake?.hops ?? hops) };
    return;
  }
  await runSeatTurn(state, channel, seat, hops);
}

/**
 * The transcript a seat has not seen yet, as the agent reads it: humans by
 * name, other agents by @slug (their streamed text merged per turn), own
 * messages and machinery (tools, permissions, thoughts) left out.
 */
function transcriptSince(state: ChatState, afterSeq: number, beforeSeq: number, self: string): string {
  const lines: string[] = [];
  let open: { slug: string; text: string } | null = null;
  const flush = () => {
    if (open && open.text.trim()) lines.push(`[@${open.slug}]: ${open.text.trim()}`);
    open = null;
  };
  for (const e of state.events) {
    if (e.seq <= afterSeq || e.seq >= beforeSeq) continue;
    if (e.type === "user_message") {
      flush();
      const files = e.attachments?.length ? `\n(attached: ${e.attachments.map((a) => attachmentPath(state.meta.id, a.name)).join(", ")})` : "";
      lines.push(`[${e.from?.kind === "human" ? e.from.name : "human"}]: ${e.text}${files}`);
    } else if (e.type === "text" && e.from?.kind === "agent" && e.from.slug !== self) {
      if (open && open.slug !== e.from.slug) flush();
      open = open ?? { slug: e.from.slug, text: "" };
      open.text += e.text;
    } else if (e.type === "turn_end" && open && e.from?.kind === "agent" && e.from.slug === open.slug) {
      flush();
    }
  }
  flush();
  return lines.join("\n\n");
}

/** What one agent said during a turn (its streamed text after `afterSeq`). */
function seatTextSince(state: ChatState, afterSeq: number, slug: string): string {
  return state.events
    .filter((e) => e.seq > afterSeq && e.type === "text" && e.from?.kind === "agent" && e.from.slug === slug)
    .map((e) => (e as { text: string }).text)
    .join("");
}

async function runSeatTurn(state: ChatState, channel: Channel, seat: Seat, hops: number): Promise<void> {
  seat.busy = true;
  seat.busySince = new Date().toISOString();
  const me: Author = { kind: "agent", slug: seat.key };
  const start = emit(state, { type: "turn_start" }, me).seq;
  try {
    const backend = await ensureBackend(state, seat);
    const context = seat.needsContext ? await scopeContext(state.meta, seat) : "";
    seat.needsContext = false;
    const delta = transcriptSince(state, seat.seenSeq, start, seat.key);
    seat.seenSeq = start;
    if (!delta && !context) {
      emit(state, { type: "turn_end", stopReason: "nothing_new" }, me);
      return;
    }
    const prompt =
      (context ? `<context>\n${context}\n</context>\n\n` : "") +
      (delta ? `New messages in #${channel.slug}:\n\n${delta}` : `You joined #${channel.slug}. Nothing addressed to you yet — reply with one short line saying you are here.`);
    const { stopReason, failure } = await backend.prompt(prompt);
    emit(state, { type: "turn_end", stopReason }, me);
    if (failure) emit(state, { type: "failure", ...failure }, me);
    // Handover: agents this one @mentioned get its message, within the hop budget.
    const said = seatTextSince(state, start, seat.key);
    const next = mentionTargets(said, channel, seat.key);
    if (next.length > 0 && hops >= channel.maxHops) {
      emit(state, {
        type: "error",
        message: `handover limit reached (${channel.maxHops} per human message) — @mention ${next.map((n) => `@${n}`).join(", ")} yourself to continue`,
      });
    } else {
      for (const target of next) void wakeSeat(state, channel, target, hops + 1);
    }
  } catch (err) {
    emit(state, { type: "error", message: (err as Error).message }, me);
    forgetFailedResume(state, seat);
    dropSeat(seat);
  } finally {
    seat.busy = false;
    void writeMeta(state.meta).catch(() => {});
    if (seat.wake) {
      const { hops: again } = seat.wake;
      seat.wake = null;
      void runSeatTurn(state, channel, seat, again);
    }
  }
}
