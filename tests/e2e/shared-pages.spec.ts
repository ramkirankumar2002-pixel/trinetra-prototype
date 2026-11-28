// Phase 14: the home page, the ticket page behind a slip's QR code, and the demo settings.
// The truck is driven at the real weighbridge screen with the ESP32 simulator.
//
// IT RUNS "RESET DEMO DATA" FIRST: demo tickets in the development database are deleted.
// PHASE14_SHOTS=1 saves the pictures in docs/screenshots/phase14.
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { DemoSettings, TicketView } from "@trinetra/shared";
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
  Office,
  openKiosk,
  press,
  uploadFromPhone,
  Weighbridge,
} from "./kiosk-world";
import { WEB_URL } from "./playwright.config";
import { LAPTOP, lookAt, noSidewaysScroll, PHONE } from "./staff-look";
import { signIn } from "./staff-session";

const SHOTS = process.env.PHASE14_SHOTS === "1";
const FOLDER = fileURLToPath(new URL("../../docs/screenshots/phase14/", import.meta.url));
const PLATE = "MP09JK7890";
const DRIVER_PHONE = "9000000014";

const bridge = new Weighbridge();
let office: Office;

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.beforeAll(async ({ browser }) => {
  office = await Office.open(browser);
  await office.reset();
  await office.allReal();
  bridge.start();
});

test.afterAll(async () => {
  bridge.stop();
  await office?.allReal();
  await office?.reset();
  await office?.dispose();
});

test.afterEach(() => bridge.driveOff());

async function picture(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  );
  if (!SHOTS) return;
  await mkdir(FOLDER, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: `${FOLDER}${name}.png`, fullPage, animations: "disabled" });
}

const noScrollDown = async (page: Page, name: string) => {
  const extra = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(extra, `${name}: fits without scrolling`).toBeLessThanOrEqual(0);
};

const language = (page: Page, name: "English" | "हिंदी") =>
  page.getByRole("button", { name, exact: true }).first().click();

test("home: three cards that each open their part, and how it works", async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Trinetra Systems" })).toBeVisible();
  await expect(page.getByText("reads, weighs and verifies every truck")).toBeVisible();

  for (const [code, hindi] of [
    ["en", "Truck arrives"],
    ["hi", "ट्रक आता है"],
  ] as const) {
    if (code === "hi") await language(page, "हिंदी");
    await expect(page.getByRole("listitem").filter({ hasText: hindi })).toBeVisible();
    await noScrollDown(page, `home ${code}`);
    await noSidewaysScroll(page, `home ${code}`);
    await picture(page, `home-${code}`);
    await page.setViewportSize(PHONE);
    await noSidewaysScroll(page, `home ${code} phone`);
    await page.setViewportSize(LAPTOP);
  }
  await language(page, "English");

  for (const [card, address] of [
    ["Weighbridge kiosk", "/kiosk/login"],
    ["Supervisor", "/supervisor/login"],
    ["Store officer", "/store/login"],
  ] as const) {
    await page.goto("/");
    await page.getByRole("link", { name: new RegExp(`^${card}`) }).click();
    await expect(page).toHaveURL(`${WEB_URL}${address}`);
  }
});

test("a wrong ticket address says that there is no such ticket", async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const address of ["/t/WB01-20261128-0001", `/t/${"0".repeat(32)}`, "/t/1"]) {
    await page.goto(address);
    await expect(page.getByRole("heading", { name: "Ticket not found" })).toBeVisible();
    await expect(page.getByTestId("public-timeline")).toHaveCount(0);
  }
});

