import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/** Where #/knowledge lands: on the create form while there are no bundles, on the latest bundle once one exists. */
test.describe("knowledge landing", () => {
  const NAME = "landing-probe";
  test.afterAll(() => rmSync(path.join(fixture(), "knowledge", NAME), { recursive: true, force: true }));

  test("empty workspace shows only the create form, a bundle becomes the landing", async ({ page, request }) => {
    await page.goto("/#/knowledge");
    await expect(page.locator(".empty-action .know-newbundle input")).toBeVisible();
    await expect(page.locator(".know-intro")).toHaveCount(0);

    const created = await request.post("/api/knowledge", { data: { name: NAME } });
    expect(created.ok()).toBeTruthy();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#/knowledge/${NAME}`));
    await expect(page.locator(".side-row.active .side-wf")).toHaveText(NAME);

    // The explicit "new" route keeps the form reachable.
    await page.goto("/#/knowledge/new");
    await expect(page.locator(".know-newbundle input")).toBeVisible();
  });
});
