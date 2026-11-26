// The pictures in docs/screenshots/ui-update. The dashboard numbers and the kiosk sample
// screens are made-up data; the names are the public demo users.
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./staff-session";

const FOLDER = fileURLToPath(new URL("../../docs/screenshots/ui-update/", import.meta.url));

const KIOSK = { width: 1366, height: 768 };
const KIOSK_LARGE = { width: 1920, height: 1080 };
const COMPUTER = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  // The development tools are not part of the website.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: `${FOLDER}${name}.png`, animations: "disabled" });
}

for (const size of [KIOSK, KIOSK_LARGE]) {
  const at = `${size.width}x${size.height}`;

  test(`kiosk shell at ${at}`, async ({ page, context }) => {
    await page.setViewportSize(size);
    await signIn(context, "wb01");
    await page.goto("/kiosk");
    await expect(page.getByTestId("connection")).toHaveText("Online");
    await expect(page.getByTestId("weighbridge")).not.toHaveText("Checking the weighbridge…");
    await shot(page, `kiosk-shell-${at}`);

    for (const screen of ["start", "details", "weight", "question"]) {
      await page.goto(`/dev/ui?kiosk=${screen}`);
      await expect(page.getByTestId("clock")).toContainText("IST");
      await shot(page, `kiosk-sample-${screen}-${at}`);
    }
  });
}

test("kiosk login", async ({ page }) => {
  await page.setViewportSize(KIOSK);
  await page.goto("/kiosk/login");
  await expect(page.getByRole("textbox")).toBeEnabled();
  await expect(page.getByTestId("clock")).toContainText("IST");
  await shot(page, "kiosk-login-1366x768");
});

for (const area of [
  { path: "supervisor", username: "amit" },
  { path: "store", username: "ram" },
]) {
  test(`${area.path} login`, async ({ page }) => {
    for (const size of [COMPUTER, PHONE]) {
      await page.setViewportSize(size);
      await page.goto(`/${area.path}/login`);
      await expect(page.getByRole("textbox")).toBeEnabled();
      await shot(page, `${area.path}-login-${size.width}x${size.height}`);
    }
  });

  test(`${area.path} dashboard`, async ({ page, context }) => {
    await signIn(context, area.username);
    await page.setViewportSize(COMPUTER);
    await page.goto(`/${area.path}`);
    await expect(page.getByTestId("connection")).toHaveText("Online");
    await shot(page, `${area.path}-dashboard-1440x900`);

    await page.setViewportSize(PHONE);
    await page.goto(`/${area.path}`);
    await expect(page.getByTestId("connection")).toHaveText("Online");
    await shot(page, `${area.path}-dashboard-390x844`);

    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await shot(page, `${area.path}-dashboard-390x844-drawer`);
  });
}
