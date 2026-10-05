import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Files in the browser: upload into the workspace, preview a text file, a
 * new folder, a rename, delete to the trash; and a project's files in the
 * project's context column, with a preview that replaces the list.
 */
test.describe("files", () => {
  test.beforeAll(async ({ request }) => {
    expect((await request.put("/api/settings", { data: { projects: { enabled: true } } })).ok()).toBeTruthy();
    expect((await request.post("/api/projects", { data: { title: "Files probe", slug: "files-probe" } })).status()).toBe(201);
  });
  test.afterAll(async ({ request }) => {
    await request.delete("/api/projects/files-probe");
    await request.put("/api/settings", { data: { projects: { enabled: false } } });
    rmSync(path.join(fixture(), "kraftwerk-data/files"), { recursive: true, force: true });
    rmSync(path.join(fixture(), "kraftwerk-data/trash"), { recursive: true, force: true });
  });

  test("upload, preview, folder, rename, delete to the trash", async ({ page }) => {
    await page.goto("/#/files");
    await expect(page.locator(".files-screen [aria-current=page]")).toContainText("Workspace");
    await expect(page.getByText("Drop files here")).toBeVisible();

    await page.getByLabel("Upload files").setInputFiles({ name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Kickoff\n\n- budget agreed\n") });
    const row = page.locator(".files-row", { hasText: "notes.md" });
    await expect(row).toBeVisible();
    expect(existsSync(path.join(fixture(), "kraftwerk-data/files/notes.md"))).toBe(true);

    await row.getByRole("button", { name: "notes.md", exact: true }).click();
    await expect(page).toHaveURL(/#\/files\/workspace\?file=notes\.md$/);
    await expect(page.locator(".files-preview .files-md h1")).toHaveText("Kickoff");

    await page.getByTitle("New folder").click();
    await page.getByLabel("Folder name").fill("minutes");
    await page.keyboard.press("Enter");
    await expect(page.locator(".files-row", { hasText: "minutes" })).toBeVisible();

    await row.hover();
    await page.getByRole("button", { name: "Rename notes.md" }).click();
    await page.getByLabel("New name").fill("kickoff.md");
    await page.keyboard.press("Enter");
    const renamed = page.locator(".files-row", { hasText: "kickoff.md" });
    await expect(renamed).toBeVisible();

    await renamed.hover();
    await page.getByRole("button", { name: "Delete kickoff.md" }).click();
    await page.getByRole("button", { name: "move to trash" }).click();
    await expect(renamed).toHaveCount(0);
    await page.goto("/#/trash");
    await expect(page.locator(".trash-row", { hasText: "kickoff.md" })).toContainText("kraftwerk-data/files/kickoff.md");
  });

  test("a project's files in its context column", async ({ page, request }) => {
    const up = await request.post("/api/files/upload?scope=project:files-probe&path=briefing", {
      headers: { "x-file-name": "brief.txt", "content-type": "text/plain" },
      data: Buffer.from("Launch in November."),
    });
    expect(up.status()).toBe(201);
    const chat = (await (await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "project", slug: "files-probe" } } })).json()) as { id: string };
    await page.goto(`/#/projects/files-probe/chat/${chat.id}`);
    await page.getByRole("tab", { name: /files/ }).click();
    const ctx = page.locator(".ctx .files-browser");
    await ctx.getByRole("button", { name: "briefing", exact: true }).click();
    await ctx.getByRole("button", { name: "brief.txt", exact: true }).click();
    await expect(ctx.locator(".files-text")).toHaveText("Launch in November.");
    await expect(ctx.locator(".files-list")).toHaveCount(0);
    await ctx.getByRole("button", { name: "Back to the folder" }).click();
    await expect(ctx.locator(".files-row", { hasText: "brief.txt" })).toBeVisible();
    await request.delete(`/api/chats/${chat.id}`);
  });
});
