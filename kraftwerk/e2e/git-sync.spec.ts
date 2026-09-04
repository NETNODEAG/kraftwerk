import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;
const git = (root: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

test.describe("git sync screen", () => {
  test("lists workspace changes and keeps secrets out of reach", async ({ page }) => {
    await page.goto("/#/git");
    await expect(page.getByRole("link", { name: /git/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Git sync" })).toBeVisible();

    const notes = page.locator(".git-row", { hasText: "knowledge/notes.md" });
    await expect(notes).toBeVisible();
    await expect(notes.getByRole("checkbox")).toBeVisible();

    // .env is listed, but only as blocked, with no checkbox and no diff.
    await page.getByText(/outside the workspace paths/).click();
    const env = page.locator(".git-row.blocked", { hasText: "knowledge/.env" });
    await expect(env).toContainText("secret or key");
    await expect(env.getByRole("checkbox")).toHaveCount(0);
  });

  test("commits exactly the selected file", async ({ page }) => {
    const root = fixture();
    await page.goto("/#/git");
    const notes = page.locator(".git-row", { hasText: "knowledge/notes.md" });
    await notes.getByRole("checkbox").check();
    await expect(page.getByText("1 of 2 selected")).toBeVisible();

    await page.getByPlaceholder("Commit message").fill("add notes from the browser");
    await page.getByRole("button", { name: /^commit/ }).click();

    await expect(page.getByText("committed 1 file")).toBeVisible();
    await expect(notes).toHaveCount(0);
    await expect(page.locator(".git-row", { hasText: "kraftwerk.yml" })).toBeVisible();
    expect(git(root, "log", "--format=%s", "-1")).toBe("add notes from the browser");
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe("knowledge/notes.md");
  });

  test("picks up a file written outside the browser", async ({ page }) => {
    const root = fixture();
    await page.goto("/#/git");
    execFileSync("node", ["-e", "require('fs').writeFileSync(process.argv[1], '# from disk\\n')", path.join(root, "knowledge", "later.md")]);
    const row = page.locator(".git-row", { hasText: "knowledge/later.md" });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button").click();
    await expect(row.locator(".git-diff")).toContainText("+# from disk");
  });
});