/** A phone that has no login of any kind. */
async function strangerPhone(browser: Browser) {
  const context = await browser.newContext({
    viewport: PHONE,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  return { context, phone: await context.newPage() };
}

/** The truck's picture covers no part of the number plate. */
async function noOverlap(page: Page, name: string) {
  const plate = (await page.getByTestId("plate").boundingBox())!;
  const photo = (await page.getByTestId("truck-photo").boundingBox())!;
  const apart =
    plate.x + plate.width <= photo.x ||
    photo.x + photo.width <= plate.x ||
    plate.y + plate.height <= photo.y ||
    photo.y + photo.height <= plate.y;
  expect(apart, `${name}: the photo does not cover the plate`).toBe(true);
}

async function ticketPictures(phone: Page) {
  for (const code of ["en", "hi"] as const) {
    if (code === "hi") await language(phone, "हिंदी");
    await expect(phone.locator("html")).toHaveAttribute("lang", code);
    await noSidewaysScroll(phone, `ticket ${code}`);
    await noOverlap(phone, `ticket ${code}`);
    await picture(phone, `ticket-phone-${code}`, true);

    // What goes to paper: A4 at the screen's 96 dots an inch.
    await phone.setViewportSize({ width: 794, height: 1123 });
    await phone.emulateMedia({ media: "print" });
    await expect(phone.getByRole("button", { name: /^(Print|प्रिंट करें)$/ })).toBeHidden();
    await expect(phone.getByRole("group", { name: /Language|भाषा/ })).toBeHidden();
    await expect(phone.getByTestId("public-timeline")).toBeVisible();
    await noSidewaysScroll(phone, `ticket print ${code}`);
    await picture(phone, `ticket-print-${code}`, true);
    await phone.emulateMedia({ media: "screen" });
    await phone.setViewportSize(PHONE);
  }
  await language(phone, "English");
}

test("the slip's QR code opens the ticket page, which follows the truck", async ({
  page,
  browser,
}) => {
  await office.pick(PLATE, "sand");
  await openKiosk(page);
  await expect(page.getByTestId("demo-badge")).toHaveText("DEMO");
  await arrive(page, bridge, LOADED_KG);
  await confirmLoaded(page, "MP 09 JK 7890");
  await uploadFromPhone(browser, page, "sand.jpg");
  await press(page, "Next");
  await answerQuestions(page, "Sand", DRIVER_PHONE);
  await press(page, "Next");
  await confirmWeight(page, "32,500 kg");
  await heading(page, "Go to CH-012+300");

  const qr = page.getByTestId("slip-qr");
  await expect(qr).toHaveAttribute("data-url", /\/t\/[0-9a-f]{32}$/);
  const address = new URL((await qr.getAttribute("data-url"))!);
  await leave(page, bridge);

  const { context, phone } = await strangerPhone(browser);
  // The same page whatever address the QR code was made with.
  await phone.goto(address.pathname);
  const status = phone.getByTestId("ticket-status");
  const timeline = phone.getByTestId("public-timeline");
  await expect(status).toHaveText("Waiting for the supervisor");
  await expect(phone.getByTestId("plate")).toHaveText("MP 09 JK 7890");
  await expect(phone.locator("main")).toContainText("32,500 kg");
  await expect(phone.locator("main")).toContainText("20,000 kg");
  for (const step of ["Truck arrived", "Number plate read", "Bill read", "First weight"]) {
    await expect(timeline).toContainText(step);
  }
  await expect(phone.getByTestId("truck-photo")).toBeVisible();
  await expect(phone.getByText("This visit is still going on.")).toBeVisible();
  // No driver's or supervisor's phone number, and no other picture than the truck's.
  const text = await phone.locator("body").innerText();
  expect(text).not.toContain(DRIVER_PHONE);
  expect(text).not.toMatch(/98765432\d\d/);
  await expect(phone.locator("main img")).toHaveCount(1);

  // The supervisor approves: the open page changes without being reloaded.
  await office.supervisorDecides(PLATE, PLATE, { decision: "APPROVE" });
  await expect(timeline).toContainText("Verified by the supervisor", { timeout: 15_000 });
  await expect(timeline).toContainText("Pankaj Gupta · Supervisor");
  await expect(status).toHaveText("Second weight due");

  // The truck comes back for its second weighing.
  await arrive(page, bridge, EMPTY_KG);
  await confirmPlate(page, "MP 09 JK 7890");
  await press(page, "Second weight");
  await confirmWeight(page, "12,500 kg");
  await heading(page, "Thank you, drive safely");

  await expect(status).toHaveText("Completed", { timeout: 15_000 });
  await expect(timeline).toContainText("Second weight · 12,500 kg");
  await expect(phone.locator("main")).toContainText("20,000 kg");
  await expect(phone.getByText("This visit is still going on.")).toHaveCount(0);

  await phone.evaluate(() => {
    const counter = window as unknown as { printed: number };
    counter.printed = 0;
    window.print = () => void (counter.printed += 1);
  });
  await phone.getByRole("button", { name: "Print" }).click();
  expect(await phone.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await ticketPictures(phone);
  await context.close();
});

const settingsOf = async (context: BrowserContext) =>
  (await (await context.request.get(`${WEB_URL}/api/demo/settings`)).json()) as DemoSettings;

test("demo settings: the store officer's login, and the DEMO badge everywhere", async ({
  page,
  browser,
}) => {
  await office.allReal();

  // A supervisor's login does not open them, nor does the server answer it.
  const supervisor = await browser.newContext({ viewport: PHONE });
  await signIn(supervisor, "amit");
  expect((await supervisor.request.get(`${WEB_URL}/api/demo/settings`)).status()).toBe(403);
  const supervisorPage = await supervisor.newPage();
  await supervisorPage.goto("/supervisor");
  await expect(supervisorPage.getByTestId("connection")).toHaveText("Online");
  const other = await supervisor.newPage();
  await other.goto("/settings");
  await expect(other).toHaveURL(/\/store\/login\?next=%2Fsettings$/);
  await other.close();

  // Nobody logged in: the store officer's login, and back to the settings.
  await page.setViewportSize(LAPTOP);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/store\/login\?next=%2Fsettings$/);
  await page.getByLabel("Username").fill("ram");
  for (const digit of "2001") {
    await page
      .getByRole("group", { name: "Number pad" })
      .getByRole("button", { name: digit, exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(`${WEB_URL}/settings`);
  await expect(page.getByRole("heading", { level: 1, name: "Demo settings" })).toBeVisible();
  await expect(page.getByText("Everything is real.")).toBeVisible();
  await expect(page.getByTestId("meter-plate-recognizer")).toContainText("of 2500");
  await expect(page.getByTestId("meter-gemini")).toContainText("of 200");
  await expect(page.getByTestId("device-main")).toContainText("Online");
  await expect(page.getByTestId("device-front")).toContainText("Online");
  await expect(page.locator("main")).toContainText("Weight tolerance: 0.5%");
  await expect(page.locator("main")).toContainText("Above 1,000 kg: Type 2 (store)");
  await expect(page.locator("main")).toContainText("Suresh Yadav");
  await expect(page.getByTestId("demo-badge")).toHaveCount(0);

  const kiosk = await browser.newContext({ viewport: LAPTOP });
  await signIn(kiosk, "wb01");
  const kioskPage = await kiosk.newPage();
  await kioskPage.goto("/kiosk");
  await expect(kioskPage.getByTestId("connection")).toHaveText("Online");
  const store = await page.context().newPage();
  await store.goto("/store");
  await expect(store.getByTestId("connection")).toHaveText("Online");
  const screens = [kioskPage, supervisorPage, store];
  for (const screen of screens) await expect(screen.getByTestId("demo-badge")).toHaveCount(0);

  // Each switch by itself shows the badge on every open screen, without a reload.
  const group = (name: string) => page.getByRole("group", { name, exact: true });
  for (const [name, key] of [
    ["Kiosk plate reading", "anprMode"],
    ["Supervisor plate check", "supervisorMode"],
    ["Bill reading", "ocrMode"],
  ] as const) {
    await group(name).getByRole("button", { name: "Pick" }).click();
    await expect(group(name).getByRole("button", { name: "Pick" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const screen of [page, ...screens]) {
      await expect(screen.getByTestId("demo-badge"), name).toHaveText("DEMO");
    }
    const saved = await settingsOf(page.context());
    expect(saved[key]).toBe("pick");
    // The other two switches are left as they were.
    expect(Object.values(saved).filter((value) => value === "pick")).toHaveLength(1);

    await group(name).getByRole("button", { name: "Real" }).click();
    for (const screen of [page, ...screens]) {
      await expect(screen.getByTestId("demo-badge"), name).toHaveCount(0);
    }
  }

  await page.getByLabel("Picked sample bill").selectOption("bricks");
  await expect.poll(async () => (await settingsOf(page.context())).demoInvoice).toBe("bricks");

  // Pictures with a switch on, so the badge is in them. The messages are gone first.
  await group("Bill reading").getByRole("button", { name: "Pick" }).click();
  await expect(page.getByTestId("demo-badge")).toHaveText("DEMO");
  await expect(page.getByText("Saved", { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await lookAt(page, "settings", { folder: SHOTS ? FOLDER : null, back: LAPTOP });

  await supervisorPage.setViewportSize(PHONE);
  await noSidewaysScroll(supervisorPage, "supervisor with the badge");
  await picture(supervisorPage, "badge-supervisor-phone");
  await picture(kioskPage, "badge-kiosk");

  await supervisor.close();
  await kiosk.close();
  await office.allReal();
});

test("reset demo data: only after typing RESET", async ({ page }) => {
  await office.pick(PLATE, "cement");
  const id = await office.weighType1(bridge, "MH14CD5678");
  await signIn(page.context(), "ram");
  await page.setViewportSize(LAPTOP);
  await page.goto("/settings");
  const ticket = (await (
    await page.context().request.get(`${WEB_URL}/api/tickets/${id}`)
  ).json()) as TicketView;
  expect(ticket.isDemo).toBe(true);

  const open = page.locator("main").getByRole("button", { name: "Reset demo data" });
  await open.click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Delete demo tickets" });
  const field = dialog.getByLabel("Type RESET to confirm");
  await expect(confirm).toBeDisabled();
  for (const wrong of ["reset", "RESE", "RESET!"]) {
    await field.fill(wrong);
    await expect(confirm, wrong).toBeDisabled();
  }
  await field.fill("RESET");
  await picture(page, "settings-reset-dialog");

  // Cancel forgets the word and deletes nothing.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await page.context().request.get(`${WEB_URL}/api/tickets/${id}`)).status()).toBe(200);
  await open.click();
  await expect(field).toHaveValue("");
  await field.fill("RESET");
  await confirm.click();

  await expect(page.getByText(/^Demo tickets deleted: [1-9]/).first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect((await page.context().request.get(`${WEB_URL}/api/tickets/${id}`)).status()).toBe(404);
  // The users and the rules are still there.
  await expect(page.locator("main")).toContainText("Suresh Yadav");
  const me = await page.context().request.get(`${WEB_URL}/api/auth/me`);
  expect(me.ok()).toBe(true);
  await page.goto(`/t/${ticket.publicToken}`);
  await expect(page.getByRole("heading", { name: "Ticket not found" })).toBeVisible();
});
