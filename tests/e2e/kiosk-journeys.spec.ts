// The five truck journeys of Phase 8, now through the real weighbridge screens and the
// driver's phone, by touch only. The weights come from the ESP32 simulator; plates and
// invoices from the demo "pick" modes, so no outside service is used.
//
// IT RUNS "RESET DEMO DATA" FIRST: demo tickets in the development database are deleted.
import { expect, test, type Page } from "@playwright/test";
import {
  answerQuestions,
  arrive,
  confirmLoaded,
  confirmPlate,
  confirmWeight,
  EMPTY_KG,
  heading,
  leave,
  LOADED_KG,
  look,
  Office,
  openKiosk,
  openPhone,
  phonePicture,
  press,
  printCount,
  sampleInvoice,
  sayLoad,
  SHOT_FOLDER,
  SHOTS,
  typeDigits,
  uploadFromPhone,
  Weighbridge,
} from "./kiosk-world";

/** What the loaded truck of the 900 kg bill weighs. */
const SMALL_LOAD_KG = EMPTY_KG + 900;
/** With the bridge empty, a result goes back to Ready by itself after this long. */
const BACK_TO_READY_MS = 15_000;

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

test("1. Type 3, fully automatic: 900 kg of steel scrap", async ({ page, browser }) => {
  await office.pick("UP32EF9012", "scrap-small");
  await openKiosk(page);
  await expect(page.getByTestId("bridge-status")).toContainText("Weighbridge ready");
  await look(page, "01-ready");

  bridge.driveOn(SMALL_LOAD_KG);
  await heading(page, "Language");
  await look(page, "02-language");
  await page
    .locator("main")
    .getByRole("button", { name: /^English/ })
    .click();

  // The plate, with both cameras' photos.
  await expect(page.getByTestId("plate")).toHaveText("UP 32 EF 9012");
  await expect(page.getByTestId("camera-front").locator("img")).toBeVisible();
  await expect(page.getByTestId("camera-back").locator("img")).toBeVisible();
  await expect(page.getByTestId("steps")).toHaveAttribute("data-current", "2");
  await look(page, "04-plate-confirm");

  // The truck rolls back: the position screen, which goes by itself.
  bridge.position(false);
  await expect(page.getByTestId("position")).toBeVisible();
  await look(page, "03-position");
  bridge.position(true);
  await confirmPlate(page, "UP 32 EF 9012");
  await heading(page, "Loaded or empty?");
  await expect(page.getByTestId("steps")).toHaveAttribute("data-current", "3");
  await look(page, "04b-loaded-or-empty");
  await sayLoad(page, "Loaded");

  // The invoice, from the driver's phone.
  await heading(page, "Invoice");
  const first = await openPhone(browser, page);
  await expect(first.phone.getByText("Your truck: UP 32 EF 9012")).toBeVisible();
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
  await first.phone.getByTestId("upload-file").setInputFiles(sampleInvoice("scrap-small.pdf"));
  await expect(first.phone.getByTestId("upload-sent")).toContainText("धर्म कांटे की स्क्रीन देखें");
  await phonePicture(first.phone, "phone-2-sent-hi");
  // The code works once.
  await first.phone.reload();
  await expect(first.phone.getByTestId("upload-gone")).toBeVisible();
  await phonePicture(first.phone, "phone-3-used");
  await first.close();
  await page.locator("aside").getByRole("button", { name: "English" }).click();

  await expect(page.locator("main")).toContainText("SMPL-SCR-009");
  await expect(page.locator("main")).toContainText("900 kg");
  await look(page, "07-invoice-values");
  await press(page, "Next");

  await heading(page, "Material");
  await look(page, "09-material");
  await press(page, "Steel Scrap");

  await heading(page, "Supplier");
  await expect(page.getByTestId("party")).toHaveText("Ganga Steel Traders");
  await look(page, "11-supplier-confirm");
  // "No" shows the list; the same supplier is picked there.
  await press(page, "No");
  await look(page, "12-supplier-choose");
  await press(page, "Ganga Steel Traders");
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
  await expect(page.locator("main")).toContainText("Ganga Steel Traders");
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
  await confirmWeight(page, "13,400 kg");

  await heading(page, "Go to Plant – Dinesh Verma");
  await expect(page.getByTestId("slip")).toContainText("13,400 kg");
  // The weight and the supervisor's phone number are the line under "Go to".
  await expect(page.getByText("First weight: 13,400 kg · 9876543215")).toBeVisible();
  await look(page, "19-first-slip");
  await press(page, "Print slip");
  await expect.poll(() => printCount(page)).toBe(1);
  // The next print is a reprint.
  await expect(page.getByTestId("slip")).toContainText("Reprint");
  await printedPages(page, "30-print-first-reprint");
  // While the truck is on the bridge the result stays, however long: no "Busy" screen.
  await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
  await page.waitForTimeout(BACK_TO_READY_MS + 2000);
  await expect(page.getByTestId("slip")).toBeVisible();
  // It drives off, and the weighbridge is ready at once.
  const leftAt = Date.now();
  await leave(page, bridge);
  expect(Date.now() - leftAt).toBeLessThan(BACK_TO_READY_MS);

  // ---- Second visit ----
  await arrive(page, bridge, EMPTY_KG);
  // A ticket is waiting for this plate: straight to the second weight, with no questions.
  await confirmPlate(page, "UP 32 EF 9012");
  await heading(page, "Welcome back");
  await expect(page.getByRole("status").filter({ hasText: "Ready for the second" })).toBeVisible();
  await expect(page.getByTestId("steps")).toHaveAttribute("data-total", "3");
  await look(page, "20-welcome-back-ready");
  await press(page, "Second weight");
  await confirmWeight(page, "12,500 kg");

  await heading(page, "Thank you, drive safely");
  await expect(page.getByTestId("slip")).toContainText("900 kg");
  await expect(page.getByTestId("slip")).toContainText("PASS");
  await look(page, "23-final-slip");
  // Not printed: the truck drives off, and the slip waits under "Ready to collect".
  await leave(page, bridge);
  await press(page, "UP 32 EF 9012");
  await heading(page, "Thank you, drive safely");
  await press(page, "Print slip");
  await expect(page.getByTestId("slip")).toContainText("Reprint");
  await printedPages(page, "31-print-final-reprint");
  await press(page, "Back");
  await expect(page.getByRole("button", { name: "UP 32 EF 9012" })).toHaveCount(0);
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

test("2. Type 1, approved by the supervisor: sand", async ({ page, browser }) => {
  await office.pick("MP09JK7890", "sand");
  await openKiosk(page);
  await arrive(page, bridge, LOADED_KG);
  await confirmLoaded(page, "MP 09 JK 7890");
  await uploadFromPhone(browser, page, "sand.jpg");
  await press(page, "Next");

  // The wrong material first: asked again.
  await heading(page, "Material");
  await press(page, "Bricks");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "does not match your invoice",
  );
  await look(page, "10-material-mismatch");
  await answerQuestions(page, "Sand", "9000000002");

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
  await confirmWeight(page, "32,500 kg");

  await heading(page, "Go to CH-012+300 – Pankaj Gupta");
  await expect(page.getByText("First weight: 32,500 kg · 9876543216")).toBeVisible();
  await look(page, "19-first-slip-type1");
  await leave(page, bridge);

  // Back before the supervisor has looked: wait.
  await arrive(page, bridge, EMPTY_KG);
  await confirmPlate(page, "MP 09 JK 7890");
  await heading(page, "Welcome back");
  await expect(page.getByText("Waiting for supervisor approval")).toBeVisible();
  await expect(page.getByRole("button", { name: "Second weight" })).toHaveCount(0);
  await look(page, "21-welcome-back-waiting");

  // The screen changes by itself when the supervisor approves.
  await office.supervisorDecides("MP09JK7890", "MP09JK7890", { decision: "APPROVE" });
  await expect(page.getByText("Approved. You can take the second weight.")).toBeVisible();
  await look(page, "22-welcome-back-approved");
  await press(page, "Second weight");
  await confirmWeight(page, "12,500 kg");
  await heading(page, "Thank you, drive safely");
  await expect(page.getByTestId("slip")).toContainText("20,000 kg");
  await expect(page.getByTestId("slip")).toContainText("Pankaj Gupta");
  await look(page, "23-final-slip-type1");
  await printedPages(page, "32-print-final-type1");
});

test("3. Fraud blocked, and the same truck tries again", async ({ page, browser }) => {
  await office.pick("MH14CD5678", "sand");
  await openKiosk(page);
  await arrive(page, bridge, LOADED_KG);
  await confirmLoaded(page, "MH 14 CD 5678");
  await uploadFromPhone(browser, page, "sand.pdf");
  // The sample sand invoice is made out to another truck.
  await expect(page.locator("main").getByRole("alert")).toContainText("names another truck");
  await look(page, "07-invoice-other-truck");
  await press(page, "Next");
  await answerQuestions(page, "Sand", "9000000003");
  await press(page, "Next");
  await confirmWeight(page, "32,500 kg");
  await heading(page, "Go to CH-012+300");
  await leave(page, bridge);

  await arrive(page, bridge, EMPTY_KG);
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
  await office.pick("MH14CD5678", "sand");
  await arrive(page, bridge, LOADED_KG);
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
  await arrive(page, bridge, LOADED_KG);
  await confirmLoaded(page, "UP 32 EF 9012");
  await uploadFromPhone(browser, page, "steel-scrap.jpg");
  await press(page, "Next");
  await answerQuestions(page, "Steel Scrap", "9000000004");
  await press(page, "Next");
  await confirmWeight(page, "32,500 kg");
  await expect(page.getByTestId("message-waitStore")).toContainText("Wait aside");
  await expect(page.getByTestId("held-weight")).toHaveText("First weight: 32,500 kg");
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
  await expect(page.getByTestId("slip")).toContainText("32,500 kg");
  await look(page, "29-collect-slip");
  await press(page, "Print slip");
  await expect(page.getByTestId("slip")).toContainText("Reprint");
  await press(page, "Back");
  // Printed: it leaves the list.
  await expect(page.getByRole("button", { name: "UP 32 EF 9012" })).toHaveCount(0);

  await arrive(page, bridge, EMPTY_KG);
  await confirmPlate(page, "UP 32 EF 9012");
  await press(page, "Second weight");
  await confirmWeight(page, "12,500 kg");
  await heading(page, "Thank you, drive safely");
  await expect(page.getByTestId("slip")).toContainText("20,000 kg");
});

test("5. Tolerance fail, resolved by the store officer: aggregate", async ({ page, browser }) => {
  await office.pick("DL01NP6789", "aggregate-short");
  await openKiosk(page);
  await arrive(page, bridge, LOADED_KG);
  await confirmLoaded(page, "DL 01 NP 6789");
  await uploadFromPhone(browser, page, "aggregate-short.jpg");
  await press(page, "Next");
  await answerQuestions(page, "Aggregate 20 mm", "9000000005");
  await press(page, "Next");
  await confirmWeight(page, "32,500 kg");
  await heading(page, "Go to CH-003+750 – Suresh Yadav");
  await leave(page, bridge);
  await office.supervisorDecides("DL01NP6789", "DL01NP6789", { decision: "APPROVE" }, "suresh");

  await arrive(page, bridge, EMPTY_KG);
  await confirmPlate(page, "DL 01 NP 6789");
  await press(page, "Second weight");
  await confirmWeight(page, "12,500 kg");
  await expect(page.getByTestId("message-hold")).toContainText("does not match the invoice");
  await look(page, "29-hold");
  await office.storeDecides("DL01NP6789", "HOLD", { decision: "APPROVE", chosenWeight: "NET" });
  await heading(page, "Thank you, drive safely");
  await expect(page.getByTestId("slip")).toContainText("Accepted (net)");
  await expect(page.getByTestId("slip")).toContainText("Store approved");
  await look(page, "23-final-slip-hold");
  await printedPages(page, "33-print-final-hold");
});
