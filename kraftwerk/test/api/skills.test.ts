import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";
import type { SkillInfo } from "../../src/core/skills.js";

/**
 * Skills over the HTTP API: the listing carries each skill's frontmatter,
 * where it comes from, and when its SKILL.md last changed (Artifacts sorts
 * by it).
 */
describe("skills API", () => {
  let fx: Fixture;
  let srv: RunningServer;

  before(async () => {
    fx = await makeProject("name: fixture\n");
    await fx.write("skills/digest/SKILL.md", "---\nname: digest\ndescription: writes the weekly digest\n---\n# Digest\n");
    srv = await startServer(fx);
  });
  after(async () => {
    await srv?.close();
    await fx?.cleanup();
  });

  it("lists a workspace skill with its description and last change", async () => {
    const res = await fetch(`${srv.url}/api/skills`);
    assert.equal(res.status, 200);
    const { skills } = (await res.json()) as { skills: SkillInfo[] };
    const s = skills.find((x) => x.name === "digest");
    assert.ok(s, "digest is listed");
    assert.equal(s.source, "workspace");
    assert.equal(s.description, "writes the weekly digest");
    assert.ok(s.updatedAt && !Number.isNaN(Date.parse(s.updatedAt)), `updatedAt parses: ${s.updatedAt}`);
  });
});
