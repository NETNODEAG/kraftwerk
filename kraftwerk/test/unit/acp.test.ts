import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { divertExtensionUpdates, extensionClientMeta, fileChangeReportMeta, openSession, parseExtensionLine, type AcpExtensionNotification } from "../../src/acp.js";
import { authStatusOf, configOptions, elicitationFields, failureOf, promptBlocks, translateExtension, translateUpdate } from "../../src/inspector/chat/acp.js";

/**
 * The protocol plumbing without an adapter process: how extension updates
 * are taken off the wire, how a session is resumed or opened fresh, and
 * how updates become chat events. Spawning an adapter would start a coding
 * agent — never from a test.
 */

const line = (o: unknown) => JSON.stringify(o) + "\n";
const spawned = { jsonrpc: "2.0", method: "session/update", params: { sessionId: "root", update: { sessionUpdate: "subagent_spawned", subagentSessionId: "child-1", name: "Explore", task: "find the config", capabilities: {} } } };
const chunk = { jsonrpc: "2.0", method: "session/update", params: { sessionId: "root", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } } };

async function collect(chunks: string[], onExt: (n: AcpExtensionNotification) => void): Promise<string> {
  const enc = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
  const out: string[] = [];
  const dec = new TextDecoder();
  for await (const c of divertExtensionUpdates(source, onExt) as unknown as AsyncIterable<Uint8Array>) out.push(dec.decode(c));
  return out.join("");
}

describe("acp: extension updates off the wire", () => {
  it("advertises the AIR capabilities the claude adapter negotiates", () => {
    const air = (extensionClientMeta().jetbrains as { air: { version: number; capabilities: string[] } }).air;
    assert.equal(air.version, 1);
    assert.deepEqual(air.capabilities, ["nativeSubagentSessions", "asyncTasks", "sessionFailure", "agentFileChangeReport"]);
    const req = (fileChangeReportMeta("turn-1").jetbrains as { air: Record<string, unknown> }).air.agentFileChangeReportRequest;
    assert.deepEqual(req, { version: 1, requestId: "turn-1" });
  });

  it("recognizes only session/update lines with an extension kind", () => {
    assert.deepEqual(parseExtensionLine(JSON.stringify(spawned))?.update.sessionUpdate, "subagent_spawned");
    assert.equal(parseExtensionLine(JSON.stringify(chunk)), null);
    assert.equal(parseExtensionLine('{"method":"other","params":{"update":{"sessionUpdate":"subagent_spawned"}}}'), null);
    assert.equal(parseExtensionLine("not json subagent_spawned"), null);
  });

  it("diverts extension lines and passes the rest through unchanged, even split across chunks", async () => {
    const ext: AcpExtensionNotification[] = [];
    const wire = line(chunk) + line(spawned) + line(chunk);
    // Split in the middle of the extension line and of the last line.
    const cut1 = wire.indexOf("subagent_spawned") + 4;
    const cut2 = wire.length - 5;
    const passed = await collect([wire.slice(0, cut1), wire.slice(cut1, cut2), wire.slice(cut2)], (n) => ext.push(n));
    assert.equal(passed, line(chunk) + line(chunk));
    assert.equal(ext.length, 1);
    assert.equal(ext[0].sessionId, "root");
    assert.equal(ext[0].update.sessionUpdate, "subagent_spawned");
  });

  it("keeps a last line without newline", async () => {
    const passed = await collect([JSON.stringify(chunk)], () => assert.fail("no extension here"));
    assert.equal(passed, JSON.stringify(chunk));
  });
});

