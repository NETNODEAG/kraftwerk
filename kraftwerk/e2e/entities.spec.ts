import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Contacts, places and events in the browser: the flags hide the nav
 * entries, settings turn them on, a place and a contact are created from
 * the forms and land on their pages, a reference to the place resolves
 * (and a reference in the notes becomes a link), the ⌘K palette finds the
 * contact, and removal moves the file to the trash.
 */
test.describe("contacts, places and events", () => {
  const off = { contacts: { enabled: false }, places: { enabled: false }, events: { enabled: false } };
  test.beforeAll(async ({ request }) => {
    await request.put("/api/settings", { data: off });
  });
  test.afterAll(async ({ request }) => {
    await request.delete("/api/contacts/anna-meier");
    await request.delete("/api/places/netnode-office");
    await request.put("/api/settings", { data: off });
  });

  test("the nav has no entries until settings turn the features on", async ({ page }) => {
    await page.goto("/#/settings");
    for (const kind of ["contacts", "places", "events"]) await expect(page.locator(`nav a[href='#/${kind}']`)).toHaveCount(0);
    await page.getByRole("checkbox", { name: /keep people and organisations as contacts/ }).check();
    await page.getByRole("checkbox", { name: /keep addresses and points of interest as places/ }).check();
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    const yml = readFileSync(path.join(fixture(), "kraftwerk.yml"), "utf8");
    expect(yml).toMatch(/^contacts: \{\}$/m);
    expect(yml).toMatch(/^places: \{\}$/m);
    expect(yml).not.toMatch(/^events:/m);
    await expect(page.locator("nav a[href='#/contacts']")).toBeVisible();
    await expect(page.locator("nav a[href='#/places']")).toBeVisible();
    await expect(page.locator("nav a[href='#/events']")).toHaveCount(0);
  });

  test("a place is created from the form and lands on its page with a maps link", async ({ page }) => {
    await page.goto("/#/places");
    await expect(page.getByText("no places yet")).toBeVisible();
    await page.getByRole("link", { name: "new place" }).click();
    await expect(page).toHaveURL(/#\/places\/new$/);
    await page.getByRole("textbox", { name: "place title" }).fill("NETNODE Office");
    await page.getByRole("textbox", { name: "address" }).fill("Zentralstrasse 1, 6003 Luzern");
    await page.getByRole("textbox", { name: "latitude" }).fill("47.05");
    await page.getByRole("textbox", { name: "longitude" }).fill("8.3");
    await page.getByRole("button", { name: "create place" }).click();
    await expect(page).toHaveURL(/#\/places\/netnode-office$/);
    await expect(page.getByRole("textbox", { name: "place title" })).toHaveValue("NETNODE Office");
    await expect(page.getByRole("link", { name: "open in Google Maps" })).toHaveAttribute("href", "https://www.google.com/maps?q=47.05,8.3");
    const file = path.join(fixture(), "kraftwerk-data", "places", "netnode-office.md");
    expect(readFileSync(file, "utf8")).toMatch(/^address: Zentralstrasse 1, 6003 Luzern$/m);
    expect(readFileSync(file, "utf8")).not.toMatch(/mapsUrl/);
    // The list beside the page names it.
    await expect(page.locator(".runs-side").getByRole("link", { name: /NETNODE Office/ })).toBeVisible();
  });

  test("a contact references the place; the fields save in place and the notes link references", async ({ page }) => {
    await page.goto("/#/contacts/new");
    await page.getByRole("textbox", { name: "contact title" }).fill("Anna Meier");
    await page.getByRole("textbox", { name: "organisation" }).fill("ACME");
    await page.getByRole("textbox", { name: "place" }).fill("netnode-office");
    await page.getByRole("button", { name: "create contact" }).click();
    await expect(page).toHaveURL(/#\/contacts\/anna-meier$/);
    // The reference resolved: a tag that links to the place.
    await expect(page.locator(".contact-page").getByRole("link", { name: "netnode-office" })).toHaveAttribute("href", "#/places/netnode-office");

    await page.getByRole("textbox", { name: "role" }).fill("CTO");
    await page.getByRole("button", { name: "edit" }).click();
    await page.getByRole("textbox", { name: "notes" }).fill("Met at place:netnode-office; see https://example.com/contact:fake");
    await page.getByRole("button", { name: "save" }).click();
    await expect(page.getByText("saved", { exact: true })).toBeVisible();
    const file = path.join(fixture(), "kraftwerk-data", "contacts", "anna-meier.md");
    expect(readFileSync(file, "utf8")).toMatch(/^role: CTO$/m);
    expect(readFileSync(file, "utf8")).toMatch(/\n---\n\nMet at place:netnode-office/);
    // Saving shows the notes rendered: the reference is a link, the URL's lookalike is not.
    const notes = page.locator(".md-body");
    await expect(notes.getByRole("link", { name: "place:netnode-office" })).toHaveAttribute("href", "#/places/netnode-office");
    await expect(notes.locator("a.md-ref")).toHaveCount(1);

    // A reference to nothing is marked, not refused.
    await page.getByRole("textbox", { name: "place" }).fill("nowhere");
    await page.getByRole("button", { name: "save" }).click();
    await expect(page.getByText("saved", { exact: true })).toBeVisible();
    await expect(page.locator(".contact-page").getByText("nowhere · not found")).toBeVisible();
    await page.getByRole("textbox", { name: "place" }).fill("netnode-office");
    await page.getByRole("button", { name: "save" }).click();
    await expect(page.getByText("saved", { exact: true })).toBeVisible();
  });

  test("the ⌘K palette finds the contact", async ({ page }) => {
    await page.goto("/#/agents/chats");
    await page.getByRole("button", { name: "search" }).click();
    await page.getByRole("textbox", { name: "search" }).fill("anna");
    const hit = page.getByRole("option", { name: /Anna Meier/ });
    await expect(hit).toContainText("contact");
    await hit.click();
    await expect(page).toHaveURL(/#\/contacts\/anna-meier$/);
  });

  test("remove moves the file to the trash and the list no longer shows it", async ({ page }) => {
    await page.goto("/#/contacts/anna-meier");
    await page.getByRole("button", { name: "remove" }).click();
    await page.getByRole("button", { name: "move to trash" }).click();
    await expect(page).toHaveURL(/#\/contacts$/);
    await expect(page.getByText("no contacts yet")).toBeVisible();
    expect(existsSync(path.join(fixture(), "kraftwerk-data", "contacts", "anna-meier.md"))).toBe(false);
    expect(existsSync(path.join(fixture(), "kraftwerk-data", "trash", "contacts", "anna-meier", "anna-meier.md"))).toBe(true);
  });
});
