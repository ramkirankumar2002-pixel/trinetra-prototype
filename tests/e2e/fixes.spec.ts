// The changes after trying the app with the simulator: an empty truck, a loaded truck
// without an invoice, and what the weighbridge shows after each weight. The trucks are the
// simulator's own (32,500 kg loaded, 12,500 kg empty). Every changed screen is checked in
// English and Hindi. (Three logins in one browser are in logins.spec.ts, and the 15 s
// return with an empty bridge in the website's unit tests.)
//
// Set FIXES_SHOTS=1 to save the pictures in docs/screenshots/fixes-tested.
//
// IT RUNS "RESET DEMO DATA" FIRST: demo tickets in the database are deleted.
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { TicketView } from "@trinetra/shared";
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
  press,
  sayLoad,
  typeDigits,
  uploadFromPhone,
  Weighbridge,
} from "./kiosk-world";
import { WEB_URL } from "./playwright.config";
import { LAPTOP, lookAt, PHONE } from "./staff-look";
import { signIn } from "./staff-session";

const FOLDER =
  process.env.FIXES_SHOTS === "1"
    ? fileURLToPath(new URL("../../docs/screenshots/fixes-tested/", import.meta.url))
    : null;

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
  await office?.reset();
  await office?.dispose();
});

test.afterEach(() => bridge.driveOff());

/** The QR code of the slip on screen: the address of the ticket's public page. */
async function slipAddress(page: Page): Promise<string> {
  const qr = page.getByTestId("slip-qr");
  await expect(qr).toHaveAttribute("data-url", /\/t\/[0-9a-f]{32}$/);
  return new URL((await qr.getAttribute("data-url"))!).pathname;
}

/** The ticket page on a phone with no login. */
async function publicPage(browser: Browser, address: string, name: string, shows: string) {
  const context = await browser.newContext({ viewport: PHONE });
  const phone = await context.newPage();
  await phone.goto(address);
  await expect(phone.getByTestId("public-timeline")).toBeVisible();
  await expect(phone.locator("main")).toContainText(shows);
  await lookAt(phone, name, { folder: FOLDER, back: PHONE });
  await context.close();
}

async function storePage(browser: Browser) {
  const context = await browser.newContext({ viewport: LAPTOP });
  await signIn(context, "ram");
  const page = await context.newPage();
  await page.goto("/store/approvals");
  await expect(page.getByTestId("connection")).toHaveText("Online");
  return { page, context };
}

const row = (page: Page, plate: string) =>
  page.getByRole("table").getByRole("row").filter({ hasText: plate });

const ready = (page: Page) =>
  expect(page.getByTestId("bridge-status")).toContainText("Weighbridge ready");

test("an empty truck: one weight, a slip, and drive off", async ({ page, browser }) => {
  await office.pick("BR06QR4321", "bitumen");
  await openKiosk(page);
  await arrive(page, bridge, EMPTY_KG);
  await confirmPlate(page, "BR 06 QR 4321");

  await heading(page, "Loaded or empty?");
  await expect(page.locator("main").getByRole("button")).toHaveCount(2);
  await look(page, "01-loaded-or-empty", FOLDER);
  await sayLoad(page, "Empty");

  // No invoice, no material, no questions: straight to the weight.
  await heading(page, "Empty vehicle weight");
  await expect(page.getByTestId("ring")).toHaveAttribute("data-state", "full");
  await look(page, "02-empty-weighing", FOLDER);
  await confirmWeight(page, "12,500 kg");

  await heading(page, "Please drive off");
  await expect(page.getByText("Empty vehicle weight: 12,500 kg")).toBeVisible();
  await expect(page.getByTestId("slip")).toContainText("12,500 kg");
  await expect(page.getByTestId("slip")).not.toContainText("PASS");
  await expect(page.getByRole("button", { name: "Print slip" })).toBeVisible();
  await look(page, "03-empty-slip", FOLDER);
  const address = await slipAddress(page);

  // Gone as soon as the truck is, and its slip can still be collected.
  await leave(page, bridge);
  await expect(page.getByRole("button", { name: "BR 06 QR 4321" })).toBeVisible();
  await look(page, "04-ready-to-collect", FOLDER);
  await press(page, "BR 06 QR 4321");
  await press(page, "Print slip");
  await press(page, "Back");
  await ready(page);
  await expect(page.getByRole("button", { name: "BR 06 QR 4321" })).toHaveCount(0);

  await publicPage(browser, address, "05-public-empty", "Empty vehicle weight");

  const store = await storePage(browser);
  await store.page.goto("/store/history");
  await expect(row(store.page, "BR 06 QR 4321")).toContainText("Empty vehicle");
  await expect(row(store.page, "BR 06 QR 4321")).toContainText("12,500 kg");
  await lookAt(store.page, "06-store-history-empty", { folder: FOLDER, back: LAPTOP });
  await store.context.close();
});

