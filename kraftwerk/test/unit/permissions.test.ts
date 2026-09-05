import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UNATTENDED_PERMISSION_TIMEOUT_MS,
  declineOption,
  unattendedMode,
  unattendedTimeoutLabel,
} from "../../src/inspector/chat/permissions.js";

/** What an unanswered permission request in a routine session resolves to: never an allow. */
describe("unattended permission fallback", () => {
  const acp = [
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "allow-always", name: "Always allow", kind: "allow_always" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ];

  it("picks the reject_once option when the harness offers one", () => {
    assert.equal(declineOption(acp), "reject");
  });

  it("falls back to any reject kind, else cancels (null) — never an allow", () => {
    assert.equal(declineOption([acp[0], { optionId: "never", name: "Never", kind: "reject_always" }]), "never");
    assert.equal(declineOption([acp[0], acp[1]]), null);
    assert.equal(declineOption([]), null);
  });

  it("gives humans a real window and states it in minutes", () => {
    assert.ok(UNATTENDED_PERMISSION_TIMEOUT_MS >= 10 * 60_000);
    assert.equal(unattendedTimeoutLabel(30 * 60_000), "30 minutes");
    assert.equal(unattendedTimeoutLabel(60_000), "1 minute");
  });
});

/** Which harness preset a routine session runs in: the configured one, unless it never asks. */
describe("unattended session mode", () => {
  it("keeps claude's auto and acceptEdits, lifts default, rules out bypassPermissions", () => {
    assert.equal(unattendedMode("claude", "auto"), null);
    assert.equal(unattendedMode("claude", "acceptEdits"), null);
    assert.equal(unattendedMode("claude", "default"), "acceptEdits");
    assert.equal(unattendedMode("claude", "bypassPermissions"), "acceptEdits");
    assert.equal(unattendedMode("claude", undefined), "acceptEdits");
  });

  it("keeps codex's sandboxed presets and rules out full access", () => {
    assert.equal(unattendedMode("codex", "agent"), null);
    assert.equal(unattendedMode("codex", "read-only"), null);
    assert.equal(unattendedMode("codex", "agent-full-access"), "agent");
    assert.equal(unattendedMode("codex", undefined), "agent");
  });
});
