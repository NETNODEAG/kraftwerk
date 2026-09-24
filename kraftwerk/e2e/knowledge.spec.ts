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
    await expect(page.locator(".shell-global .side-row.active .side-wf")).toHaveText(NAME);

    // The explicit "new" route keeps the form reachable.
    await page.goto("/#/knowledge/new");
    await expect(page.locator(".know-newbundle input")).toBeVisible();
  });
});

/** Bundle pages as a folder tree; the editor opens from the page (in-app route change) and closes back. */
test.describe("knowledge page tree and editor", () => {
  const NAME = "tree-probe";
  test.afterAll(() => rmSync(path.join(fixture(), "knowledge", NAME), { recursive: true, force: true }));

  test("nested pages sit under a collapsible folder, a page opens as a document", async ({ page, request }) => {
    expect((await request.post("/api/knowledge", { data: { name: NAME } })).ok()).toBeTruthy();
    const put = (id: string, title: string) =>
      request.post(`/api/knowledge/${NAME}/concept?id=${encodeURIComponent(id)}`, {
        data: { id, content: `---\ntype: Note\ntitle: ${title}\n---\n\n# ${title}\n\nbody\n` },
      });
    expect((await put("overview", "Overview")).ok()).toBeTruthy();
    expect((await put("stack/frontend", "Frontend stack")).ok()).toBeTruthy();

    await page.goto(`/#/knowledge/${NAME}/stack/frontend`);
    const folder = page.locator(".wiki-folder", { hasText: "stack" });
    await expect(folder).toHaveClass(/open/);
    await expect(page.locator(".wiki-branch .wiki-page.active")).toHaveText("Frontend stack");

    // Collapsing hides the pages; the folder still marks that it holds the open page.
    await folder.click();
    await expect(page.locator(".wiki-branch")).toHaveCount(0);
    await expect(folder).toHaveClass(/holds/);
    await folder.click();
    await expect(page.locator(".wiki-branch .wiki-page")).toHaveCount(1);

    // A page opens as a document in its own box: the rich-text editor is the view, no route change.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await expect(page.locator(".concept-doc .editor-content")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/knowledge/${NAME}/stack/frontend`));
    expect(errors).toEqual([]);

    // The raw file (frontmatter included) is one click away and one click back.
    await page.getByRole("button", { name: "edit markdown" }).click();
    await expect(page.locator("textarea.concept-edit")).toBeVisible();
    await page.getByRole("button", { name: "cancel" }).click();
    await expect(page.locator(".concept-doc .editor-content")).toBeVisible();
    await expect(page.locator(".wiki-page.active")).toHaveText("Frontend stack");
  });
});
