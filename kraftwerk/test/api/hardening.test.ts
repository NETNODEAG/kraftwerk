import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeProject, startServer, type Fixture, type RunningServer } from "../helpers/project.js";

/**
 * Two guards from the security review: git names from kraftwerk.yml never
 * reach git looking like an option, and raw run files never run as the
 * inspector's own origin.
 */
describe("hardening", () => {
  let fx: Fixture;
  let srv: RunningServer;
  before(async () => {
    fx = await makeProject();
    srv = await startServer(fx);
  });
  after(async () => {
    await srv.close();
    await fx.cleanup();
  });

  const put = (body: unknown) =>
    fetch(srv.url + "/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: new URL(srv.url).origin },
      body: JSON.stringify(body),
    });

  it("settings refuse a git remote or branch that looks like an option", async () => {
    for (const bad of [
      { remote: "--upload-pack=touch /tmp/pwned", branch: "main" },
      { remote: "origin", branch: "-x" },
      { remote: "ori gin", branch: "main" },
    ]) {
      const r = await put({ git: { enabled: true, ...bad } });
      assert.equal(r.status, 400, JSON.stringify(bad));
      const d = (await r.json()) as { error: string };
      assert.match(d.error, /plain name/);
    }
    const ok = await put({ git: { enabled: true, remote: "upstream", branch: "feature/x.y" } });
    assert.equal(ok.status, 200);
  });

  it("a committed kraftwerk.yml with a dash-led remote is rejected on load, so no git call sees it", async () => {
    await fx.write("kraftwerk.yml", 'name: fixture\ngit:\n  remote: "--upload-pack=touch /tmp/pwned"\n');
    const r = await fetch(srv.url + "/api/git?fresh=1", { cache: "no-store" });
    const d = (await r.json()) as { error?: string; enabled?: boolean };
    assert.ok(r.status >= 400 || d.error || d.enabled === false, JSON.stringify(d));
    if (d.error) assert.match(d.error, /plain name/);
    await fx.write("kraftwerk.yml", "name: fixture\ngit:\n  interval: 0\n");
  });

  it("raw run files are sandboxed and nosniffed; PDFs skip the sandbox", async () => {
    const runDir = path.join(fx.root, "output", "runs", "20260101-000000-demo");
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "report.html"), "<script>fetch('/api/git/push',{method:'POST'})</script>");
    await writeFile(path.join(runDir, "doc.pdf"), "%PDF-1.4\n");
    const html = await fetch(srv.url + "/api/runs/20260101-000000-demo/file?name=report.html&raw=1");
    assert.equal(html.status, 200);
    assert.match(html.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(html.headers.get("x-content-type-options"), "nosniff");
    assert.match(html.headers.get("content-security-policy") ?? "", /^sandbox\b/);
    const pdf = await fetch(srv.url + "/api/runs/20260101-000000-demo/file?name=doc.pdf&raw=1");
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("x-content-type-options"), "nosniff");
    assert.equal(pdf.headers.get("content-security-policy"), null);
  });
});
