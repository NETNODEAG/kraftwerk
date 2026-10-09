import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mentionsWorkflow } from "../../src/core/routines.js";

/** A routine belongs to a workflow when its prompt names the workflow's slug or name as a whole word. */
describe("mentionsWorkflow", () => {
  it("matches the slug or the name, case-insensitive, as a whole word", () => {
    assert.equal(mentionsWorkflow("Run the daily-ceo-report workflow, then post", { slug: "daily-ceo-report" }), true);
    assert.equal(mentionsWorkflow("Run helpdesk workflow", { slug: "helpdesk-triage", name: "Helpdesk" }), true);
    assert.equal(mentionsWorkflow("`kraftwerk run heizoel-preischeck`", { slug: "heizoel-preischeck" }), true);
  });
  it("does not match a slug inside a longer word or another slug", () => {
    assert.equal(mentionsWorkflow("Run the daily-ceo-report-v2 workflow", { slug: "daily-ceo-report" }), false);
    assert.equal(mentionsWorkflow("check the helpdesks", { slug: "helpdesk" }), false);
    assert.equal(mentionsWorkflow("nothing here", { slug: "x", name: "" }), false);
  });
  it("treats regex characters in a name literally", () => {
    assert.equal(mentionsWorkflow("run c++ build (nightly) now", { slug: "cpp", name: "c++ build (nightly)" }), true);
  });
});
