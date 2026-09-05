import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * The workflows screen: one searchable list with a ▶ per row, run counts
 * that link to the runs screen (filtered), a request dialog for workflows
 * that read `${{ request }}`, and no "workflow runs" entry in the main nav.
 * Nothing is actually started — the dialog stays on its disabled button.
 */
test.describe("workflows screen", () => {
  test.beforeAll(() => {
    const root = fixture();
    const wf = (slug: string, yml: string) => {
      mkdirSync(path.join(root, "workflows", slug), { recursive: true });
      writeFileSync(path.join(root, "workflows", slug, "workflow.yml"), yml);
    };
    wf("ask", "name: ask\ndescription: answers a question\nagents:\n  a:\n    name: Answerer\n    model: haiku\n    tools: [Read]\n    persona: |\n      You answer.\nsteps:\n  - name: answer\n    agent: a\n    prompt: 'Answer: ${{ request }}'\n");
    wf("tick", "name: tick\ndescription: writes a stamp, needs nothing\nsteps:\n  - name: stamp\n    run: |\n      set -e\n      date > stamp.txt\n");
    const run = path.join(root, "output", "runs", "2026-01-01-1000-00-ask");
    mkdirSync(run, { recursive: true });
    writeFileSync(
      path.join(run, "trace.jsonl"),
      [
        { event: "run_start", ts: "2026-01-01T10:00:00Z", workflow: "ask", request: "why is the sky blue" },
        { event: "phase_end", ts: "2026-01-01T10:00:05Z", phase: "answer", status: "ok", stats: { durationMs: 5000, costUsd: 0.01, attempts: 1 } },
        { event: "run_summary", ts: "2026-01-01T10:00:05Z", total: { durationMs: 5000, costUsd: 0.01 } },
      ].map((e) => JSON.stringify(e)).join("\n") + "\n"
    );
  });

  test("lists workflows with run counts, searches, and keeps runs under workflows", async ({ page }) => {
    await page.goto("/#/workflows");
    await expect(page.locator(".topbar nav")).not.toContainText("workflow runs");
    await expect(page.locator(".topbar nav a", { hasText: "workflows" })).toBeVisible();

    const rows = page.locator(".wf-row");
    await expect(rows).toHaveCount(2);
    const ask = rows.filter({ hasText: "answers a question" });
    await expect(ask.locator(".wf-runs")).toContainText("1 run");
    await expect(ask.getByRole("button", { name: /run…/ })).toBeVisible();
    const tick = rows.filter({ hasText: "writes a stamp" });
    await expect(tick).toContainText("no request");
    await expect(tick.locator(".wf-runs")).toContainText("no runs yet");
    await expect(tick.getByRole("button", { name: /^run$/ })).toBeVisible();

    await page.getByLabel("search workflows").fill("stamp");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("tick");
    await page.getByLabel("search workflows").fill("zzz");
    await expect(page.locator(".wf-nomatch")).toContainText("no workflow matches");
    await page.getByLabel("search workflows").fill("");
    await expect(rows).toHaveCount(2);

    // The run count opens the runs screen filtered to that workflow.
    await ask.locator(".wf-runs").click();
    await expect(page).toHaveURL(/#\/runs\/2026-01-01-1000-00-ask\?workflow=ask/);
    await expect(page.getByLabel("filter runs")).toHaveValue("ask");
    await expect(page.locator(".side-row")).toHaveCount(1);
    await page.getByLabel("filter runs").fill("nothing-like-this");
    await expect(page.locator(".runs-side")).toContainText("no run matches");
    await page.locator(".side-back").click();
    await expect(page).toHaveURL(/#\/workflows$/);

    // The tabs in the page head reach the runs screen too.
    await page.locator(".page-head .tabs a", { hasText: "runs" }).click();
    await expect(page).toHaveURL(/#\/runs\/2026-01-01-1000-00-ask$/);
  });

  test("a workflow that reads the request opens an overview with a request box", async ({ page }) => {
    await page.goto("/#/workflows");
    await page.locator(".wf-row").filter({ hasText: "answers a question" }).getByRole("button", { name: /run…/ }).click();
    const dialog = page.getByRole("dialog", { name: "Run ask" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".m3-headline")).toHaveText("Run ask");
    await expect(dialog.locator(".m3-supporting")).toContainText("answers a question");
    await expect(dialog.locator(".m3-supporting")).toContainText("1 agents · 1 steps");
    // The last request of this workflow is offered again; clearing it disables Run.
    const input = dialog.getByLabel("request");
    await expect(input).toHaveValue("why is the sky blue");
    const run = dialog.getByRole("button", { name: "Run" });
    await input.fill("");
    await expect(run).toBeDisabled();
    await input.fill("what is a rainbow");
    // The sandbox switch starts on only where Docker is usable; SSH
    // forwarding exists only inside the sandbox, so its row follows.
    const sandbox = dialog.getByRole("switch", { name: /Docker sandbox/ });
    const ssh = dialog.getByRole("switch", { name: /SSH/ });
    const on = (await sandbox.getAttribute("aria-checked")) === "true";
    await expect(ssh).toHaveCount(on ? 1 : 0);
    await sandbox.click();
    await expect(sandbox).toHaveAttribute("aria-checked", String(!on));
    await expect(ssh).toHaveCount(on ? 0 : 1);
    await sandbox.click();
    await expect(sandbox).toHaveAttribute("aria-checked", String(on));
    // Off = run locally, which needs nothing but the request.
    if (on) await sandbox.click();
    await expect(run).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
});
