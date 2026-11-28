// Phase 5B, on the screens: the tamper alarm on the weighbridge and the store officer's
// pages, the camera and weighbridge lights, and the model weighbridge settings. The boards
// are the pretend ones, speaking the firmware's protocol.
//
// IT RUNS "RESET DEMO DATA" FIRST: demo tickets in the development database are deleted.
// PHASE5B_SHOTS=1 saves the staff pages in docs/screenshots/phase5b (with PHASE10_SHOTS=1
// the fault screen is saved too, in docs/screenshots/phase10).
import { fileURLToPath } from "node:url";
import { expect, test, type Browser } from "@playwright/test";
import type { DemoSettings } from "@trinetra/shared";
import {
  arrive,
  confirmPlate,
  heading,
  look,
  Office,
  openKiosk,
  press,
  uploadFromPhone,
  Weighbridge,
} from "./kiosk-world";
import { WEB_URL } from "./playwright.config";
import { LAPTOP, lookAt, PHONE } from "./staff-look";
import { signIn } from "./staff-session";

const PLATE = "MH14CD5678";
const FOLDER =
  process.env.PHASE5B_SHOTS === "1"
    ? fileURLToPath(new URL("../../docs/screenshots/phase5b/", import.meta.url))
    : null;
const bridge = new Weighbridge();
let office: Office;

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.beforeAll(async ({ browser }) => {
  office = await Office.open(browser);
  await office.reset();
  await office.pick(PLATE, "model-bricks");
  // The seeded model settings, also after a run that stopped half-way.
  await office.demo("put", "settings", { modelScaleKgPerG: 100, stableBandG: 15 });
  bridge.start();
});

test.afterAll(async () => {
  bridge.stop();
  await office?.allReal();
  await office?.reset();
  await office?.dispose();
});

test.afterEach(() => bridge.driveOff());

async function storePage(browser: Browser, size: typeof PHONE) {
  const context = await browser.newContext({ viewport: size });
  await signIn(context, "ram");
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

test("tampering: the weighbridge waits, the store officer is told, and both recover", async ({
  browser,
  page,
}) => {
  await openKiosk(page);
  await expect(page.getByTestId("cameras")).toHaveText("Cam 2/2");
  await expect(page.getByTestId("cameras")).toHaveAttribute("data-tone", "go");
  const store = await storePage(browser, PHONE);
  await store.page.goto("/store");

  // A truck is at the bill step when the wiring is tampered with.
  await arrive(page, bridge, 38_250);
  await confirmPlate(page, "MH 14 CD 5678");
  await expect(page.getByTestId("upload-qr")).toBeVisible();
  await uploadFromPhone(browser, page, "model-bricks.jpg");
  await press(page, "Next");
  await heading(page, "Material");

  bridge.tamper("CELL WIRE OPEN");
  const fault = page.getByTestId("message-fault");
  await expect(fault).toContainText("Weighbridge fault – please wait");
  await expect(page.getByTestId("screen")).toHaveAttribute("data-screen", "fault");
  await expect(page.getByTestId("weighbridge")).toHaveText("Weighbridge fault");
  await look(page, "fault");

  const alert = store.page.getByTestId("store-fault");
  await expect(alert).toContainText("possible tampering");
  await expect(alert).toContainText("CELL WIRE OPEN");
  await lookAt(store.page, "store-fault", { folder: FOLDER, back: PHONE });
  // It is on every page of the store officer, also one opened during the fault.
  await store.page.goto("/store/approvals");
  await expect(alert).toBeVisible();

  // The truck's timeline has it.
  await store.page.goto("/store/trucks");
  await store.page.getByRole("link", { name: /View/ }).first().click();
  await expect(store.page.getByTestId("timeline")).toContainText(
    "Weighbridge fault: possible tampering",
  );

  await store.page.goto("/settings");
  await expect(store.page.getByTestId("settings-fault")).toContainText("CELL WIRE OPEN");

  bridge.tamper(null);
  // Back to the driver's own question: nothing was lost.
  await heading(page, "Material");
  await expect(alert).toBeHidden();
  await expect(store.page.getByTestId("settings-fault")).toBeHidden();
  await store.close();
});

test("settings: the model scale, the stable band and the boards", async ({ browser }) => {
  const { page, close } = await storePage(browser, LAPTOP);
  await page.goto("/settings");
  const scale = page.getByLabel("Model scale: 1 g = X kg");
  const band = page.getByLabel("Stable band (± grams)");
  await expect(scale).toHaveValue("100");
  await expect(band).toHaveValue("15");
  await expect(page.getByText("A 200 g cargo on the model reads as 20,000 kg.")).toBeVisible();

  for (const device of ["main", "front", "back"]) {
    const row = page.getByTestId(`device-${device}`);
    await expect(row).toContainText("Online");
    await expect(row).toContainText("Last seen");
  }

  const save = page.getByRole("button", { name: "Save model settings" });
  await expect(save).toBeDisabled();
  await band.fill("20");
  await save.click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await lookAt(page, "settings-model", { folder: FOLDER, back: LAPTOP });

  const answer = await page.request.get(`${WEB_URL}/api/demo/settings`);
  expect(((await answer.json()) as DemoSettings).stableBandG).toBe(20);
  await band.fill("15");
  await save.click();
  await expect(save).toBeDisabled();
  await close();
});

test("staff see each board and when it was last heard, behind the logo", async ({ page }) => {
  await openKiosk(page);
  await page.getByTestId("rail-logo").hover();
  await page.mouse.down();
  for (const device of ["main", "front", "back"]) {
    const row = page.getByTestId(`staff-device-${device}`);
    await expect(row).toContainText("Online", { timeout: 10_000 });
    await expect(row).toContainText("Last seen");
  }
  await page.mouse.up();
});
