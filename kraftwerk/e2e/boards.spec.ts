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

  test("Home lists the task and shows it on the right; a card of the board's preview opens its task there too", async ({ page }) => {
    await page.goto("/#/");
    const tiles = page.getByRole("region", { name: "kinds" });
    await tiles.getByRole("button", { name: "show only tasks" }).click();
    const row = page.locator(".artifact-row").filter({ hasText: "Write a press release" });
    await expect(row).toContainText("#1 · Tasks · Review");
    await row.click();
    const preview = page.getByRole("complementary", { name: "Preview" });
    await expect(preview.getByRole("textbox", { name: "task title" })).toHaveValue("Write a press release");
    await expect(preview.getByRole("link", { name: "open", exact: true })).toHaveAttribute("href", `#/projects/${project}/boards/tasks/1-write-a-press-release`);

    // From the board: its columns in the preview, a card opening the task in the same column.
    await tiles.getByRole("button", { name: "show only boards" }).click();
    await page.locator(".artifact-row[data-artifact='boards']").first().click();
    // "new task" on the board's preview opens a modal; the task lands in the column picked, without leaving Home.
    await preview.getByRole("button", { name: "new task" }).click();
    const dialog = page.getByRole("dialog", { name: "new task" });
    await expect(dialog.getByRole("combobox", { name: "new task column" })).toHaveValue("todo");
    await expect(dialog.getByRole("button", { name: "add task" })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "new task title" }).fill("Book the venue");
    await dialog.getByRole("textbox", { name: "new task notes" }).fill("Somewhere with a stage.");
    await dialog.getByRole("button", { name: "add task" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(preview.locator(".board-glance").getByRole("group", { name: "Todo" })).toContainText("Book the venue");
    await expect.poll(() => existsSync(path.join(boardDir(), "tasks", "2-book-the-venue", "task.md"))).toBe(true);
    expect(readFileSync(path.join(boardDir(), "tasks", "2-book-the-venue", "task.md"), "utf8")).toMatch(/Somewhere with a stage/);
    // Escape closes it without making anything.
    await preview.getByRole("button", { name: "new task" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await preview.locator(".board-glance").getByRole("link", { name: /Write a press release/ }).click();
    await expect(page).toHaveURL(/open=tasks/);
    await expect(preview.getByRole("textbox", { name: "task title" })).toHaveValue("Write a press release");
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

  test("a workspace board is linked from the project's boards list and unlinked in its settings", async ({ page, request }) => {
    expect((await request.post("/api/boards", { data: { title: "Ops desk", slug: "ops-desk" } })).status()).toBe(201);
    try {
      await page.goto(`/#/projects/${project}/boards/tasks`);
      await page.getByRole("combobox", { name: "link a workspace board" }).selectOption("ops-desk");
      await expect(page).toHaveURL(/#\/boards\/ops-desk$/);
      expect(readFileSync(path.join(fixture(), "kraftwerk-data", "boards", "ops-desk", "board.md"), "utf8")).toMatch(new RegExp(`^projects:\\n  - ${project}$`, "m"));

      await page.goto(`/#/projects/${project}/boards/tasks`);
      const row = page.locator(".runs-side").getByRole("link", { name: /Ops desk/ });
      await expect(row).toContainText("workspace board");
      await expect(page.getByRole("combobox", { name: "link a workspace board" })).toHaveCount(0);

      await page.goto("/#/boards/ops-desk/settings");
      await page.getByRole("checkbox", { name: "Relaunch site" }).uncheck();
      await page.getByRole("button", { name: "save", exact: true }).click();
      await expect(page.getByText("saved", { exact: true })).toBeVisible();
      await page.goto(`/#/projects/${project}/boards/tasks`);
      await expect(page.locator(".runs-side").getByRole("link", { name: /Ops desk/ })).toHaveCount(0);
    } finally {
      await request.delete("/api/boards/ops-desk");
    }
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
