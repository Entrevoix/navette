import { test, expect } from "@playwright/test";
import { connectToServer } from "./helpers";

test.describe("Connection flow", () => {
  test("page loads and shows the connect form with navette heading", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("navette");
  });

  test("shows host, port, and token inputs", async ({ page }) => {
    await page.goto("/");
    // Host and port are type="text"; token is type="password"
    const textInputs = page.locator('input[type="text"]');
    await expect(textInputs.first()).toBeVisible();
    await expect(textInputs.nth(1)).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("Connect button is disabled when token is empty", async ({ page }) => {
    await page.goto("/");
    // Clear the token field (it starts empty, but be explicit)
    await page.fill('input[type="password"]', "");
    const connectBtn = page.locator('button:has-text("Connect")');
    await expect(connectBtn).toBeDisabled();
  });

  test("can fill in connection details", async ({ page }) => {
    await page.goto("/");
    const hostInput = page.locator('input[type="text"]').first();
    const portInput = page.locator('input[type="text"]').nth(1);
    await hostInput.fill("localhost");
    await portInput.fill("7878");
    await page.fill(
      'input[type="password"]',
      "xSvmI0OJLPha3CfL546COWbquusApYE7",
    );
    await expect(hostInput).toHaveValue("localhost");
    await expect(portInput).toHaveValue("7878");
    await expect(page.locator('input[type="password"]')).toHaveValue(
      "xSvmI0OJLPha3CfL546COWbquusApYE7",
    );
  });

  test("after connecting, shows three-panel layout with session sidebar", async ({
    page,
  }) => {
    await connectToServer(page);
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  });

  test("status bar shows connected after connecting", async ({ page }) => {
    await connectToServer(page);
    // StatusBar renders the status text capitalised; "connected" appears in the status bar
    await expect(page.locator("text=connected")).toBeVisible();
  });

  test("Disconnect button appears and works after connecting", async ({
    page,
  }) => {
    await connectToServer(page);
    const disconnectBtn = page.locator('button:has-text("Disconnect")');
    await expect(disconnectBtn).toBeVisible();
    await disconnectBtn.click();
    // After disconnect, the connect form should re-appear
    await expect(page.locator("h1")).toHaveText("navette");
  });
});
