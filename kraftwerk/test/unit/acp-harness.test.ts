import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acpMcpServers } from "../../src/acp.js";
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
