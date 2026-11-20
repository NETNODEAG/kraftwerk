import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acpMcpServers, tuningConfig } from "../../src/acp.js";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { claudeSessionOptions, toolTarget } from "../../src/harnesses/acp.js";
import { harnessFor } from "../../src/harnesses/registry.js";

/**
 * The ACP harness without an adapter process: how a phase invocation maps
 * onto a session, and how session totals become per-turn numbers. Spawning
 * an adapter would start a coding agent — never from a test.
 */
describe("agent-protocol harness", () => {
  it("is selected by protocol, keeps the harness id, and refuses pi", () => {
    assert.equal(harnessFor("claude", "acp").id, "claude");
    assert.equal(harnessFor("codex", "acp").id, "codex");
    assert.notEqual(harnessFor("claude", "acp"), harnessFor("claude"));
    assert.throws(() => harnessFor("pi", "acp"), /no agent-protocol adapter/);
    // Antigravity's CLI is its ACP server: protocol cli runs on the adapter too.
    assert.equal(harnessFor("antigravity").id, "antigravity");
    assert.notEqual(harnessFor("antigravity"), harnessFor("claude"));
  });

  it("sets antigravity's model and thinking depth as session settings, only to offered choices", () => {
    // What `agy acp` announces on session/new.
    const offered = [
      { id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-3.8-flash", options: [{ value: "gemini-3.8-flash", name: "Gemini" }, { value: "claude-opus-4-6-thinking", name: "Opus" }] },
      { id: "thought_level", name: "Thinking", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "low" }, { value: "medium", name: "medium" }, { value: "high", name: "high" }] },
    ] as SessionConfigOption[];
    assert.deepEqual(tuningConfig("antigravity", { model: "claude-opus-4-6-thinking", effort: "xhigh" }, offered), [
      { configId: "model", value: "claude-opus-4-6-thinking" },
      { configId: "thought_level", value: "high" },
    ]);
    assert.deepEqual(tuningConfig("antigravity", { model: "sonnet", effort: "low" }, offered), [{ configId: "thought_level", value: "low" }]);
    assert.deepEqual(tuningConfig("antigravity", {}, offered), []);
    // The other adapters take model and effort elsewhere (env, _meta).
    assert.deepEqual(tuningConfig("claude", { model: "claude-opus-4-6-thinking" }, offered), []);
  });

  it("turns tools, CLI grants and MCP servers into the claude allowlist, hermetic", () => {
    const o = claudeSessionOptions({
      model: "sonnet",
      tools: ["Read", "Write"],
      clis: ["git", "npm run"],
      mcpServers: { calc: { command: "node", args: ["calc.js"] }, docs: { url: "https://x.test/mcp" } },
    });
    assert.equal(o.model, "sonnet");
    // The permission mode is set after the session opens, not here: the adapter overwrites this key.
    assert.equal("permissionMode" in o, false);
    assert.deepEqual(o.settingSources, []);
    assert.deepEqual(o.allowedTools, ["Read", "Write", "Bash(git:*)", "Bash(npm run:*)", "mcp__calc", "mcp__docs"]);
  });

  it("maps MCP configs onto protocol session servers", () => {
    assert.deepEqual(acpMcpServers({ calc: { command: "node", args: ["calc.js"], env: { A: "1" } }, docs: { url: "https://x.test/mcp" } }), [
      { name: "calc", command: "node", args: ["calc.js"], env: [{ name: "A", value: "1" }] },
      { type: "http", name: "docs", url: "https://x.test/mcp", headers: [] },
    ]);
    assert.deepEqual(acpMcpServers(undefined), []);
  });

  it("names a tool call from its input or location, never from a placeholder title alone", () => {
    assert.equal(toolTarget({ rawInput: { command: "git  status\n" } }), "git status");
    assert.equal(toolTarget({ rawInput: { file_path: "/run/a.md" }, locations: [{ path: "/run/b.md" }] }), "/run/a.md");
    assert.equal(toolTarget({ locations: [{ path: "/run/b.md" }] }), "/run/b.md");
    assert.equal(toolTarget({ rawInput: {} }), undefined);
    assert.equal(toolTarget({ rawInput: { command: "x".repeat(200) } })?.length, 161);
  });
});
