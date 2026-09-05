import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mentionTargets } from "../../src/inspector/channels.js";

/** Who a channel message wakes. */
describe("channel mention routing", () => {
  const ch = { members: ["researcher", "writer", "dev-ops"], responder: "researcher" };

  it("mentions win, in text order, each once, members only", () => {
    assert.deepEqual(mentionTargets("@writer please draft, @dev-ops check infra, @writer again", ch), ["writer", "dev-ops"]);
    assert.deepEqual(mentionTargets("hey @nobody and @writer", ch), ["writer"]);
    assert.deepEqual(mentionTargets("mail me at lukas@writer.example", { members: ch.members }), [], "an email address is not a mention");
  });

  it("no mention goes to the responder, or to nobody", () => {
    assert.deepEqual(mentionTargets("what do you think?", ch), ["researcher"]);
    assert.deepEqual(mentionTargets("what do you think?", { members: ch.members }), []);
  });

  it("an agent never wakes itself, and its unaddressed reply wakes nobody", () => {
    assert.deepEqual(mentionTargets("@researcher and @writer", ch, "researcher"), ["writer"]);
    assert.deepEqual(mentionTargets("here is my summary", ch, "writer"), [], "no responder fallback for agents");
  });
});
