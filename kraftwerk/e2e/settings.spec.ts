import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;
const yml = (): string => readFileSync(path.join(fixture(), "kraftwerk.yml"), "utf8");

test.describe("settings screen", () => {
  test("edits the git sync block of kraftwerk.yml", async ({ page }) => {
    await page.goto("/#/settings");
    const sync = page.getByRole("checkbox", { name: /sync workflows/ });
    await expect(sync).toBeChecked(); // the fixture has a git block

    await page.getByLabel("interval (s)").fill("120");
    await page.getByLabel("autosync").selectOption("off");
    await page.getByRole("textbox", { name: "remote" }).fill("upstream");
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    expect(yml()).toMatch(/^git:\n  remote: upstream\n  interval: 120\n  autosync: off$/m);
    expect(yml()).toMatch(/^name: fixture$/m);

    // Back to the fixture's original block, so the git screen specs see it.
    await page.getByLabel("interval (s)").fill("0");
    await page.getByLabel("autosync").selectOption("pull");
    await page.getByRole("textbox", { name: "remote" }).fill("");
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    expect(yml()).toMatch(/^git:\n  interval: 0$/m);
  });
});
