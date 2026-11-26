// The screens a good journey never shows: the plate keypad, failed readings, five wrong
// materials, an offline weighbridge, the reminders and the dialogs. Where a real service
// would have to fail, the test replaces that one answer in the browser.
//
// IT RUNS "RESET DEMO DATA" FIRST, like the journeys.
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AnprCameraResult, AnprResponse, TicketView } from "@trinetra/shared";
import { expectDriverRules } from "./driver-rules";
import {
  arrive,
  confirmPlate,
  heading,
  leave,
  look,
  Office,
  openKiosk,
  press,
  SHOT_FOLDER,
  SHOTS,
  uploadFromPhone,
  Weighbridge,
} from "./kiosk-world";

const bridge = new Weighbridge();
let office: Office;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async ({ browser }) => {
  office = await Office.open(browser);
  await office.reset();
  bridge.start();
});

test.afterAll(async () => {
  bridge.stop();
  await office?.demo("put", "settings", { anprMode: "real", ocrMode: "real" });
  await office?.dispose();
});

test.afterEach(() => bridge.driveOff());

/** A ticket's own address, and saving its details: both answer with the ticket. */
const TICKET = /\/api\/tickets\/\d+(\/details)?$/;

const camera = (plate: string): AnprCameraResult => ({
  plate,
  source: "plate_recognizer",
  confidence: 0.9,
  validFormat: true,
  photoId: null,
  photoUrl: null,
  cameraFailure: null,
});

const disagree: AnprResponse = {
  attempt: 3,
  retriesLeft: 0,
  front: camera("BR06QR4321"),
  back: camera("BR06QR4327"),
  sources: { front: "plate_recognizer", back: "plate_recognizer" },
  match: false,
  plate: null,
  canConfirm: true,
  photoIds: [],
  demo: false,
  openTicket: null,
  blockedTicket: null,
};

/** A picture of a screen that "look" cannot take, because a touch would change it. */
async function snap(page: Page, name: string) {
  await expectDriverRules(page);
  if (!SHOTS) return;
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: `${SHOT_FOLDER}${name}.png`, animations: "disabled" });
}

test("the plate: still reading, failed, front and back differ, and the keypad", async ({
  page,
}) => {
  await office.pick("BR06QR4321", "cement");
  await openKiosk(page);

  const held: Route[] = [];
  await page.route("**/api/anpr", (route) => void held.push(route));
  await arrive(page, bridge, 21_000);
  await expect(page.getByText("Reading your number plate…")).toBeVisible();
  await look(page, "04-plate-reading");

  await expect.poll(() => held.length).toBe(1);
  await held.shift()!.fulfill({
    status: 500,
    json: { error: { code: "INTERNAL_ERROR", message: "test" } },
  });
  await expect(page.locator("main").getByRole("alert")).toContainText("That did not work");
  await look(page, "04-plate-failed");

  await press(page, "Try again");
  await expect.poll(() => held.length).toBe(1);
  await held.shift()!.fulfill({ json: disagree });
  await expect(page.getByText("Front and back are different")).toBeVisible();
  await look(page, "04-plate-choose");
  await press(page, "Neither — type it");

  const keypad = page.getByRole("group", { name: "Number plate keypad" });
  for (const key of "BR06QR4321") {
    await keypad.getByRole("button", { name: key, exact: true }).click();
  }
  await expect(page.getByRole("status", { name: "Number plate" })).toHaveText("BR 06 QR 4321");
  await look(page, "04-plate-keypad");
  await page.unroute("**/api/anpr");
  await press(page, "Next");
  await heading(page, "Invoice");
});

