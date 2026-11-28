// The five truck journeys of Phase 8, now through the real weighbridge screens and the
// driver's phone, by touch only. The weights come from the ESP32 simulator; plates and
// invoices from the demo "pick" modes, so no outside service is used.
//
// IT RUNS "RESET DEMO DATA" FIRST: demo tickets in the development database are deleted.
import { expect, test, type Page } from "@playwright/test";
import {
  answerQuestions,
  arrive,
  confirmPlate,
  confirmWeight,
  heading,
  leave,
  look,
  Office,
  openKiosk,
  openPhone,
  phonePicture,
  press,
  printCount,
  sampleInvoice,
  SHOT_FOLDER,
  SHOTS,
  typeDigits,
  uploadFromPhone,
  Weighbridge,
} from "./kiosk-world";

const bridge = new Weighbridge();
let office: Office;

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.beforeAll(async ({ browser }) => {
  office = await Office.open(browser);
  await office.reset();
  bridge.start();
});

test.afterAll(async () => {
  bridge.stop();
  await office?.allReal();
  await office?.dispose();
});

test.afterEach(() => bridge.driveOff());

test("1. Type 3, fully automatic: sand", async ({ page, browser }) => {
  await office.pick("MP09JK7890", "sand");
  await openKiosk(page);
  await expect(page.getByTestId("bridge-status")).toContainText("Weighbridge ready");
  await look(page, "01-ready");

  bridge.driveOn(19_150);
  await heading(page, "Language");
  await look(page, "02-language");
  await page
    .locator("main")
    .getByRole("button", { name: /^English/ })
    .click();

  // The plate, with both cameras' photos.
  await expect(page.getByTestId("plate")).toHaveText("MP 09 JK 7890");
  await expect(page.getByTestId("camera-front").locator("img")).toBeVisible();
  await expect(page.getByTestId("camera-back").locator("img")).toBeVisible();
  await expect(page.getByTestId("steps")).toHaveAttribute("data-current", "2");
  await look(page, "04-plate-confirm");

  // The truck rolls back: the position screen, which goes by itself.
  bridge.position(false);
  await expect(page.getByTestId("position")).toBeVisible();
  await look(page, "03-position");
  bridge.position(true);
  await confirmPlate(page, "MP 09 JK 7890");

  // The invoice, from the driver's phone.
  await heading(page, "Invoice");
  const first = await openPhone(browser, page);
  await expect(first.phone.getByText("Your truck: MP 09 JK 7890")).toBeVisible();
  await phonePicture(first.phone, "phone-1-ready-en");
  await look(page, "05-invoice-qr");
  // The driver switched to Hindi and back; the phone page follows the ticket.
  const saved = page.waitForResponse(
    (answer) => answer.url().endsWith("/details") && answer.request().method() === "PATCH",
  );
  await page.locator("aside").getByRole("button", { name: "हिंदी" }).click();
  expect((await saved).ok()).toBe(true);
  // Once: the upload routes allow only a few requests a minute.
  await first.phone.reload();
  await expect(first.phone.locator("html")).toHaveAttribute("lang", "hi");
  await expect(first.phone.getByRole("button", { name: "फ़ोटो लें" })).toBeVisible();
  await phonePicture(first.phone, "phone-1-ready-hi");
  await first.phone.getByTestId("upload-file").setInputFiles(sampleInvoice("sand.pdf"));
  await expect(first.phone.getByTestId("upload-sent")).toContainText("धर्म कांटे की स्क्रीन देखें");
  await phonePicture(first.phone, "phone-2-sent-hi");
  // The code works once.
  await first.phone.reload();
  await expect(first.phone.getByTestId("upload-gone")).toBeVisible();
  await phonePicture(first.phone, "phone-3-used");
  await first.close();
  await page.locator("aside").getByRole("button", { name: "English" }).click();

  await expect(page.locator("main")).toContainText("SMPL-SND-003");
  await expect(page.locator("main")).toContainText("900 kg");
  await look(page, "07-invoice-values");
  await press(page, "Next");

  await heading(page, "Material");
  await look(page, "09-material");
  await press(page, "Sand");

  await heading(page, "Supplier");
  await expect(page.getByTestId("party")).toHaveText("Narmada Sand Suppliers");
  await look(page, "11-supplier-confirm");
  // "No" shows the list; the same supplier is picked there.
  await press(page, "No");
  await look(page, "12-supplier-choose");
  await press(page, "Narmada Sand Suppliers");
  await heading(page, "Transporter");
  await look(page, "13-transporter-confirm");
  await press(page, "Yes");

  await heading(page, "Phone number");
  await typeDigits(page, "1234");
  await expect(page.locator("main").getByRole("alert")).toContainText("starts with 6 to 9");
  await look(page, "14-phone");
  await press(page, "Clear");
  await typeDigits(page, "9000000001");
  await press(page, "Next");

  await heading(page, "Your name");
  await look(page, "15-name");
  await press(page, "Skip");

  await heading(page, "Check");
  await expect(page.locator("main")).toContainText("Narmada Sand Suppliers");
  await look(page, "16-check");
  await press(page, "Edit");
  await look(page, "16-check-edit");
  bridge.wobble(true);
  await press(page, "Next");

  await heading(page, "First weight");
  await expect(page.getByTestId("ring")).toHaveAttribute("data-state", "empty");
  // Said once, by the heading: the ring does not repeat it.
  await expect(page.locator("body").getByText("Please stay still", { exact: true })).toHaveCount(1);
  await look(page, "17-weighing");
  bridge.wobble(false);
  await expect(page.getByTestId("ring")).toHaveAttribute("data-state", "full");
  await look(page, "18-weight-confirm");
  // "Wrong weight": nothing is saved, and the ring starts again.
  await press(page, "Wrong weight");
  await expect(page.getByTestId("ring")).toHaveAttribute("data-state", /empty|filling/);
  await confirmWeight(page, "19,150 kg");

  await heading(page, "Go to CH-012+300");
  await expect(page.getByTestId("slip")).toContainText("19,150 kg");
  // The supervisor and the phone number are the line under "Go to".
  await expect(page.getByText("Pankaj Gupta · 9876543216")).toBeVisible();
  await look(page, "19-first-slip");
  await press(page, "Print slip");
  await expect.poll(() => printCount(page)).toBe(1);
  // The next print is a reprint.
  await expect(page.getByTestId("slip")).toContainText("Reprint");
  await printedPages(page, "30-print-first-reprint");
  await press(page, "Done");

  // Done, but the truck is still on the bridge: busy, and not woken again.
  await expect(page.getByTestId("bridge-status")).toContainText("Busy");
  await look(page, "01-ready-busy");
  await leave(page, bridge);

  // ---- Second visit ----
  await arrive(page, bridge, 18_250);
  await confirmPlate(page, "MP 09 JK 7890");
  await heading(page, "Welcome back");
  await expect(page.getByRole("status").filter({ hasText: "Ready for the second" })).toBeVisible();
  await expect(page.getByTestId("steps")).toHaveAttribute("data-total", "3");
  await look(page, "20-welcome-back-ready");
  await press(page, "Second weight");
  await confirmWeight(page, "18,250 kg");

  await heading(page, "Thank you, drive safely");
  await expect(page.getByTestId("slip")).toContainText("900 kg");
  await expect(page.getByTestId("slip")).toContainText("PASS");
  await look(page, "23-final-slip");
  await press(page, "Print slip");
  await printedPages(page, "31-print-final-reprint");
  // By itself back to Ready after 15 seconds.
  await expect(page.getByTestId("bridge-status")).toBeVisible({ timeout: 25_000 });
  await leave(page, bridge);
});