test("a loaded truck without an invoice: the store officer, then the supervisor", async ({
  page,
  browser,
}) => {
  await office.pick("MP09JK7890", "sand");
  const store = await storePage(browser);
  await openKiosk(page);
  await arrive(page, bridge, LOADED_KG);
  await confirmLoaded(page, "MP 09 JK 7890");

  // The QR code, "No phone?" and the third choice.
  await heading(page, "Invoice");
  await expect(page.getByTestId("upload-qr")).toBeVisible();
  await expect(page.getByRole("button", { name: "No phone?" })).toBeVisible();
  await look(page, "07-invoice-three-choices", FOLDER);
  await press(page, "No invoice");

  // The driver still chooses the material. With no bill, the supplier is picked.
  await heading(page, "Material");
  await press(page, "Sand");
  await heading(page, "Supplier");
  await press(page, "Narmada Sand Suppliers");
  await heading(page, "Transporter");
  await press(page, "Yes");
  await heading(page, "Phone number");
  await typeDigits(page, "9000000011");
  await press(page, "Next");
  await heading(page, "Your name");
  await press(page, "Skip");
  await heading(page, "Check");
  await expect(page.locator("main")).toContainText("No invoice");
  await look(page, "08-check-no-invoice", FOLDER);
  await press(page, "Next");
  await confirmWeight(page, "32,500 kg");

  // A result, not a busy screen: the weight and where to go.
  await heading(page, "Weight taken");
  await expect(page.getByTestId("held-weight")).toHaveText("First weight: 32,500 kg");
  await expect(page.getByTestId("message-waitStore")).toContainText(
    "Wait aside for the store officer",
  );
  await look(page, "09-wait-aside", FOLDER);
  await leave(page, bridge);

  await expect(row(store.page, "MP 09 JK 7890")).toContainText("No invoice");
  await lookAt(store.page, "10-store-approvals-no-invoice", { folder: FOLDER, back: LAPTOP });
  await row(store.page, "MP 09 JK 7890").getByRole("link", { name: /^Open/ }).click();
  await expect(store.page.getByTestId("actions")).toContainText("There will be no tolerance check");
  await lookAt(store.page, "11-store-request-no-invoice", { folder: FOLDER, back: LAPTOP });
  await store.page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(store.page.getByTestId("outcome")).toHaveAttribute("data-outcome", "approved");

  // The first slip: sand is Type 1, so its supervisor checks it too.
  await press(page, "MP 09 JK 7890");
  await heading(page, "Go to CH-012+300 – Pankaj Gupta");
  await expect(page.getByText("First weight: 32,500 kg · 9876543216")).toBeVisible();
  await expect(page.getByTestId("slip")).toContainText("No invoice – no tolerance check");
  await look(page, "12-first-slip-no-invoice", FOLDER);
  await press(page, "Print slip");
  await press(page, "Back");
  await office.supervisorDecides("MP09JK7890", "MP09JK7890", { decision: "APPROVE" });

  await arrive(page, bridge, EMPTY_KG);
  // The open ticket: straight to the second weight.
  await confirmPlate(page, "MP 09 JK 7890");
  await heading(page, "Welcome back");
  await press(page, "Second weight");
  await confirmWeight(page, "12,500 kg");
  await heading(page, "Thank you, drive safely");
  const slip = page.getByTestId("slip");
  await expect(slip).toContainText("20,000 kg");
  await expect(slip).toContainText("No invoice – no tolerance check");
  await expect(slip).not.toContainText("PASS");
  await look(page, "13-final-slip-no-invoice", FOLDER);
  const address = await slipAddress(page);
  await leave(page, bridge);
  await expect(page.getByRole("button", { name: "MP 09 JK 7890" })).toBeVisible();

  await publicPage(browser, address, "14-public-no-invoice", "No invoice – no tolerance check");

  const list = await store.context.request.get(`${WEB_URL}/api/store/history`);
  const { tickets } = (await list.json()) as { tickets: { ticketId: number; plate: string }[] };
  const mine = tickets.find((item) => item.plate === "MP09JK7890")!;
  const answer = await store.context.request.get(`${WEB_URL}/api/tickets/${mine.ticketId}`);
  expect((await answer.json()) as TicketView).toMatchObject({
    status: "COMPLETED",
    noInvoice: true,
    variancePct: null,
    firstWeightKg: LOADED_KG,
    secondWeightKg: EMPTY_KG,
    netKg: 20_000,
  });
  await store.context.close();
});

test("a result with a supervisor to go to stays until the truck leaves", async ({
  page,
  browser,
}) => {
  await office.pick("UP70GH3456", "aggregate-10");
  await openKiosk(page);
  await arrive(page, bridge, LOADED_KG);
  await confirmLoaded(page, "UP 70 GH 3456");

  // A reading that failed offers "No invoice" too.
  await page.route(/\/api\/tickets\/\d+$/, async (route) => {
    const real = await route.fetch();
    const ticket = (await real.json()) as TicketView;
    ticket.invoice = { ...ticket.invoice, state: "failed", error: "READER_BUSY" };
    await route.fulfill({ response: real, json: ticket });
  });
  await page.reload();
  await heading(page, "Language");
  await page
    .locator("main")
    .getByRole("button", { name: /^English/ })
    .click();
  await confirmPlate(page, "UP 70 GH 3456");
  await sayLoad(page, "Loaded");
  await expect(page.getByText("The invoice could not be read.")).toBeVisible();
  await expect(page.getByRole("button", { name: "No invoice" })).toBeVisible();
  await look(page, "15-invoice-not-read", FOLDER);
  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await heading(page, "Language");
  await page
    .locator("main")
    .getByRole("button", { name: /^English/ })
    .click();
  await confirmPlate(page, "UP 70 GH 3456");
  await sayLoad(page, "Loaded");

  await uploadFromPhone(browser, page, "aggregate-10.jpg");
  await press(page, "Next");
  await answerQuestions(page, "Aggregate 10 mm", "9000000012");
  await press(page, "Next");
  await confirmWeight(page, "32,500 kg");
  await heading(page, "Go to CH-005+250 – Ravi Singh");
  await expect(page.getByText("First weight: 32,500 kg · 9876543212")).toBeVisible();
  await look(page, "16-first-slip-go-to", FOLDER);
  await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
  await leave(page, bridge);
});
