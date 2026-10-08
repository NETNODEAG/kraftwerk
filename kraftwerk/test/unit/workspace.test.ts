import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentWorkspace, perWorkspace, setDefaultWorkspace, Workspace } from "../../src/inspector/workspace.js";

/**
 * The current workspace: none until one is set or run in, `ws.run` wins
 * over the default and follows timers and promises started inside it,
 * and `perWorkspace` state is one value per workspace.
 */
describe("workspace context", () => {
  const a = new Workspace({ root: "/tmp/ws-a", outputDir: "/tmp/ws-a/output" });
  const b = new Workspace({ outputDir: "/tmp/ws-b/kraftwerk-data" });

  it("has no current workspace before one is set", () => {
    assert.throws(() => currentWorkspace(), /not initialized/);
  });

  it("defaults the root to the output dir's parent", () => {
    assert.equal(b.root, "/tmp/ws-b");
  });

  it("run() sets the workspace for everything started inside, the default applies outside", async () => {
    setDefaultWorkspace(a);
    assert.equal(currentWorkspace(), a);
    const later = await b.run(() => new Promise<Workspace>((resolve) => setTimeout(() => resolve(currentWorkspace()), 5)));
    assert.equal(later, b);
    assert.equal(currentWorkspace(), a);
  });

  it("perWorkspace keeps one value per workspace and lists them", () => {
    const counter = perWorkspace(() => ({ n: 0 }));
    a.run(() => counter().n++);
    b.run(() => (counter().n += 5));
    a.run(() => counter().n++);
    assert.equal(a.run(() => counter().n), 2);
    assert.equal(b.run(() => counter().n), 5);
    assert.deepEqual(
      counter.entries().map(([ws, v]) => [ws.root, v.n]),
      [
        ["/tmp/ws-a", 2],
        ["/tmp/ws-b", 5],
      ],
    );
  });
});
