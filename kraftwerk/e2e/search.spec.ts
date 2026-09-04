import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

test.describe("agent palette", () => {
  test.beforeAll(() => {
    for (const [slug, yml] of [
      ["writer", "name: Writer\nemoji: ✍️\ndescription: drafts blog posts\n"],
      ["reviewer", "name: Reviewer\nemoji: 🔍\n"],
    ]) {
      mkdirSync(path.join(fixture(), "agents", slug), { recursive: true });
      writeFileSync(path.join(fixture(), "agents", slug, "agent.yml"), yml);
    }
  });

  test("⌘K opens it, typing filters, enter jumps to the agent", async ({ page }) => {
    await page.goto("/#/workflows");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "jump to an agent" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("option")).toHaveCount(2);

    await page.getByRole("textbox", { name: "search agents" }).fill("wri");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await expect(dialog.getByRole("option")).toContainText("Writer");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/#\/agents\/writer/);
  });

  test("escape closes it, the header button opens it", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: "search agents" }).click();
    const dialog = page.getByRole("dialog", { name: "jump to an agent" });
    await expect(dialog).toBeVisible();
    await page.getByRole("textbox", { name: "search agents" }).fill("nothing like this");
    await expect(dialog.getByText(/no agent matches/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
