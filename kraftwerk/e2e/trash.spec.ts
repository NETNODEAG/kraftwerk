import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/** A knowledge bundle deleted in the browser waits in the trash and comes back from there. */
test.describe("trash", () => {
  const NAME = "trash-probe";
  test.afterAll(() => rmSync(path.join(fixture(), "knowledge", NAME), { recursive: true, force: true }));

  test("delete a bundle, find it in the trash, restore it", async ({ page, request }) => {
    expect((await request.post("/api/knowledge", { data: { name: NAME } })).ok()).toBeTruthy();
    await page.goto(`/#/knowledge/${NAME}`);
    await page.getByRole("button", { name: /^delete/ }).click();
    await page.getByRole("button", { name: /move to trash/ }).click();
    await expect(page).not.toHaveURL(new RegExp(`#/knowledge/${NAME}`));
    expect(existsSync(path.join(fixture(), "knowledge", NAME))).toBe(false);

    await page.goto("/#/trash");
    await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
    const row = page.locator(".trash-row", { hasText: NAME });
    await expect(row).toContainText(`knowledge/${NAME}`);
    await row.getByRole("button", { name: /restore/ }).click();
    await expect(row).toHaveCount(0);
    expect(existsSync(path.join(fixture(), "knowledge", NAME, "index.md"))).toBe(true);
  });
});