test("the invoice: no phone, being read, not read; then five wrong materials", async ({
  page,
  browser,
}) => {
  await office.pick("UP70GH3456", "cement");
  await openKiosk(page);
  await arrive(page, bridge, 21_000);
  await confirmPlate(page, "UP 70 GH 3456");
  await heading(page, "Invoice");

  await press(page, "No phone?");
  await expect(page.getByText("The store officer is coming to upload it.")).toBeVisible();
  await look(page, "05-invoice-no-phone");
  // Leaving the screen drops the banner; the call itself stays with the store officer.

  /** The kiosk is told the invoice is in this state. */
  const pretend = async (state: "reading" | "failed") => {
    await page.unrouteAll({ behavior: "wait" });
    await page.route(TICKET, async (route) => {
      const real = await route.fetch();
      // Saving the details answers with the ticket inside.
      const body = (await real.json()) as TicketView & { ticket?: TicketView };
      const ticket = body.ticket ?? body;
      ticket.invoice = {
        ...ticket.invoice,
        state,
        error: state === "failed" ? "READER_BUSY" : null,
      };
      await route.fulfill({ response: real, json: body });
    });
  };
  await pretend("reading");
  await expect(page.getByText("Reading invoice…")).toBeVisible();
  await look(page, "06-invoice-reading");
  await expect(page.getByText("Reading invoice…")).toBeVisible();
  await pretend("failed");
  await expect(page.getByText("The invoice could not be read.")).toBeVisible();
  await look(page, "08-invoice-failed");
  await expect(page.getByText("The invoice could not be read.")).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });

  // The real ticket again: nothing has been uploaded, so the code comes back.
  await uploadFromPhone(browser, page, "cement.jpg");
  // The sample cement invoice is made out to another truck.
  await expect(page.getByText("This invoice names another truck.")).toBeVisible();
  await press(page, "Next");

  await heading(page, "Material");
  for (const wrong of ["Sand", "Bricks", "Bitumen", "Additive", "Sand"]) {
    const saved = page.waitForResponse((reply) => reply.url().endsWith("/details"));
    await press(page, wrong);
    await saved;
  }
  await expect(page.getByTestId("message-mismatch")).toContainText("go to the store office");
  await look(page, "10-mismatch-store");
  await office.storeDecides("UP70GH3456", "MISMATCH", {
    decision: "APPROVE",
    chosenMaterial: "Cement Bags",
  });
  // The store officer chose the material: the driver goes on from there.
  await heading(page, "Supplier");
});

test("the dialogs: Help, Start over, and the staff's logout", async ({ page }) => {
  await openKiosk(page);
  await arrive(page, bridge, 21_000);
  await press(page, "Help");
  await expect(page.getByRole("dialog")).toContainText("The store officer has been called");
  await snap(page, "34-help");
  await press(page, "OK");

  await press(page, "Start over");
  await expect(page.getByRole("dialog")).toContainText("Start over?");
  await snap(page, "35-start-over");
  await press(page, "Yes");
  await heading(page, "Language");
  await leave(page, bridge);
  // Nothing to start over on the waiting screen.
  await expect(page.getByRole("button", { name: "Start over" })).toHaveCount(0);

  // Held for 3 seconds, the logo offers "Log out" to the staff.
  await page.getByTestId("rail-logo").hover();
  await page.mouse.down();
  await expect(page.getByRole("dialog", { name: "For staff" })).toBeVisible({ timeout: 10_000 });
  await page.mouse.up();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Log out" })).toBeVisible();
  await snap(page, "36-staff");
});

test("nobody answers: a reminder after a minute, then Start over?", async ({ page }) => {
  await page.clock.install();
  await openKiosk(page);
  await arrive(page, bridge, 21_000);
  await heading(page, "Number plate");
  await expect(page.getByTestId("plate")).toBeVisible();

  await page.clock.fastForward("01:01");
  await expect(page.getByText("Please answer the question on the screen.")).toBeVisible();
  await snap(page, "37-idle-reminder");
  await page.clock.fastForward("02:00");
  await expect(page.getByRole("dialog")).toContainText("Nobody has answered");
  await snap(page, "38-idle-start-over");
  await press(page, "No");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("plate")).toBeVisible();
});

test("the weighbridge goes offline, and the visit that ran out of time", async ({ page }) => {
  await openKiosk(page);
  // The last test's truck has driven off.
  await expect(page.getByTestId("bridge-status")).toContainText("Weighbridge ready");
  bridge.stop();
  await expect(page.getByTestId("bridge-status")).toContainText("Weighbridge offline");
  await look(page, "01-ready-offline");
  bridge.start();
  await expect(page.getByTestId("bridge-status")).toContainText("Weighbridge ready");

  await office.pick("RJ14LM2345", "cement");
  await page.route(/\/api\/tickets\/\d+$/, async (route) => {
    const real = await route.fetch();
    const ticket = (await real.json()) as TicketView;
    await route.fulfill({ response: real, json: { ...ticket, status: "ABANDONED" } });
  });
  await arrive(page, bridge, 21_000);
  await confirmPlate(page, "RJ 14 LM 2345");
  await expect(page.getByTestId("message-timedOut")).toBeVisible();
  await look(page, "39-timed-out");
});