/** What the print dialog would get: only the white slip, at 80 mm and on A4. */
async function printedPages(page: Page, name: string) {
  const size = page.viewportSize()!;
  await page.emulateMedia({ media: "print" });
  for (const [paper, width] of [
    ["80mm", 302],
    ["a4", 794],
  ] as const) {
    await page.setViewportSize({ width, height: 1123 });
    const slip = page.getByTestId("print-slip");
    await expect(slip).toBeVisible();
    await expect(page.getByTestId("slip")).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${paper}: nothing is cut off at the side`).toBeLessThanOrEqual(0);
    if (SHOTS) {
      await slip.screenshot({ path: `${SHOT_FOLDER}${name}-${paper}.png` });
    }
  }
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize(size);
}

test("2. Type 1, approved by the supervisor: cement", async ({ page, browser }) => {
  await office.pick("MH12AB1234", "cement");
  await openKiosk(page);
  await arrive(page, bridge, 32_560);
  await confirmPlate(page, "MH 12 AB 1234");
  await uploadFromPhone(browser, page, "cement.jpg");
  await press(page, "Next");

  // The wrong material first: asked again.
  await heading(page, "Material");
  await press(page, "Sand");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "does not match your invoice",
  );
  await look(page, "10-material-mismatch");
  await answerQuestions(page, "Cement Bags", "9000000002");

  // Tap a line to change it, and come straight back.
  await page.locator("main").getByRole("button", { name: /^Name/ }).click();
  await heading(page, "Your name");
  for (const letter of "RAVI") await press(page, letter);
  await expect(page.getByRole("status", { name: "Your name" })).toHaveText("Ravi");
  await look(page, "15-name-typed");
  await press(page, "Next");
  await heading(page, "Check");
  await expect(page.locator("main")).toContainText("Ravi");
  await press(page, "Next");
  await confirmWeight(page, "32,560 kg");

  await heading(page, "Go to Plant");
  await expect(page.getByText(/Amit Kumar · 9876543210/)).toBeVisible();
  await leave(page, bridge);

  // Back before the supervisor has looked: wait.
  await arrive(page, bridge, 18_250);
  await confirmPlate(page, "MH 12 AB 1234");
  await heading(page, "Welcome back");
  await expect(page.getByText("Waiting for supervisor approval")).toBeVisible();
  await expect(page.getByRole("button", { name: "Second weight" })).toHaveCount(0);
  await look(page, "21-welcome-back-waiting");

  // The screen changes by itself when the supervisor approves.
  await office.supervisorDecides("MH12AB1234", "MH12AB1234", { decision: "APPROVE" });
  await expect(page.getByText("Approved. You can take the second weight.")).toBeVisible();
  await look(page, "22-welcome-back-approved");
  await press(page, "Second weight");
  await confirmWeight(page, "18,250 kg");
  await heading(page, "Thank you, drive safely");
  await expect(page.getByTestId("slip")).toContainText("14,310 kg");
  await expect(page.getByTestId("slip")).toContainText("Amit Kumar");
  await look(page, "23-final-slip-type1");
  await printedPages(page, "32-print-final-type1");
});

test("3. Fraud blocked, and the same truck tries again", async ({ page, browser }) => {
  await office.pick("MH14CD5678", "cement");
  await openKiosk(page);
  await arrive(page, bridge, 32_560);
  await confirmPlate(page, "MH 14 CD 5678");
  await uploadFromPhone(browser, page, "cement.pdf");
  // The sample cement invoice is made out to another truck.
  await expect(page.locator("main").getByRole("alert")).toContainText("names another truck");
  await look(page, "07-invoice-other-truck");
  await press(page, "Next");
  await answerQuestions(page, "Cement Bags", "9000000003");
  await press(page, "Next");
  await confirmWeight(page, "32,560 kg");
  await heading(page, "Go to Plant");
  await leave(page, bridge);

  await arrive(page, bridge, 18_250);
  await confirmPlate(page, "MH 14 CD 5678");
  await expect(page.getByText("Waiting for supervisor approval")).toBeVisible();
  // Another truck is at the unloading point.
  await office.supervisorDecides("MH14CD5678", "RJ14LM2345", {
    decision: "REJECT",
    reason: "Wrong vehicle",
  });
  await expect(page.getByTestId("message-blocked")).toContainText("Your truck was not approved.");
  await look(page, "24-blocked");
  await leave(page, bridge);

  // It tries to start over.
  await office.pick("MH14CD5678", "cement");
  await arrive(page, bridge, 32_560);
  await confirmPlate(page, "MH 14 CD 5678");
  await expect(page.getByTestId("message-notApprovedEarlier")).toContainText(
    "Not approved earlier.",
  );
  await look(page, "25-not-approved-earlier");
  await office.storeDecides("MH14CD5678", "PLATE_WARNING", {
    decision: "REJECT",
    reason: "Blocked earlier today",
  });
  await expect(page.getByTestId("message-rejected")).toBeVisible();
  await look(page, "26-rejected");
  await leave(page, bridge);
  // Turned away: shown on the Ready screen for 10 minutes.
  await expect(page.getByText("Not approved — please leave")).toBeVisible();
  await expect(page.getByText("MH 14 CD 5678")).toBeVisible();
});

test("4. Type 2, approved by the store officer: steel scrap", async ({ page, browser }) => {
  await office.pick("UP32EF9012", "steel-scrap");
  await openKiosk(page);
  await arrive(page, bridge, 19_750);
  await confirmPlate(page, "UP 32 EF 9012");
  await uploadFromPhone(browser, page, "steel-scrap.jpg");
  await press(page, "Next");
  await answerQuestions(page, "Steel Scrap", "9000000004");
  await press(page, "Next");
  await confirmWeight(page, "19,750 kg");
  await expect(page.getByTestId("message-waitStore")).toContainText("move aside and wait");
  await look(page, "27-wait-store");
  await leave(page, bridge);

  await office.storeDecides("UP32EF9012", "STORE_TYPE2", { decision: "APPROVE" });
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "UP 32 EF 9012, your slip is ready",
  );
  await expect(page.getByRole("button", { name: "UP 32 EF 9012" })).toBeVisible();
  await look(page, "28-ready-to-collect");
  await press(page, "UP 32 EF 9012");
  await heading(page, /^Go to /);
  await expect(page.getByTestId("slip")).toContainText("19,750 kg");
  await look(page, "29-collect-slip");
  await press(page, "Print slip");
  await expect(page.getByTestId("slip")).toContainText("Reprint");
  await press(page, "Back");
  // Printed: it leaves the list.
  await expect(page.getByText("No slips are waiting.")).toBeVisible();

  await arrive(page, bridge, 18_250);
  await confirmPlate(page, "UP 32 EF 9012");
  await press(page, "Second weight");
  await confirmWeight(page, "18,250 kg");
  await heading(page, "Thank you, drive safely");
  await expect(page.getByTestId("slip")).toContainText("1,500 kg");
});

test("5. Tolerance fail, resolved by the store officer: aggregate", async ({ page, browser }) => {
  await office.pick("DL01NP6789", "aggregate");
  await openKiosk(page);
  await arrive(page, bridge, 32_560);
  await confirmPlate(page, "DL 01 NP 6789");
  await uploadFromPhone(browser, page, "aggregate.jpg");
  await press(page, "Next");
  await answerQuestions(page, "Aggregate 20 mm", "9000000005");
  await press(page, "Next");
  await confirmWeight(page, "32,560 kg");
  await expect(page.getByTestId("message-waitStore")).toBeVisible();

  // Approved while the truck still waits: the slip appears by itself.
  await office.storeDecides("DL01NP6789", "STORE_TYPE2", { decision: "APPROVE" });
  await heading(page, /^Go to /);
  await leave(page, bridge);

  await arrive(page, bridge, 18_250);
  await confirmPlate(page, "DL 01 NP 6789");
  await press(page, "Second weight");
  await confirmWeight(page, "18,250 kg");
  await expect(page.getByTestId("message-hold")).toContainText("does not match the invoice");
  await look(page, "29-hold");
  await office.storeDecides("DL01NP6789", "HOLD", { decision: "APPROVE", chosenWeight: "NET" });
  await heading(page, "Thank you, drive safely");
  await expect(page.getByTestId("slip")).toContainText("Accepted (net)");
  await expect(page.getByTestId("slip")).toContainText("Store approved");
  await look(page, "23-final-slip-hold");
  await printedPages(page, "33-print-final-hold");
});
