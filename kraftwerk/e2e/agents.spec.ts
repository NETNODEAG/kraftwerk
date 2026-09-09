import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Where #/agents lands: on nothing but the create button while the workspace
 * has no agents, on the agent (its profile, since nobody has talked to it)
 * once one exists. No session is started, so no coding agent runs.
 */
test.describe("agents landing", () => {
  const SLUG = "landing-probe";
  test.afterAll(() => rmSync(path.join(fixture(), "agents", SLUG), { recursive: true, force: true }));

  test("empty workspace shows only the create button, an agent becomes the landing", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kw-expert", "on"));
    await page.goto("/#/agents");
    await expect(page.locator(".empty-action .run-btn")).toHaveText(/create your first agent/);
    await expect(page.locator(".new-chat-panel")).toHaveCount(0);

    const dir = path.join(fixture(), "agents", SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "agent.yml"), "name: Landing Probe\nemoji: 🧭\nharness: claude\n");
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#/agents/${SLUG}`));
    await expect(page.locator(".side-row.active .side-wf")).toContainText(/Landing Probe/);
  });
});

/**
 * The "General Chats" entry: with no chats it shows the new-chat pane; once
 * chats exist it opens the most recent one, and /chats/new is the way to a
 * fresh pane. Chats are created over the API and never get a message, so
 * no coding agent runs.
 */
test.describe("general chats landing", () => {
  const ids: string[] = [];
  test.afterAll(async ({ request }) => {
    for (const id of ids) await request.delete(`/api/chats/${id}`);
  });

  test("lands on the latest general chat, /chats/new on a fresh pane", async ({ page, request }) => {
    await page.goto("/#/agents/chats");
    await expect(page.getByRole("button", { name: "start chat" })).toBeVisible();

    const older = await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "general" } } });
    ids.push(((await older.json()) as { id: string }).id);
    const newer = await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "kraftwerk" } } });
    const latest = ((await newer.json()) as { id: string }).id;
    ids.push(latest);

    // Same hash as before, so a plain goto would not re-enter the route.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#/agents/chats/${latest}$`));
    await expect(page.locator(".side-row.active .side-wf").last()).toBeVisible();

    await page.locator("a[href='#/agents/chats/new']").click();
    await expect(page).toHaveURL(/#\/agents\/chats\/new$/);
    await expect(page.getByRole("button", { name: "start chat" })).toBeVisible();

    // The sidebar entry itself goes back to the latest chat.
    await page.locator(".side-general").click();
    await expect(page).toHaveURL(new RegExp(`#/agents/chats/${latest}$`));
  });
});
