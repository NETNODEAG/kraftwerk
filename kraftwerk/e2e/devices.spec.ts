import { expect, test } from "@playwright/test";

/**
 * Pairing in the browser. The e2e server also serves the workspace on the
 * next port as a device on the network sees it (every request needs a
 * token): the page shows the pairing screen, a code made in settings on
 * this machine pairs it, and after that it is the app. Unpairing in
 * settings removes the device from the list.
 */
test.describe("devices", () => {
  const remote = `http://127.0.0.1:${Number(process.env.E2E_PORT || 19981) + 1}`;

  test("an unpaired browser pairs with a code from settings, then gets the app", async ({ page, browser }) => {
    // This machine: settings → devices → pair a device.
    await page.goto("/#/settings");
    await page.getByRole("button", { name: "pair a device" }).click();
    const code = (await page.getByLabel("pairing code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await expect(page.getByText("kraftwerk ui --lan")).toBeVisible();

    // The device: a fresh browser context, no cookie.
    const phone = await browser.newContext();
    const p = await phone.newPage();
    await p.goto(`${remote}/#/agents/chats`);
    await expect(p.getByRole("heading", { name: "Pair this device" })).toBeVisible();
    await p.getByRole("textbox", { name: "pairing code" }).fill("WRON-GCOD");
    await p.getByRole("button", { name: "pair" }).click();
    await expect(p.getByText("invalid or expired pairing code")).toBeVisible();
    await p.getByRole("textbox", { name: "pairing code" }).fill(code.toLowerCase());
    await p.getByRole("textbox", { name: "device name" }).fill("e2e phone");
    await p.getByRole("button", { name: "pair" }).click();
    await expect(p.getByRole("heading", { name: "new chat" })).toBeVisible();
    // Settings on the device says what it is, and offers no device management.
    await p.goto(`${remote}/#/settings`);
    await expect(p.getByText("this browser is paired as “e2e phone”")).toBeVisible();
    await expect(p.getByRole("button", { name: "pair a device" })).toHaveCount(0);
    await phone.close();

    // Back on this machine: it is listed, and unpairing removes it.
    await page.reload();
    const row = page.locator("[data-device]", { hasText: "e2e phone" });
    await expect(row).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await row.getByRole("button", { name: "unpair e2e phone" }).click();
    await expect(row).toHaveCount(0);
  });
});
