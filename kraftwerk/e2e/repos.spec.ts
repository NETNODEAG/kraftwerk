import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;
const yml = (): string => readFileSync(path.join(fixture(), "kraftwerk.yml"), "utf8");

/** A local upstream next to the fixture, so the clone never touches the network. */
function makeUpstream(): string {
  const dir = path.join(fixture(), "..", "upstream-widgets");
  mkdirSync(dir, { recursive: true });
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "up@example.com");
  g("config", "user.name", "up");
  g("config", "commit.gpgsign", "false");
  writeFileSync(path.join(dir, "README.md"), "# widgets\n");
  g("add", ".");
  g("commit", "-qm", "first");
  return dir;
}

test.describe("repositories", () => {
  // The fixture is shared by every spec and by a CI retry: start from and
  // return to "off", whatever an earlier attempt left behind.
  test.beforeAll(async ({ request }) => {
    await request.put("/api/settings", { data: { repos: { enabled: false } } });
  });
  test.afterAll(async ({ request }) => {
    await request.put("/api/settings", { data: { repos: { enabled: false } } });
  });

  test("is hidden until settings turn it on", async ({ page }) => {
    await page.goto("/#/settings");
    const nav = page.locator("nav a[href='#/repos']");
    await expect(nav).toHaveCount(0);
    await page.getByRole("checkbox", { name: /keep git repositories/ }).check();
    await page.getByRole("textbox", { name: "repos root" }).fill("kraftwerk-data/repos");
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    expect(yml()).toMatch(/^repos:\n  root: kraftwerk-data\/repos$/m);
    await expect(nav).toBeVisible();
  });

  test("clones by url, lists the clone, removes it", async ({ page }) => {
    const upstream = makeUpstream();
    await page.goto("/#/repos");
    await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
    await expect(page.getByText("Nothing cloned yet.")).toBeVisible();

    await page.getByRole("textbox", { name: "url" }).fill(upstream);
    await page.getByRole("textbox", { name: "name" }).fill("widgets");
    await page.getByRole("button", { name: "clone" }).click();

    const row = page.locator(".repo-row[data-repo=widgets]");
    await expect(row).toBeVisible();
    await expect(row).toContainText("main");
    await expect(row).toContainText("first");
    await expect(row).toContainText("clean");

    await row.getByRole("button", { name: "update" }).click();
    await expect(row.getByRole("button", { name: "update" })).toBeEnabled();

    await row.getByRole("button", { name: "remove" }).click();
    await row.getByRole("button", { name: "confirm remove" }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByText("Nothing cloned yet.")).toBeVisible();
  });

  test("removes a clone git cannot read: the confirm button forces it", async ({ page }) => {
    // A .git file pointing nowhere: listed as unreadable, refused without force.
    mkdirSync(path.join(fixture(), "kraftwerk-data/repos/broken"), { recursive: true });
    writeFileSync(path.join(fixture(), "kraftwerk-data/repos/broken/.git"), "gitdir: /nonexistent-gitdir\n");
    await page.goto("/#/repos");
    const row = page.locator(".repo-row[data-repo=broken]");
    await expect(row).toBeVisible();
    await expect(row).toContainText("unreadable");
    await row.getByRole("button", { name: "remove" }).click();
    await row.getByRole("button", { name: "delete anyway" }).click();
    await expect(row).toHaveCount(0);
  });
});
