import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { piOptions } from "../../src/core/chat/pi.js";

/**
 * pi has no agent protocol, so kraftwerk announces its model and thinking
 * level for it, in the shape ACP agents use: the chat's pickers and a new
 * chat's start options treat pi like the others.
 */
describe("pi's settings", () => {
  it("offers its listed models and thinking levels, with pi's own default first", () => {
    const [model, thinking] = piOptions(["anthropic/claude-opus-5", "deepseek/deepseek-chat"]);
    assert.equal(model.type === "select" && model.value, "default");
    assert.deepEqual(model.type === "select" && model.choices.map((c) => c.value), ["default", "anthropic/claude-opus-5", "deepseek/deepseek-chat"]);
    assert.equal(thinking.category, "thought_level");
    assert.deepEqual(thinking.type === "select" && thinking.choices.map((c) => c.value), ["default", "off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  });

  it("shows the model a chat runs on even when pi does not list it (a pattern like sonnet:high)", () => {
    const [model, thinking] = piOptions(["anthropic/claude-opus-5"], "sonnet:high", "low");
    assert.equal(model.type === "select" && model.value, "sonnet:high");
    assert.deepEqual(model.type === "select" && model.choices.map((c) => c.value), ["default", "sonnet:high", "anthropic/claude-opus-5"]);
    assert.equal(thinking.type === "select" && thinking.value, "low");
  });
});