describe("acp: opening a session", () => {
  const conn = (opts: { resume?: "ok" | "refuse" }) => {
    const calls: string[] = [];
    return {
      calls,
      async newSession() {
        calls.push("new");
        return { sessionId: "fresh", modes: { currentModeId: "default", availableModes: [] } };
      },
      async resumeSession(params: { sessionId: string }) {
        calls.push(`resume:${params.sessionId}`);
        if (opts.resume === "refuse") throw new Error("session not found");
        return { modes: { currentModeId: "acceptEdits", availableModes: [] } };
      },
    };
  };
  const req = { cwd: "/tmp/x", mcpServers: [] };

  it("opens a new session when there is nothing to resume", async () => {
    const c = conn({});
    const s = await openSession(c, req);
    assert.deepEqual(c.calls, ["new"]);
    assert.equal(s.sessionId, "fresh");
    assert.equal(s.resumed, false);
  });

  it("resumes the given id and keeps it as the session id", async () => {
    const c = conn({ resume: "ok" });
    const s = await openSession(c, req, "old");
    assert.deepEqual(c.calls, ["resume:old"]);
    assert.equal(s.sessionId, "old");
    assert.equal(s.resumed, true);
    assert.equal(s.modes?.currentModeId, "acceptEdits");
  });

  it("falls back to a new session when the resume is refused, and says why", async () => {
    const c = conn({ resume: "refuse" });
    const s = await openSession(c, req, "gone");
    assert.deepEqual(c.calls, ["resume:gone", "new"]);
    assert.equal(s.sessionId, "fresh");
    assert.equal(s.resumed, false);
    assert.match(s.resumeError ?? "", /not found/);
  });
});

