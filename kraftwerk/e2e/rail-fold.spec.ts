import { expect, test } from "@playwright/test";

/**
 * Projects in the rail: one row each, no sublinks (the assistant, agents,
 * boards, decks and apps live in the project's overview, session picker and
 * context column), and the whole group collapses to the project you are in.
 */
test.describe("rail folding", () => {
  const PROJECTS = ["fold-alpha", "fold-beta", "fold-gamma"];
  test.beforeAll(async ({ request }) => {
    expect((await request.put("/api/settings", { data: { projects: { enabled: true } } })).ok()).toBeTruthy();
    expect((await request.put("/api/agents/fold-helper", { data: { name: "Fold Helper", harness: "claude" } })).ok()).toBeTruthy();
    for (const slug of PROJECTS) {
      expect((await request.post("/api/projects", { data: { title: slug, slug } })).status()).toBe(201);
      expect((await request.post(`/api/projects/${slug}/links`, { data: { kind: "agents", target: "fold-helper" } })).ok()).toBeTruthy();
    }
  });
  test.afterAll(async ({ request }) => {
    for (const slug of PROJECTS) await request.delete(`/api/projects/${slug}`);
    await request.delete("/api/agents/fold-helper");
    await request.put("/api/settings", { data: { projects: { enabled: false } } });
  });

  test("a project is one row; its agents are in the session picker, not the rail", async ({ page }) => {
    await page.goto("/#/projects/fold-alpha");
    const row = page.locator(".rail a[data-project='fold-alpha']");
    await expect(row).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".rail [data-nested]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(expand|collapse) fold-/ })).toHaveCount(0);
    await page.getByRole("button", { name: "session with" }).click();
    await expect(page.getByRole("menuitemradio", { name: /Fold Helper/ })).toBeVisible();
  });

  test("the whole group collapses to the project you are in", async ({ page }) => {
    const projectRow = (slug: string) => page.locator(`.rail a[data-project='${slug}']`);
    await page.goto("/#/projects/fold-alpha");
    await page.getByRole("button", { name: "collapse projects" }).click();
    await expect(projectRow("fold-alpha")).toBeVisible();
    await expect(projectRow("fold-beta")).toHaveCount(0);
    await expect(projectRow("fold-gamma")).toHaveCount(0);
    await page.reload();
    await expect(projectRow("fold-beta")).toHaveCount(0);
    await page.locator(".rail").getByRole("button", { name: /\d+ more$/ }).click();
    await expect(projectRow("fold-gamma")).toBeVisible();
    await page.evaluate(() => localStorage.removeItem("kw-rail-fold"));
  });
});
