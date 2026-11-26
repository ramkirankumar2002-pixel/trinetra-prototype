// Every sample weighbridge screen follows the driver rules at both kiosk sizes.
import { expect, test } from "@playwright/test";
import { expectDriverRules, KIOSK_SIZES } from "./driver-rules";

const SCREENS = ["start", "details", "weight", "question", "number"];

for (const size of KIOSK_SIZES) {
  test.describe(`kiosk at ${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    for (const screen of SCREENS) {
      test(`the "${screen}" sample follows the driver rules`, async ({ page }) => {
        await page.goto(`/dev/ui?kiosk=${screen}`);
        await expect(page.getByTestId("clock")).toContainText("IST");
        await page.evaluate(() => document.fonts.ready);
        await expectDriverRules(page);
      });
    }
  });
}

for (const size of KIOSK_SIZES) {
  test.describe(`kiosk login at ${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test("follows the driver rules in both languages, also with an error", async ({ page }) => {
      await page.goto("/kiosk/login");
      const username = page.getByRole("textbox");
      await expect(username).toBeEnabled();
      await expect(page.getByTestId("clock")).toContainText("IST");
      await expectDriverRules(page);

      // A made-up user, so no real login is locked.
      await username.fill(`nobody-${size.width}`);
      for (const digit of "0000") {
        await page.getByRole("button", { name: digit, exact: true }).click();
      }
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "PIN" })).toBeVisible();
      await expectDriverRules(page);

      await page.getByRole("button", { name: "हिंदी" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "पिन" })).toBeVisible();
      await expectDriverRules(page);
    });
  });
}
