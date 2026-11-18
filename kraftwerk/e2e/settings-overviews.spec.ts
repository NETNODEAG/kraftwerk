import { expect, test } from "@playwright/test";

/**
 * The admin overviews under the settings: every agent (#/settings/agents)
 * and every routine (#/settings/routines) of the workspace on one page each,
 * reached through the settings navigation.
 */
test.describe("settings overviews", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    expect((await request.post("/api/agents", { data: { name: "Overview Otter", emoji: "🦦", harness: "claude", system: "x", description: "keeps the lists" } })).status()).toBe(200);
    // Scheduled far away (1 January, 03:00): the scheduler never fires it during the run.
    expect((await request.post("/api/routines", { data: { name: "Overview check", schedule: "0 3 1 1 *", prompt: "who am i", agent: "overview-otter" } })).status()).toBe(200);
  });
  test.afterAll(async ({ request }) => {
    await request.delete("/api/routines/overview-check");
    await request.delete("/api/agents/overview-otter");
  });

  test("the agents overview lists every agent with what it runs on, filters, and leads to the agent", async ({ page }) => {
    await page.goto("/#/settings");
    const nav = page.locator(".settings-nav");
    await nav.locator("a", { hasText: "agents" }).click();
    await expect(page).toHaveURL(/#\/settings\/agents$/);
    await expect(nav.locator("a", { hasText: "agents" })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("a", { hasText: "base settings" })).not.toHaveAttribute("aria-current", "page");

    const row = page.locator(".agents-admin tr[data-agent='overview-otter']");
    await expect(row).toContainText("Overview Otter");
    await expect(row).toContainText("keeps the lists");
    await expect(row).toContainText("claude");
    await expect(row).toContainText("Overview check");

    await page.getByLabel("filter agents").fill("no such agent");
    await expect(page.locator(".agents-admin")).toHaveCount(0);
    await page.getByLabel("filter agents").fill("otter");
    await expect(page.locator(".agents-admin tbody tr")).toHaveCount(1);

    await row.locator("a", { hasText: "keeps the lists" }).click();
    await expect(page).toHaveURL(/#\/agents\/overview-otter$/);
  });

  test("the routines overview lists every routine with who runs it and when, and opens it in a window over the list", async ({ page }) => {
    await page.goto("/#/settings");
    const nav = page.locator(".settings-nav");
    await nav.locator("a", { hasText: "routines" }).click();
    await expect(page).toHaveURL(/#\/settings\/routines$/);
    await expect(nav.locator("a", { hasText: "routines" })).toHaveAttribute("aria-current", "page");

    const row = page.locator(".routines-admin tr[data-routine='_:overview-check']");
    await expect(row).toContainText("Overview check");
    await expect(row).toContainText("Overview Otter");
    await expect(row).toContainText("0 3 1 1 *");
    await expect(row).toContainText("never ran");

    await row.getByRole("link", { name: /Overview check/ }).click();
    await expect(page).toHaveURL(/#\/settings\/routines\?open=_%3Aoverview-check/);
    const dialog = page.getByRole("dialog", { name: "routine" });
    await expect(dialog.getByRole("textbox", { name: "name" })).toHaveValue("Overview check");
    // The schedule reads in words where it can; this one (1 January, 03:00) stays a cron line.
    await expect(dialog.getByRole("combobox", { name: "repeats" })).toHaveValue("custom");
    await expect(dialog.getByRole("textbox", { name: "schedule (cron)" })).toHaveValue("0 3 1 1 *");
    await dialog.getByRole("button", { name: "close (esc)" }).click();
    await expect(page).toHaveURL(/#\/settings\/routines$/);
    await expect(row).toBeVisible();
  });

  test("workflows and knowledge have an overview table too: a row per thing, leading to its page", async ({ page, request }) => {
    expect((await request.post("/api/knowledge", { data: { name: "overview-notes" } })).ok()).toBeTruthy();
    try {
      await page.goto("/#/settings");
      const nav = page.locator(".settings-nav");
      await nav.locator("a", { hasText: "knowledge" }).click();
      await expect(page).toHaveURL(/#\/settings\/knowledge$/);
      await expect(nav.locator("a", { hasText: "knowledge" })).toHaveAttribute("aria-current", "page");
      const bundle = page.locator(".knowledge-admin tr[data-bundle='overview-notes']");
      await expect(bundle).toBeVisible();
      await page.getByRole("textbox", { name: "filter knowledge" }).fill("no such bundle");
      await expect(bundle).toHaveCount(0);
      await page.getByRole("textbox", { name: "filter knowledge" }).fill("overview");
      await bundle.getByRole("link", { name: /overview-notes/ }).click();
      await expect(page).toHaveURL(/#\/knowledge\/overview-notes$/);
      // The bundle's own page still marks "knowledge" in the navigation.
      await expect(nav.locator("a", { hasText: "knowledge" })).toHaveAttribute("aria-current", "page");

      await nav.locator("a", { hasText: "workflows" }).click();
      await expect(page).toHaveURL(/#\/settings\/workflows$/);
      await expect(nav.locator("a", { hasText: "workflows" })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 1, name: "Workflows" })).toBeVisible();
    } finally {
      await request.delete("/api/knowledge/overview-notes");
    }
  });
});
