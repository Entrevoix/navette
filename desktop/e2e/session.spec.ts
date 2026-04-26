import { test, expect } from "@playwright/test";
import { connectToServer } from "./helpers";

test.describe("Session management", () => {
  test.beforeEach(async ({ page }) => {
    await connectToServer(page);
  });

  test("+ New Session button is visible in the sidebar", async ({ page }) => {
    await expect(page.locator('button:has-text("+ New Session")')).toBeVisible();
  });

  test("clicking + New Session shows the prompt textarea", async ({ page }) => {
    await page.locator('button:has-text("+ New Session")').click();
    await expect(
      page.locator('textarea[placeholder="Enter prompt..."]'),
    ).toBeVisible();
  });

  test("can type a prompt and see the Run button", async ({ page }) => {
    await page.locator('button:has-text("+ New Session")').click();
    const textarea = page.locator('textarea[placeholder="Enter prompt..."]');
    await textarea.fill("Hello world");
    await expect(page.locator('button:has-text("Run")')).toBeVisible();
  });

  test("advanced options toggle shows work dir and command fields", async ({
    page,
  }) => {
    await page.locator('button:has-text("+ New Session")').click();
    // The advanced toggle button shows the gear icon ⚙
    await page.locator('button:has-text("⚙")').click();
    await expect(
      page.locator('input[placeholder="Working directory"]'),
    ).toBeVisible();
    await expect(
      page.locator('input[placeholder="Custom command (e.g. codex, aider)"]'),
    ).toBeVisible();
  });

  test("Cancel button hides the new session form", async ({ page }) => {
    await page.locator('button:has-text("+ New Session")').click();
    await expect(
      page.locator('textarea[placeholder="Enter prompt..."]'),
    ).toBeVisible();
    // The cancel button shows ✕
    await page.locator('button:has-text("✕")').click();
    await expect(
      page.locator('textarea[placeholder="Enter prompt..."]'),
    ).not.toBeVisible();
    await expect(
      page.locator('button:has-text("+ New Session")'),
    ).toBeVisible();
  });
});
