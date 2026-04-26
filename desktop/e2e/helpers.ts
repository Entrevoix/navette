import { Page } from "@playwright/test";

const NAVETTE_HOST = process.env.NAVETTE_HOST ?? "localhost";
const NAVETTE_PORT = process.env.NAVETTE_PORT ?? "7878";
const NAVETTE_TOKEN = process.env.NAVETTE_TOKEN ?? "";

export async function connectToServer(page: Page) {
  if (!NAVETTE_TOKEN) {
    throw new Error(
      "Set NAVETTE_TOKEN env var to run E2E tests that require a daemon connection",
    );
  }
  await page.goto("/");
  const hostInput = page.locator('input[type="text"]').first();
  const portInput = page.locator('input[type="text"]').nth(1);
  await hostInput.fill(NAVETTE_HOST);
  await portInput.fill(NAVETTE_PORT);
  await page.fill('input[type="password"]', NAVETTE_TOKEN);
  await page.click('button:has-text("Connect")');
  await page.waitForSelector("text=connected", { timeout: 10000 });
}
