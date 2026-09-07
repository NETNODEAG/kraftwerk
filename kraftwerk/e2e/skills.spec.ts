import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/** Where #/skills lands: on a one-line "how to add one" while there are none, on the first workspace skill once one exists. */
test.describe("skills landing", () => {
  const NAME = "landing-probe";
  test.afterAll(() => rmSync(path.join(fixture(), "skills", NAME), { recursive: true, force: true }));

  test("empty workspace shows only the hint, a skill becomes the landing", async ({ page }) => {
    await page.goto("/#/skills");
    await expect(page.locator(".empty-action")).toContainText("SKILL.md");
    await expect(page.locator(".know-intro")).toHaveCount(0);

    const dir = path.join(fixture(), "skills", NAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), "---\nname: landing-probe\ndescription: probes the landing\n---\n# Landing probe\n");
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#/skills/${NAME}`));
    await expect(page.locator(".side-row.active .side-wf")).toHaveText(`/${NAME}`);
  });
});
