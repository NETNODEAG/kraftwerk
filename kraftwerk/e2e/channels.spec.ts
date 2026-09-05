import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Channels in the browser: create one, see its members, post as a named
 * human, get the @mention menu. No agent is woken (no responder, no
 * mention sent), so no coding agent starts.
 */
test.describe("channels", () => {
  // The fixture is shared with the other specs: agents get spec-specific
  // slugs and everything created here is removed again at the end.
  const AGENTS: Array<[string, string, string]> = [["planner", "Planner", "🗺️"], ["scribe", "Scribe", "✍️"]];
  test.afterAll(async ({ request }) => {
    await request.delete("/api/channels/launch-week").catch(() => {});
    for (const [slug] of AGENTS) rmSync(path.join(fixture(), "agents", slug), { recursive: true, force: true });
  });

  test("create, post as a human, mention menu", async ({ page }) => {
    const root = fixture();
    for (const [slug, name, emoji] of AGENTS) {
      mkdirSync(path.join(root, "agents", slug), { recursive: true });
      writeFileSync(path.join(root, "agents", slug, "agent.yml"), `name: ${name}\nemoji: ${emoji}\nharness: claude\n`);
    }

    await page.goto("/#/channels/new");
    await page.getByPlaceholder("e.g. Website relaunch").fill("Launch week");
    await page.getByPlaceholder("what this channel is for").fill("coordinate the launch");
    await page.getByLabel(/Planner/).check();
    await page.getByLabel(/Scribe/).check();
    await page.getByRole("button", { name: "create channel" }).click();

    await expect(page).toHaveURL(/#\/channels\/launch-week$/);
    await expect(page.locator(".channel-head h1")).toHaveText("#launch-week");
    await expect(page.locator(".member-chip")).toHaveCount(2);
    await expect(page.locator(".channel-purpose")).toHaveText("coordinate the launch");
    await expect(page.locator(".side-row.active .side-wf")).toHaveText("#launch-week");

    // Name yourself, then post. Nobody is mentioned and there is no
    // responder, so the message just lands in the transcript.
    await page.locator(".composer-me .me-name").click();
    await page.getByPlaceholder("your name").fill("Lukas");
    await page.getByPlaceholder("your name").press("Enter");
    const box = page.locator(".composer textarea");
    await box.fill("kickoff is tomorrow");
    await box.press("Enter");
    await expect(page.locator(".byline.human .byline-name")).toHaveText("Lukas");
    await expect(page.locator(".msg.user")).toHaveText("kickoff is tomorrow");
    await expect(page.locator(".chat-working")).toHaveCount(0);

    // "@s" offers the scribe; picking completes the handle.
    await box.fill("@s");
    await expect(page.locator(".skill-menu button")).toHaveCount(1);
    await expect(page.locator(".skill-menu button")).toContainText("@scribe");
    await box.press("Tab");
    await expect(box).toHaveValue("@scribe ");
    await page.screenshot({ path: "test-results/channel.png" });
  });
});
