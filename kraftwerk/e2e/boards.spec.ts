import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Boards in the browser: the flag hides the tab, settings turn it on,
 * a project's first board is created on first use from its boards tab, a task
 * is added from a column and lands on disk as a folder, its page logs a
 * comment and a status change, the review count shows on the tab, the
 * palette finds the task, and removal moves the folder to the trash. No
 * agent is woken: nothing is assigned.
 */
test.describe("boards", () => {
  const project = "relaunch-site";
  const boardDir = () => path.join(fixture(), "kraftwerk-data", "projects", project, "boards", "tasks");

  test.beforeAll(async ({ request }) => {
    await request.put("/api/settings", { data: { projects: { enabled: true }, boards: { enabled: false } } });
    await request.post("/api/projects", { data: { title: "Relaunch site", slug: project } });
  });
  test.afterAll(async ({ request }) => {
    await request.delete(`/api/projects/${project}`);
    await request.put("/api/settings", { data: { projects: { enabled: false }, boards: { enabled: false } } });
  });

  test("the project has no boards tab until settings turn the feature on", async ({ page }) => {
    await page.goto(`/#/projects/${project}`);
    await expect(page.getByRole("tab", { name: /boards/ })).toHaveCount(0);
    await expect(page.locator(".rail a[href='#/boards']")).toHaveCount(0);

    await page.goto("/#/settings");
    await page.getByRole("checkbox", { name: /keep the work as boards of tasks/ }).check();
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    expect(readFileSync(path.join(fixture(), "kraftwerk.yml"), "utf8")).toMatch(/^boards: \{\}$/m);

    await page.goto(`/#/projects/${project}`);
    // A project's boards are a tab of its context column; the rail has neither a boards group nor rows under a project.
    await expect(page.locator(".rail a[href='#/boards']")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /boards/ })).toBeVisible();
    await expect(page.locator(".rail [data-nested]")).toHaveCount(0);
  });

  test("the boards tab opens the default board, created on first use; a task added from a column is a folder", async ({ page }) => {
    await page.goto(`/#/projects/${project}`);
    await page.getByRole("tab", { name: /boards/ }).click();
    await page.locator(".ctx").getByRole("link", { name: "Open the tasks board" }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/boards/tasks$`));
    expect(existsSync(path.join(boardDir(), "board.md"))).toBe(true);
    for (const col of ["Draft", "Todo", "In progress", "Review", "Done"]) await expect(page.getByRole("region", { name: col })).toBeVisible();

    const todo = page.getByRole("region", { name: "Todo" });
    await todo.getByRole("button", { name: /task/ }).click();
    await page.getByRole("textbox", { name: "new task in todo" }).fill("Write a press release");
    await page.keyboard.press("Enter");
    await expect(todo.getByText("Write a press release")).toBeVisible();
    const dir = path.join(boardDir(), "tasks", "1-write-a-press-release");
    await expect.poll(() => existsSync(path.join(dir, "task.md"))).toBe(true);
    expect(readFileSync(path.join(dir, "task.md"), "utf8")).toMatch(/^status: todo$/m);
    expect(readFileSync(path.join(dir, "log.md"), "utf8")).toMatch(/Created in Todo \(human:user\)/);
  });

  test("the task page logs a comment and a status change; a task in review counts on the project's boards tab", async ({ page }) => {
    await page.goto(`/#/projects/${project}/boards/tasks/1-write-a-press-release`);
    await expect(page.getByRole("textbox", { name: "task title" })).toHaveValue("Write a press release");
    await page.getByRole("textbox", { name: "log entry" }).fill("draft is on its way");
    await page.keyboard.press("Enter");
    await expect(page.getByText("draft is on its way")).toBeVisible();
    const log = () => readFileSync(path.join(boardDir(), "tasks", "1-write-a-press-release", "log.md"), "utf8");
    await expect.poll(log).toMatch(/draft is on its way \(human:user\)/);

    await page.getByRole("combobox", { name: "status" }).selectOption("review");
    await expect.poll(() => readFileSync(path.join(boardDir(), "tasks", "1-write-a-press-release", "task.md"), "utf8")).toMatch(/^status: review$/m);
    await expect.poll(log).toMatch(/Moved Todo → Review \(human:user\)/);
    // The board is a page of its own; back in the project, its boards tab counts what waits for review.
    await page.goto(`/#/projects/${project}`);
    await expect(page.getByRole("tab", { name: /boards/ })).toContainText("1");
    // The tab shows the board as columns side by side, the task as a card in its column.
    await page.getByRole("tab", { name: /boards/ }).click();
    const columns = page.locator(".ctx .board-glance");
    for (const col of ["Draft", "Todo", "In progress", "Review", "Done"]) await expect(columns.getByRole("group", { name: col })).toBeVisible();
    await expect(columns.getByRole("group", { name: "Review" })).toContainText("Write a press release");
    await expect(columns.getByRole("group", { name: "Todo" })).not.toContainText("Write a press release");
  });

  test("the palette finds the task and opens it", async ({ page }) => {
    await page.goto("/#/");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: /jump to/ });
    await page.getByRole("textbox", { name: "search" }).fill("press release");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await expect(dialog.getByRole("option")).toContainText("task");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/boards/tasks/1-write-a-press-release`));
  });

  test("remove moves the task folder to the trash", async ({ page }) => {
    await page.goto(`/#/projects/${project}/boards/tasks/1-write-a-press-release`);
    await page.getByRole("button", { name: "remove" }).click();
    await page.getByRole("button", { name: "move to trash" }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/boards/tasks$`));
    await expect.poll(() => existsSync(path.join(boardDir(), "tasks", "1-write-a-press-release"))).toBe(false);
    expect(existsSync(path.join(fixture(), "kraftwerk-data", "trash", "tasks", project, "tasks", "1-write-a-press-release", "log.md"))).toBe(true);
  });
});
