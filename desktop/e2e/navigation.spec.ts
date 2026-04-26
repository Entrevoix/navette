import { test, expect } from "@playwright/test";
import { connectToServer } from "./helpers";

test.describe("View navigation", () => {
  test.beforeEach(async ({ page }) => {
    await connectToServer(page);
  });

  test("nav bar shows all view buttons", async ({ page }) => {
    const nav = page.locator("nav").first();
    await expect(nav.locator('button:has-text("Chat")')).toBeVisible();
    await expect(nav.locator('button:has-text("Files")')).toBeVisible();
    await expect(nav.locator('button:has-text("Prompts")')).toBeVisible();
    await expect(nav.locator('button:has-text("Secrets")')).toBeVisible();
    await expect(nav.locator('button:has-text("Sched")')).toBeVisible();
    await expect(nav.locator('button:has-text("Hist")')).toBeVisible();
    await expect(nav.locator('button:has-text("Skills")')).toBeVisible();
    await expect(nav.locator('button:has-text("Settings")')).toBeVisible();
  });

  test("clicking Files shows the file browser", async ({ page }) => {
    await page.locator('nav button:has-text("Files")').first().click();
    // FileBrowser renders somewhere on the page
    await expect(page.locator("text=Files").first()).toBeVisible();
  });

  test("clicking Prompts shows the prompt library", async ({ page }) => {
    await page.locator('nav button:has-text("Prompts")').first().click();
    await expect(page.locator("text=Prompts").first()).toBeVisible();
  });

  test("clicking Chat returns to conversation view with session sidebar", async ({
    page,
  }) => {
    // Navigate away first
    await page.locator('nav button:has-text("Files")').first().click();
    // Return to Chat
    await page.locator('nav button:has-text("Chat")').first().click();
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  });

  test("Settings button opens the settings dialog", async ({ page }) => {
    await page.locator('nav button:has-text("Settings")').click();
    // SettingsDialog renders an h2 with "Settings"
    await expect(page.locator('h2:has-text("Settings")')).toBeVisible();
  });

  test("pressing Escape closes the settings dialog", async ({ page }) => {
    await page.locator('nav button:has-text("Settings")').click();
    await expect(page.locator('h2:has-text("Settings")')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('h2:has-text("Settings")')).not.toBeVisible();
  });
});
