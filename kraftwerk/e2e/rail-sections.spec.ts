import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Sorting the rail's projects: a new section is named in place, a project
 * dragged onto it lands in it, Alt+↑ moves a project a step (out of the
 * section again), a folded section hides its projects, and removing it
 * hands them to the group above. The layout is the workspace's order.yml.
 */
test.describe("rail sections", () => {
  const PROJECTS = ["sort-alpha", "sort-beta", "sort-gamma"];
  test.beforeAll(async ({ request }) => {
    expect((await request.put("/api/settings", { data: { projects: { enabled: true } } })).ok()).toBeTruthy();
    for (const slug of PROJECTS) expect((await request.post("/api/projects", { data: { title: slug, slug } })).status()).toBe(201);
  });
  test.afterAll(async ({ request }) => {
    for (const slug of PROJECTS) await request.delete(`/api/projects/${slug}`);
    await request.put("/api/projects", { data: { top: [], sections: [] } });
    await request.put("/api/settings", { data: { projects: { enabled: false } } });
  });

  test("create a section, drag a project into it, move it out, fold and remove it", async ({ page }) => {
    const rail = page.locator(".rail");
    const order = async () => rail.locator("[data-sort], [data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-sort") ?? `#${e.getAttribute("data-section")}`));
    const orderYml = () => readFileSync(path.join(fixture(), "kraftwerk-data", "projects", "order.yml"), "utf8");

    await page.goto("/#/agents/chats");
    await expect(rail.locator("[data-sort='sort-gamma']")).toBeVisible();

    await rail.getByRole("button", { name: "new section" }).click();
    const name = rail.getByRole("textbox", { name: "section name" });
    await expect(name).toBeFocused();
    await name.fill("Clients");
    await name.press("Enter");
    const section = rail.locator("[data-section='Clients']");
    await expect(section).toBeVisible();

    await rail.locator("[data-sort='sort-alpha']").dragTo(section);
    await expect.poll(order).toEqual(expect.arrayContaining(["#Clients", "sort-alpha"]));
    expect((await order()).slice(-2)).toEqual(["#Clients", "sort-alpha"]);
    await expect.poll(orderYml).toMatch(/- name: Clients\n {4}projects:\n {6}- sort-alpha/);

    // Survives a reload: the layout is the workspace's.
    await page.reload();
    await expect.poll(async () => (await order()).slice(-2)).toEqual(["#Clients", "sort-alpha"]);

    // Alt+↑ moves it a step: above the heading, out of the section.
    await rail.locator("a[data-project='sort-alpha']").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(async () => (await order()).slice(-2)).toEqual(["sort-alpha", "#Clients"]);

    // Fold: the section's projects hide; unfold brings them back.
    await rail.locator("[data-sort='sort-beta']").dragTo(section);
    await expect.poll(async () => (await order()).slice(-2)).toEqual(["#Clients", "sort-beta"]);
    await section.locator("button[aria-expanded]").click();
    await expect(rail.locator("[data-sort='sort-beta']")).toHaveCount(0);
    await section.locator("button[aria-expanded]").click();
    await expect(rail.locator("[data-sort='sort-beta']")).toBeVisible();

    // Removing the section hands its projects to the group above.
    await section.hover();
    await rail.getByRole("button", { name: "remove section Clients" }).click();
    await expect(section).toHaveCount(0);
    await expect(rail.locator("[data-sort='sort-beta']")).toBeVisible();
    await expect.poll(orderYml).not.toMatch(/Clients/);
  });
});
