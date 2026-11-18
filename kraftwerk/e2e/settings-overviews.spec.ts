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

  test("the routines overview lists every routine with who runs it and when, and opens it on Home", async ({ page }) => {
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
    await expect(page).toHaveURL(/open=routines%3A_%3Aoverview-check/);
    await expect(page.locator(".artifact-row[data-key='routines:_:overview-check']")).toBeVisible();
  });
});
