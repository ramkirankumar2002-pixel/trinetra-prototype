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
