import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Listing skills outside any workspace (a background re-evaluation that lost
 * its workspace) fails as one error — it once left a second, unhandled one
 * behind, which took the whole daemon down.
 */
describe("skills outside a workspace", () => {
  it("rejects once, leaving nothing unhandled", async () => {
    const stray: unknown[] = [];
    const onStray = (err: unknown) => stray.push(err);
    process.on("unhandledRejection", onStray);
    try {
      const { listSkills } = await import("../../src/core/skills.js");
      await assert.rejects(listSkills(), /inspector context not initialized/);
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(stray, []);
    } finally {
      process.off("unhandledRejection", onStray);
    }
  });
});
