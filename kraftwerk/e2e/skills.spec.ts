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

    const dir = path.join(fixture(), "skills", NAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), "---\nname: landing-probe\ndescription: probes the landing\n---\n# Landing probe\n");
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#/skills/${NAME}`));
    await expect(page.locator(".shell-global .runs-side a[aria-current=page]")).toContainText(`/${NAME}`);
  });

  test("a skill opened on Home is used from there: its command plus the user's text starts a new chat beside the list", async ({ page }) => {
    await page.goto(`/#/?kind=skills&open=${encodeURIComponent(`skills:${NAME}`)}`);
    const run = page.getByRole("region", { name: "use this skill" });
    await expect(run.locator("code")).toHaveText(`/${NAME}`);
    // Ralv by default; an agent can be picked instead.
    await expect(run.getByLabel("chat with")).toHaveValue("");
    await run.getByLabel("what to do with the skill").fill("tidy this up");
    await run.getByRole("button", { name: "send to a new chat" }).click();
    // The chat takes the skill's place beside the list: Home stays.
    await expect(page).toHaveURL(/kind=skills&open=chats%3A[\w-]+$/);
    const preview = page.getByRole("complementary", { name: "Preview" });
    await expect(preview.locator(".artifact-chat")).toContainText(`/${NAME} tidy this up`);
  });

  test("on the skill's own page the chat opens in a panel beside it; / offers skills and @ picks the agent in a chat window", async ({ page, request }) => {
    expect((await request.put("/api/agents/card-probe", { data: { name: "Card Probe", emoji: "🃏", harness: "claude" } })).status()).toBe(200);
    try {
      await page.goto(`/#/skills/${NAME}`);
      const run = page.getByRole("region", { name: "use this skill" });
      // "@" offers the agents; picking one sets who the chat is with and leaves the text clean.
      const field = run.getByLabel("what to do with the skill");
      await field.fill("look at this @card");
      await run.locator(".card-menu").getByRole("option", { name: /Card Probe/ }).click();
      await expect(run.getByLabel("chat with")).toHaveValue("card-probe");
      await expect(field).toHaveValue("look at this ");
      await run.getByLabel("chat with").selectOption("");
      await run.getByRole("button", { name: "send to a new chat" }).click();
      // The page stays; the chat is beside it, and "open" leads to its own place.
      const aside = page.getByRole("complementary", { name: "Chat started here" });
      await expect(aside).toContainText(`/${NAME} look at this`);
      await expect(page).toHaveURL(new RegExp(`#/skills/${NAME}$`));
      await expect(aside.getByRole("link", { name: "open" })).toHaveAttribute("href", /#\/agents\/chats\/chat-/);
      await aside.getByRole("button", { name: "close the chat panel" }).click();
      await expect(aside).toHaveCount(0);

      // Home's composer is the same window: "/" at the start offers the skills.
      await page.goto("/#/agents/chats");
      const composer = page.getByRole("region", { name: "start a session" });
      await composer.getByRole("textbox", { name: "new session" }).fill("/landing");
      await composer.locator(".card-menu").getByRole("option", { name: new RegExp(`/${NAME}`) }).click();
      await expect(composer.getByRole("textbox", { name: "new session" })).toHaveValue(`/${NAME} `);
    } finally {
      await request.delete("/api/agents/card-probe");
    }
  });
});