describe("acp: session updates -> chat events", () => {
  const text = (sessionId: string, t: string) =>
    ({ sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } } }) as never;

  it("tags a child session's text with the subagent id, the root's not", () => {
    assert.deepEqual(translateUpdate("root", text("root", "a")), { type: "text", text: "a" });
    assert.deepEqual(translateUpdate("root", text("child-1", "b")), { type: "text", text: "b", subagent: "child-1" });
  });

  it("turns the synthetic compaction tool call into a tool event with compaction facts", () => {
    const ev = translateUpdate("root", {
      sessionId: "root",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "compact-1",
        title: "Compact conversation",
        kind: "think",
        status: "in_progress",
        _meta: { contextCompaction: { version: 1, trigger: "automatic", preTokens: 150000 } },
      },
    } as never);
    assert.deepEqual(ev, {
      type: "tool_call",
      callId: "compact-1",
      title: "Compact conversation",
      kind: "think",
      status: "in_progress",
      compaction: { trigger: "automatic", preTokens: 150000 },
    });
    const done = translateUpdate("root", {
      sessionId: "root",
      update: { sessionUpdate: "tool_call_update", toolCallId: "compact-1", status: "completed", _meta: { contextCompaction: { version: 1, postTokens: 30000, durationMs: 1200 } } },
    } as never);
    assert.deepEqual(done, { type: "tool_update", callId: "compact-1", title: undefined, status: "completed", compaction: { postTokens: 30000, durationMs: 1200 } });
  });

  it("turns a session failure in session_info_update into a failure event, and ignores plain info updates", () => {
    const meta = {
      jetbrains: {
        air: {
          version: 1,
          sessionFailure: { id: "s:session-error:1", revision: 2, category: "limit", severity: "error", title: "Rate limited", details: "Try again in 30s", actions: ["retry", "bogus"] },
        },
      },
    };
    assert.deepEqual(translateUpdate("root", { sessionId: "root", update: { sessionUpdate: "session_info_update", _meta: meta } } as never), {
      type: "failure", id: "s:session-error:1", revision: 2, category: "limit", severity: "error", title: "Rate limited", details: "Try again in 30s", actions: ["retry"],
    });
    assert.equal(translateUpdate("root", { sessionId: "root", update: { sessionUpdate: "session_info_update", title: "Renamed" } } as never), null);
    assert.equal(failureOf({ jetbrains: { air: { sessionFailure: { title: "no id" } } } }), undefined);
    // Unknown category or severity degrade instead of dropping the report.
    assert.deepEqual(failureOf({ jetbrains: { air: { sessionFailure: { id: "x", title: "t", category: "weird", severity: "fatal" } } } }), {
      id: "x", revision: 1, category: "unknown", severity: "error", title: "t", actions: [],
    });
  });

  it("reads the failure the adapter attaches to the prompt response itself", () => {
    // A provider condition that ends the turn (a usage limit here) never
    // arrives as a notification: for an AIR client the adapter settles the
    // prompt with stopReason "end_turn" and this _meta. Verbatim from
    // claude-agent-acp 0.75 on an exhausted model quota.
    const res = {
      stopReason: "end_turn",
      _meta: {
        quota: { token_count: { totalTokens: 0 } },
        jetbrains: {
          air: {
            version: 1,
            sessionFailure: {
              id: "1f47a346:error",
              revision: 1,
              category: "limit",
              severity: "error",
              title: "You've reached your Fable limit. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.",
              actions: [],
            },
          },
        },
      },
    };
    assert.deepEqual(failureOf(res._meta), {
      id: "1f47a346:error",
      revision: 1,
      category: "limit",
      severity: "error",
      title: "You've reached your Fable limit. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.",
      actions: [],
    });
  });

  it("keeps the main agent's plan, usage, commands and settings; drops a subagent's", () => {
    const plan = { sessionUpdate: "plan", entries: [{ content: "read", priority: "high", status: "completed" }, { content: "write", priority: "odd", status: "in_progress" }] };
    assert.deepEqual(translateUpdate("root", { sessionId: "root", update: plan } as never), {
      type: "plan", entries: [{ content: "read", priority: "high", status: "completed" }, { content: "write", priority: "medium", status: "in_progress" }],
    });
    assert.equal(translateUpdate("root", { sessionId: "child", update: plan } as never), null);
    assert.deepEqual(translateUpdate("root", { sessionId: "root", update: { sessionUpdate: "plan_removed" } } as never), { type: "plan", entries: null });
    assert.deepEqual(translateUpdate("root", { sessionId: "root", update: { sessionUpdate: "usage_update", used: 1200, size: 200000, cost: { amount: 0.42, currency: "USD" } } } as never), {
      type: "usage", used: 1200, size: 200000, costUsd: 0.42,
    });
    assert.deepEqual(
      translateUpdate("root", { sessionId: "root", update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "compact", description: "Compact", input: { hint: "[focus]" } }, { name: "clear", description: "Clear" }] } } as never),
      { type: "commands", commands: [{ name: "compact", description: "Compact", hint: "[focus]" }, { name: "clear", description: "Clear" }] }
    );
    assert.deepEqual(
      translateUpdate("root", { sessionId: "root", update: { sessionUpdate: "config_option_update", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "sonnet", options: [{ value: "sonnet", name: "Sonnet" }] }] } } as never),
      { type: "config", options: [{ id: "model", name: "Model", category: "model", type: "select", value: "sonnet", choices: [{ value: "sonnet", name: "Sonnet" }] }] }
    );
  });

  it("flattens grouped select options and keeps booleans", () => {
    const opts = configOptions([
      { id: "m", name: "Model", type: "select", currentValue: "a", options: [{ group: "g1", name: "Fast", options: [{ value: "a", name: "A", description: "quick" }] }, { group: "g2", name: "Smart", options: [{ value: "b", name: "B" }] }] },
      { id: "x", name: "Extended", type: "boolean", currentValue: true, description: "think more" },
    ] as never);
    assert.deepEqual(opts[0], { id: "m", name: "Model", type: "select", value: "a", choices: [{ value: "a", name: "A", description: "quick", group: "Fast" }, { value: "b", name: "B", group: "Smart" }] });
    assert.deepEqual(opts[1], { id: "x", name: "Extended", description: "think more", type: "boolean", value: true });
  });

  it("turns the file change report into a files_changed event", () => {
    const reported = { jetbrains: { air: { version: 1, agentFileChangeReport: { version: 1, requestId: "r", status: "reported", paths: ["src/a.ts", 3], declaredComplete: true, truncated: false } } } };
    assert.deepEqual(translateUpdate("root", { sessionId: "root", update: { sessionUpdate: "session_info_update", _meta: reported } } as never), {
      type: "files_changed", paths: ["src/a.ts"], complete: true,
    });
    const missing = { jetbrains: { air: { version: 1, agentFileChangeReport: { version: 1, requestId: "r", status: "unavailable", reason: "timeout" } } } };
    assert.deepEqual(translateUpdate("root", { sessionId: "root", update: { sessionUpdate: "session_info_update", _meta: missing } } as never), {
      type: "files_changed", paths: [], complete: false, unavailable: "timeout",
    });
  });

  it("reads the auth status notification", () => {
    assert.deepEqual(authStatusOf({ authStatus: { kind: "account", label: "Claude account", account: { email: "x@y.z", plan: "max" } } }), {
      kind: "account", label: "Claude account", email: "x@y.z", plan: "max",
    });
    assert.equal(authStatusOf({}), undefined);
  });

  it("renders an AskUserQuestion form and generic MCP schemas as fields", () => {
    const fields = elicitationFields({
      type: "object",
      properties: {
        question_0: { type: "string", title: "Approach", oneOf: [{ const: "A", title: "A", description: "fast" }, { const: "B", title: "B" }] },
        question_0_custom: { type: "string", title: "Other", _meta: { claudeCode: { questionId: "question_0", isCustomAnswer: true } } },
        picks: { type: "array", items: { anyOf: [{ const: "x", title: "X" }] } },
        name: { type: "string", description: "your name" },
        count: { type: "integer" },
        ok: { type: "boolean" },
        color: { type: "string", enum: ["red", "blue"] },
      },
      required: ["name"],
    });
    assert.deepEqual(fields.map((f) => [f.key, f.kind, f.custom ?? false, f.required ?? false]), [
      ["question_0", "select", false, false],
      ["question_0_custom", "text", true, false],
      ["picks", "multiselect", false, false],
      ["name", "text", false, true],
      ["count", "number", false, false],
      ["ok", "boolean", false, false],
      ["color", "select", false, false],
    ]);
    assert.deepEqual(fields[0].options, [{ value: "A", label: "A", description: "fast" }, { value: "B", label: "B" }]);
    assert.deepEqual(fields[6].options, [{ value: "red", label: "red" }, { value: "blue", label: "blue" }]);
  });

  it("packs attached files into prompt blocks: images inline, text embedded, the rest by path", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "acp-files-"));
    const png = path.join(dir, "shot.png");
    const txt = path.join(dir, "notes.md");
    const bin = path.join(dir, "data.zip");
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(txt, "# hi");
    writeFileSync(bin, Buffer.alloc(3));
    const blocks = await promptBlocks("look", [
      { name: "shot.png", mimeType: "image/png", size: 4, path: png },
      { name: "notes.md", mimeType: "text/markdown", size: 4, path: txt },
      { name: "data.zip", mimeType: "application/zip", size: 3, path: bin },
    ]);
    assert.equal(blocks.length, 3);
    assert.match((blocks[0] as { text: string }).text, /^look\n\nAttached files:\n- shot\.png \(image, .*\n- notes\.md .*\n- data\.zip \(application\/zip, /);
    assert.deepEqual(blocks[1], { type: "image", mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64") });
    assert.equal(blocks[2].type, "resource");
    assert.equal((blocks[2] as { resource: { text: string } }).resource.text, "# hi");
  });

  it("skips updates without thread content", () => {
    assert.equal(translateUpdate("root", { sessionId: "root", update: { sessionUpdate: "current_mode_update", currentModeId: "x" } } as never), null);
  });

  it("maps subagent and async task lifecycles", () => {
    assert.deepEqual(translateExtension({ sessionId: "root", update: { sessionUpdate: "subagent_spawned", subagentSessionId: "c", name: "Explore", task: "look" } }), {
      type: "subagent", sessionId: "c", name: "Explore", task: "look",
    });
    assert.deepEqual(translateExtension({ sessionId: "root", update: { sessionUpdate: "subagent_state_update", subagentSessionId: "c", state: "completed" } }), {
      type: "subagent_state", sessionId: "c", state: "completed",
    });
    assert.deepEqual(
      translateExtension({ sessionId: "root", update: { sessionUpdate: "async_task_spawned", asyncTaskId: "t", name: "npm test", taskType: "local_bash", description: "runs tests", toolCallId: "call-9" } }),
      { type: "task", taskId: "t", name: "npm test", taskType: "local_bash", description: "runs tests", toolCallId: "call-9" }
    );
    assert.deepEqual(translateExtension({ sessionId: "root", update: { sessionUpdate: "async_task_progress", asyncTaskId: "t", summary: "12 passed" } }), {
      type: "task_update", taskId: "t", summary: "12 passed",
    });
    assert.deepEqual(translateExtension({ sessionId: "root", update: { sessionUpdate: "async_task_state_update", asyncTaskId: "t", state: "completed", outputFilePath: "/tmp/t.log" } }), {
      type: "task_update", taskId: "t", state: "completed", outputFilePath: "/tmp/t.log",
    });
  });
});
