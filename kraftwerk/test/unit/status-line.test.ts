import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { statusLine } from "../../src/core/status-line.js";
import type { AgentStatus } from "../../src/core/agent-status.js";

/**
 * The status line under an agent's name: which state wins, and how each
 * one reads. A fixed "now" keeps the clock out of it.
 */
describe("agent status line", () => {
  const now = new Date(2026, 9, 5, 10, 0); // Mon 5 Oct 2026, 10:00 local
  const at = (h: number, m = 0, dayOffset = 0, sec = 0) => new Date(2026, 9, 5 + dayOffset, h, m, sec).toISOString();
  const justNow = at(9, 59, 0, 30);
  // Times read in the viewer's locale: 14:30 or 2:30 PM.
  const clock = (h24: string, h12: string) => `(${h24}|${h12})`;
  const idle: AgentStatus = { waiting: [], working: [] };
  const line = (st: Partial<AgentStatus> | undefined, description?: string) =>
    statusLine(st && { ...idle, ...st }, description, now);

  it("no status yet: the description, or nothing", () => {
    assert.deepEqual(line(undefined, "research"), { text: "research", tone: "plain" });
    assert.equal(line(undefined), null);
  });

  it("an agent that never had a session shows its description, else says so", () => {
    assert.deepEqual(line({}, "research"), { text: "research", tone: "plain" });
    assert.deepEqual(line({}), { text: "no sessions yet", tone: "plain" });
  });

  it("idle: when it was last active", () => {
    assert.equal(line({ lastActiveAt: justNow })?.text, "last active just now");
    assert.equal(line({ lastActiveAt: at(9, 45) })?.text, "last active 15m ago");
    assert.equal(line({ lastActiveAt: at(7) })?.text, "last active 3h ago");
    assert.equal(line({ lastActiveAt: at(10, 0, -2) })?.text, "last active 2d ago");
  });

  it("the next routine beats last active, but only when due within 36 hours", () => {
    const today = line({ nextRoutine: { id: "r", name: "Inbox sweep", at: at(14, 30) }, lastActiveAt: at(9) })!;
    assert.match(today.text, new RegExp(`^next: Inbox sweep · ${clock("14[:.]30", "0?2:30\\sPM")}$`));
    assert.equal(today.tone, "plain");
    assert.match(line({ nextRoutine: { id: "r", name: "Morning brief", at: at(7, 0, 1) } })!.text, new RegExp(`^next: Morning brief · tomorrow ${clock("07[:.]00", "0?7:00\\sAM")}$`));
    // Wed 08:00 is 46 hours away: too far to matter, last active shows instead.
    assert.equal(line({ nextRoutine: { id: "r", name: "Weekly", at: at(8, 0, 2) }, lastActiveAt: at(7) })?.text, "last active 3h ago");
  });

  it("working beats the routine: where, how many more, for how long", () => {
    const routine = { nextRoutine: { id: "r", name: "Inbox sweep", at: at(14, 30) } };
    assert.deepEqual(line({ ...routine, working: [{ chatId: "c1", title: "Competitor summary", since: at(9, 56) }] }), {
      text: "working · Competitor summary · 4m",
      tone: "working",
    });
    assert.equal(line({ working: [{ chatId: "c1", title: "", since: justNow }] })?.text, "working · a session");
    assert.equal(
      line({ working: [{ chatId: "c1", title: "Draft", since: at(8) }, { chatId: "c2", title: "Other" }] })?.text,
      "working · Draft +1 · 2h"
    );
  });

  it("waiting for you beats everything", () => {
    const st = line({
      waiting: [{ chatId: "c2", title: "Deploy check" }, { chatId: "c3", title: "x" }],
      working: [{ chatId: "c1", title: "Competitor summary", since: at(9) }],
      nextRoutine: { id: "r", name: "Inbox sweep", at: at(14, 30) },
      lastActiveAt: at(9),
    });
    assert.deepEqual(st, { text: "waiting for you · Deploy check +1", tone: "waiting" });
  });
});
