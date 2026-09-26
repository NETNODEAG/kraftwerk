import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

test.describe("palette", () => {
  test.beforeAll(async ({ request }) => {
    // Projects are off in the fixture; the palette lists them only while the feature is on.
    await request.put("/api/settings", { data: { projects: { enabled: true } } });
    mkdirSync(path.join(fixture(), "channels", "marketing-sales"), { recursive: true });
    writeFileSync(path.join(fixture(), "channels", "marketing-sales", "channel.yml"), "name: Marketing & Sales\npurpose: campaigns and leads\nmembers: [writer]\n");
    mkdirSync(path.join(fixture(), "kraftwerk-data", "projects", "relaunch-the-website"), { recursive: true });
    writeFileSync(path.join(fixture(), "kraftwerk-data", "projects", "relaunch-the-website", "project.yml"), "title: Relaunch the website\ngoal: ship the new site\n");
    for (const [slug, yml] of [
      ["writer", "name: Writer\nemoji: ✍️\ndescription: drafts blog posts\n"],
      ["reviewer", "name: Reviewer\nemoji: 🔍\n"],
    ]) {
      mkdirSync(path.join(fixture(), "agents", slug), { recursive: true });
      writeFileSync(path.join(fixture(), "agents", slug, "agent.yml"), yml);
    }
  });
  test.afterAll(async ({ request }) => {
    await request.put("/api/settings", { data: { projects: { enabled: false } } });
  });

  test("⌘K opens it grouped by workspace, typing filters, enter jumps to the agent", async ({ page }) => {
    await page.goto("/#/workflows");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "jump to an agent, project or channel" });
    await expect(dialog).toBeVisible();
    const group = dialog.locator(".palette-group");
    await expect(group).toHaveCount(1);
    await expect(group).toContainText("fixture");
    await expect(group).toContainText("this workspace");
    await expect(dialog.getByRole("option", { name: /Writer/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Marketing & Sales/ })).toContainText("channel");
    await expect(dialog.getByRole("option", { name: /Relaunch the website/ })).toContainText("project");

    await page.getByRole("textbox", { name: "search" }).fill("wri");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await expect(dialog.getByRole("option")).toContainText("Writer");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/#\/agents\/writer/);
  });

  test("finds a project by its goal and opens it", async ({ page }) => {
    await page.goto("/#/");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "jump to an agent, project or channel" });
    await page.getByRole("textbox", { name: "search" }).fill("new site");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await expect(dialog.getByRole("option")).toContainText("Relaunch the website");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/projects\/relaunch-the-website/);
  });

  test("finds a channel and opens it", async ({ page }) => {
    await page.goto("/#/");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "jump to an agent, project or channel" });
    await page.getByRole("textbox", { name: "search" }).fill("leads");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await expect(dialog.getByRole("option")).toContainText("Marketing & Sales");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/channels\/marketing-sales/);
  });

  test("escape closes it, the header button opens it", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("button", { name: "search" }).click();
    const dialog = page.getByRole("dialog", { name: "jump to an agent, project or channel" });
    await expect(dialog).toBeVisible();
    await page.getByRole("textbox", { name: "search" }).fill("nothing like this");
    await expect(dialog.getByText(/no agent, project or channel matches/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
