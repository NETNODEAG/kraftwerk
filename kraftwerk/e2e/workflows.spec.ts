import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
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
    wf("triage", "name: triage\ndescription: checks, drafts, publishes\nagents:\n  w:\n    name: Writer\n    model: haiku\n    tools: [Read]\n    persona: |\n      You write.\nsteps:\n  - name: check\n    run: echo ok\n  - name: draft\n    agent: w\n    prompt: 'Draft: ${{ request }}'\n  - name: publish\n    run: echo done\n");
    // Three triage runs: finished, failed on "draft", still running on "publish".
    // Their ids are older than the ask run so #/runs keeps landing on that one;
    // the live run's trace is stamped now so it does not count as stale.
    const steps = [{ name: "check", kind: "script" }, { name: "draft", kind: "agent", agent: "w" }, { name: "publish", kind: "script" }];
    const triage = (id: string, request: string, events: object[], startTs = "2025-12-30T10:00:00Z") => {
      const dir = path.join(root, "output", "runs", id);
      mkdirSync(dir, { recursive: true });
      const all = [{ event: "run_start", ts: startTs, workflow: "triage", request, steps }, ...events];
      writeFileSync(path.join(dir, "trace.jsonl"), all.map((e) => JSON.stringify(e)).join("\n") + "\n");
    };
    const ps = (phase: string, ts: string) => ({ event: "phase_start", ts, phase, kind: steps.find((s) => s.name === phase)!.kind });
    const pe = (phase: string, ts: string, status: string) => ({ event: "phase_end", ts, phase, status, stats: { durationMs: 1000, attempts: 1 } });
    triage("2025-12-30-1000-00-triage", "monday batch", [
      ps("check", "2025-12-30T10:00:01Z"), pe("check", "2025-12-30T10:00:02Z", "ok"),
      ps("draft", "2025-12-30T10:00:03Z"), pe("draft", "2025-12-30T10:00:04Z", "ok"),
      ps("publish", "2025-12-30T10:00:05Z"), pe("publish", "2025-12-30T10:00:06Z", "ok"),
      { event: "run_summary", ts: "2025-12-30T10:00:06Z", total: { durationMs: 3000, costUsd: 0.03 } },
    ]);
    triage("2025-12-30-1100-00-triage", "tuesday batch", [
      ps("check", "2025-12-30T11:00:01Z"), pe("check", "2025-12-30T11:00:02Z", "ok"),
      ps("draft", "2025-12-30T11:00:03Z"), pe("draft", "2025-12-30T11:00:09Z", "failed"),
    ]);
    // Seven finished runs of a one-step workflow: a column shows five and links to the rest.
    wf("bulk", "name: bulk\ndescription: one step, many runs\nsteps:\n  - name: go\n    run: echo go\n");
    for (let i = 0; i < 7; i++) {
      const dir = path.join(root, "output", "runs", `2025-12-29-10${String(i).padStart(2, "0")}-00-bulk`);
      mkdirSync(dir, { recursive: true });
      const ts = `2025-12-29T10:${String(i).padStart(2, "0")}:00Z`;
      writeFileSync(
        path.join(dir, "trace.jsonl"),
        [
          { event: "run_start", ts, workflow: "bulk", request: `batch ${i}`, steps: [{ name: "go", kind: "script" }] },
          { event: "phase_start", ts, phase: "go", kind: "script" },
          { event: "phase_end", ts, phase: "go", status: "ok", stats: { durationMs: 10, attempts: 1 } },
          { event: "run_summary", ts, total: { durationMs: 10 } },
        ].map((e) => JSON.stringify(e)).join("\n") + "\n"
      );
    }
    const now = new Date().toISOString();
    triage("2025-12-30-1200-00-triage", "wednesday batch", [
      ps("check", now), pe("check", now, "ok"),
      ps("draft", now), pe("draft", now, "ok"),
      ps("publish", now),
    ], now);
    writeFileSync(
      path.join(root, "output", "runs", "2025-12-30-1200-00-triage", "decision-request.json"),
      JSON.stringify({ title: "Publish this batch?", prompt: "Check the draft, then ship it or hold it.", options: [{ value: "ship", label: "Ship it" }, { value: "hold", label: "Hold" }] })
    );
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
    // A launch that died before the framework wrote a trace, 20 minutes ago.
    const dead = path.join(root, "output", "runs", "2026-01-01-0900-00-boom");
    mkdirSync(dead, { recursive: true });
    const log = path.join(dead, "trigger.log");
    writeFileSync(log, 'Workflow "boom" needs environment variables that are missing: TOKEN\n');
    const old = new Date(Date.now() - 20 * 60_000);
    utimesSync(log, old, old);
    utimesSync(dead, old, old);
  });

  test("a launch that never wrote a trace shows as failed and can be removed", async ({ page }) => {
    await page.goto("/#/runs/2026-01-01-0900-00-boom");
    const head = page.locator(".shell-global .detail-head");
    await expect(head.locator(".status-word")).toHaveText("failed");
    await expect(head.getByRole("button", { name: /stop/ })).toBeHidden();
    page.once("dialog", (d) => void d.accept());
    await head.getByRole("button", { name: /remove/ }).click();
    await expect(page).toHaveURL(/#\/workflows\/boom/);
    await expect.poll(() => existsSync(path.join(fixture(), "output", "runs", "2026-01-01-0900-00-boom"))).toBe(false);
    await page.goto("/#/runs");
    await expect(page.locator(".shell-global .runs-side")).toContainText("why is the sky blue");
    await expect(page.locator(".shell-global .runs-side")).not.toContainText("boom");
  });

  test("simple mode has conversations and no top navigation; expert mode has every page", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kw-expert", "off"));
    // The rail is part of the conversation view; the pages sit under the top bar on their own.
    await page.goto("/#/agents/chats");
    const rail = page.locator(".rail");
    await expect(rail.locator("a", { hasText: "channels" })).toBeVisible();
    await expect(rail.locator("a", { hasText: "agents" })).toBeVisible();
    // Simple mode has no top navigation at all; expert mode brings every page.
    await expect(page.locator(".global-nav")).toHaveCount(0);

    await page.locator(".expert-toggle").click();
    const nav = page.locator(".global-nav");
    await expect(nav.locator("a", { hasText: "workflows" })).toBeVisible();
    await expect(nav.locator("a", { hasText: "knowledge" })).toBeVisible();
    await expect(nav.locator("a", { hasText: "knowledge" })).not.toContainText("context");
    await expect(nav.locator("a", { hasText: "skills" })).toBeVisible();
  });

  test("lists workflows with run counts, searches, and keeps runs under workflows", async ({ page }) => {
    await page.goto("/#/workflows");
    await expect(page.locator(".global-nav")).not.toContainText("workflow runs");
    await expect(page.locator(".global-nav a", { hasText: "workflows" })).toBeVisible();

    const rows = page.locator(".wf-row");
    await expect(rows).toHaveCount(4);
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
    await expect(rows).toHaveCount(4);

    // The run count opens the runs screen filtered to that workflow.
    await ask.locator(".wf-runs").click();
    await expect(page).toHaveURL(/#\/runs\/2026-01-01-1000-00-ask\?workflow=ask/);
    await expect(page.getByLabel("filter runs")).toHaveValue("ask");
    await expect(page.locator(".shell-global .side-row")).toHaveCount(1);
    await page.getByLabel("filter runs").fill("nothing-like-this");
    await expect(page.locator(".shell-global .runs-side")).toContainText("no run matches");
    await page.locator(".shell-global .side-back").click();
    await expect(page).toHaveURL(/#\/workflows$/);

    // The tabs in the page head reach the runs screen too.
    await page.locator(".page-head .tabs a", { hasText: "runs" }).click();
    await expect(page).toHaveURL(/#\/runs\/2026-01-01-1000-00-ask$/);
  });

  test("the workflow page shows a board: one column per step plus done, each run at the phase it is at", async ({ page }) => {
    await page.goto("/#/workflows/triage");
    const cols = page.locator(".board-col");
    await expect(cols).toHaveCount(4);
    await expect(cols.locator(".board-col-name")).toHaveText(["check", "draft", "publish", "done"]);
    await expect(cols.nth(3)).toHaveClass(/is-done/);
    const col = (name: string) => page.locator(`.board-col[data-step="${name}"]`);
    // Nothing is stuck on the first step; the failed run sits where it broke.
    await expect(col("check").locator(".board-card")).toHaveCount(0);
    await expect(col("check").locator(".board-col-empty")).toBeVisible();
    const failed = col("draft").locator(".board-card");
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText("tuesday batch");
    await expect(failed.locator(".chip.status")).toHaveText("failed");
    // The live run is on its last step, the finished one is done.
    const live = col("publish").locator(".board-card");
    await expect(live).toContainText("wednesday batch");
    await expect(live.locator(".lamp")).toHaveClass(/running/);
    await expect(col("done").locator(".board-card")).toContainText("monday batch");
    await expect(col("done").locator(".board-col-count")).toHaveText("1");
    // A card opens its run.
    await failed.click();
    await expect(page).toHaveURL(/#\/runs\/2025-12-30-1100-00-triage/);

    // A workflow without runs still shows its steps as empty lanes.
    await page.goto("/#/workflows/tick");
    await expect(page.locator(".board-col")).toHaveCount(2);
    await expect(page.locator(".board-col-empty")).toHaveCount(2);

    // A column shows the newest five and links the rest to the runs tab.
    await page.goto("/#/workflows/bulk");
    const doneCol = page.locator('.board-col[data-step="done"]');
    await expect(doneCol.locator(".board-col-count")).toHaveText("7");
    await expect(doneCol.locator(".board-card")).toHaveCount(5);
    await expect(doneCol.locator(".board-card").first()).toContainText("batch 6");
    await doneCol.locator(".board-more").click();
    await expect(page).toHaveURL(/#\/workflows\/bulk\/runs$/);
    await expect(page.locator(".run-card")).toHaveCount(7);
  });

  test("the workflow page has overview, details and runs tabs on their own routes", async ({ page }) => {
    await page.goto("/#/workflows/triage");
    const tabs = page.locator(".shell-global .detail-head .tabs a");
    await expect(tabs).toHaveText(["overview", "details", "runs (3)"]);
    await expect(tabs.nth(0)).toHaveClass(/active/);
    // Overview: what to act on — the trigger and the board, nothing about how it is built.
    await expect(page.locator(".run-panel")).toBeVisible();
    await expect(page.locator(".board")).toBeVisible();
    await expect(page.locator(".pipeline")).toHaveCount(0);

    await tabs.nth(1).click();
    await expect(page).toHaveURL(/#\/workflows\/triage\/details$/);
    await expect(tabs.nth(1)).toHaveClass(/active/);
    await expect(page.locator(".pipeline .step-node")).toHaveCount(3);
    await expect(page.locator(".agent-card")).toContainText("Writer");
    await expect(page.locator(".board")).toHaveCount(0);

    await tabs.nth(2).click();
    await expect(page).toHaveURL(/#\/workflows\/triage\/runs$/);
    const cards = page.locator(".run-card");
    await expect(cards).toHaveCount(3);
    // Newest first; the live run shows its current step where the others show their request.
    await expect(cards.nth(0)).toContainText("publish");
    await expect(cards.nth(0).locator(".status-word")).toHaveText("running");
    await expect(cards.nth(1)).toContainText("tuesday batch");
    await expect(cards.nth(1).locator(".status-word")).toHaveText("failed");
    await expect(cards.nth(2)).toContainText("monday batch");
    await cards.nth(2).click();
    await expect(page).toHaveURL(/#\/runs\/2025-12-30-1000-00-triage/);

    // A direct link lands on the tab.
    await page.goto("/#/workflows/tick/runs");
    await expect(page.locator(".shell-global .empty")).toContainText("no runs of this workflow yet");
  });

  test("running from the overview stays on the overview and the new run appears on the board", async ({ page }) => {
    // The launch is answered by a stub; the run folder is written by hand so
    // the board has something to show without spawning the framework.
    await page.route("**/api/workflows/triage/run", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const id = "2025-12-30-1300-00-triage";
      const dir = path.join(fixture(), "output", "runs", id);
      mkdirSync(dir, { recursive: true });
      const now = new Date().toISOString();
      writeFileSync(
        path.join(dir, "trace.jsonl"),
        [
          { event: "run_start", ts: now, workflow: "triage", request: "thursday batch", steps: [{ name: "check", kind: "script" }, { name: "draft", kind: "agent", agent: "w" }, { name: "publish", kind: "script" }] },
          { event: "phase_start", ts: now, phase: "check", kind: "script" },
        ].map((e) => JSON.stringify(e)).join("\n") + "\n"
      );
      await route.fulfill({ json: { runId: id } });
    });
    await page.goto("/#/workflows/triage");
    const field = page.getByLabel("request");
    await field.fill("thursday batch");
    await page.locator(".run-panel").getByRole("button", { name: /Run/ }).click();
    await expect(page).toHaveURL(/#\/workflows\/triage$/);
    const col = page.locator('.board-col[data-step="check"]');
    await expect(col.locator(".board-card")).toContainText("thursday batch");
    await expect(col.locator(".board-card .lamp")).toHaveClass(/running/);
    await expect(page.locator(".run-panel").getByRole("button", { name: /Run/ })).toBeEnabled();
    await expect(page.locator(".shell-global .detail-head .tabs a").nth(2)).toHaveText("runs (4)");
  });

  test("a run that asks for a decision gets a form on its page and a chip on the board; the answer lands as a file", async ({ page }) => {
    await page.goto("/#/workflows/triage");
    const card = page.locator('.board-col[data-step="publish"] .board-card');
    await expect(card.locator(".chip.decision")).toHaveText("decision needed");
    await card.click();
    const panel = page.locator(".decision-panel");
    await expect(panel).toContainText("Publish this batch?");
    await expect(panel).toContainText("ship it or hold it");
    const submit = panel.getByRole("button", { name: "Submit decision" });
    await expect(submit).toBeDisabled();
    await panel.getByRole("radio", { name: "Ship it" }).click();
    await panel.getByLabel("note").fill("looks right");
    await submit.click();
    // The answer is a file in the run folder, written once.
    const file = path.join(fixture(), "output", "runs", "2025-12-30-1200-00-triage", "decision.json");
    await expect.poll(() => existsSync(file)).toBe(true);
    const written = JSON.parse(readFileSync(file, "utf8")) as { decision: string; note: string; by: string };
    expect(written.decision).toBe("ship");
    expect(written.note).toBe("looks right");
    expect(written.by).toBe("human");
    await expect(panel).toHaveClass(/is-decided/);
    await expect(panel).toContainText("Ship it");
    await expect(panel).toContainText("looks right");
    await expect(panel.getByRole("radio")).toHaveCount(0);
    // The board no longer flags it.
    await page.goto("/#/workflows/triage");
    await expect(card).toContainText("wednesday batch");
    await expect(card.locator(".chip.decision")).toHaveCount(0);
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
