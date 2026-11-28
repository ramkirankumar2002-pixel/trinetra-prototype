// One regression test for each issue of docs/MANUAL_CHECK.md that was fixed. One truck is
// driven through all of it: "No phone?", the questions, the supervisor's check on a
// phone, and the store officer's History.
//
// IT RUNS "RESET DEMO DATA" FIRST: demo tickets in the development database are deleted.
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  arrive,
  confirmPlate,
  heading,
  leave,
  Office,
  openKiosk,
  press,
  sampleInvoice,
  typeDigits,
  Weighbridge,
} from "./kiosk-world";
import { WEB_URL } from "./playwright.config";
import { LAPTOP, PHONE } from "./staff-look";
import { signIn } from "./staff-session";

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
  await office?.allReal();
  await office?.reset();
  await office?.dispose();
});

/** How many lines the words of a button take. */
const linesOf = (button: Locator) =>
  button.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const tops: number[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) tops.push(box.top);
    }
    tops.sort((a, b) => a - b);
    return tops.filter((top, index) => index === 0 || top - tops[index - 1]! > 8).length;
  });

async function onOneLine(...buttons: Locator[]) {
  for (const button of buttons) {
    await expect(button).toBeVisible();
    expect(await linesOf(button), `"${await button.innerText()}" stays on one line`).toBe(1);
  }
}

const button = (page: Page, name: string | RegExp) =>
  page.getByRole("button", typeof name === "string" ? { name, exact: true } : { name });

const kioskLanguage = (page: Page, name: "हिंदी" | "English") =>
  page.locator("aside").getByRole("button", { name }).click();

test("the issues of the manual-style check stay fixed", async ({ page, browser }) => {
  await office.pick("RJ14LM2345", "steel-bars");

  const storeContext = await browser.newContext({ viewport: LAPTOP });
  await signIn(storeContext, "ram");
  const store = await storeContext.newPage();
  await store.goto("/store/approvals");
  await expect(store.getByTestId("connection")).toHaveText("Online");

  await openKiosk(page);
  await arrive(page, bridge, 32_560);
  await confirmPlate(page, "RJ 14 LM 2345");

  // Issue 7: the store officer's list says that a bill is needed.
  await press(page, "No phone?");
  const row = store.getByRole("table").getByRole("row").filter({ hasText: "RJ 14 LM 2345" });
  await expect(row).toContainText("No phone: send bill");
  await row.getByRole("link", { name: /^Open/ }).click();

  // The very first press on the store officer's home, opened afresh: the page still asks
  // to be tapped for its sound, and the button pressed must be the one that is opened.
  const home = await storeContext.newPage();
  await home.goto("/store");
  await expect(home.getByTestId("connection")).toHaveText("Online");
  await expect(home.getByText("Tap the screen once")).toBeVisible();
  // This truck's own request, whatever else is waiting.
  const mine = home
    .getByRole("table")
    .getByRole("row")
    .filter({ hasText: "RJ 14 LM 2345" })
    .getByRole("link", { name: /^Open/ });
  const address = (await mine.getAttribute("href"))!;
  expect(address).toMatch(/^\/store\/approvals\/\d+$/);
  await mine.click();
  await expect(home).toHaveURL(`${WEB_URL}${address}`);
  await home.close();

  // Issue 5: "Cancel visit" is not a second red button, and says what it is.
  const cancel = button(store, "Cancel visit");
  await expect(cancel).toHaveAttribute("data-variant", "outline");
  await expect(store.getByTestId("cancel-hint")).toContainText("It is not a rejection");

  // Issues 9 and 10: at 1366×768 the bill can be sent without scrolling, on one line each.
  await onOneLine(button(store, "Take photo"), store.locator("label", { hasText: "Choose file" }));
  await store.getByTestId("bill-file").setInputFiles(sampleInvoice("steel-bars.pdf"));
  const send = button(store, "Send the bill");
  await store.getByTestId("bill-file").waitFor({ state: "detached" });
  await onOneLine(send, button(store, "Choose another"));
  await store.getByTestId("upload-bill").evaluate(() => window.scrollTo(0, 0));
  await expect(send).toBeInViewport({ ratio: 1 });
  // And with a photo, whose preview is the tall one.
  await button(store, "Choose another").click();
  await store.getByTestId("bill-file").setInputFiles(sampleInvoice("steel-bars.jpg"));
  await expect(store.getByTestId("bill-preview")).toBeVisible();
  await expect
    .poll(() => store.getByTestId("bill-preview").evaluate((e: HTMLImageElement) => e.complete))
    .toBe(true);
  await store.evaluate(() => window.scrollTo(0, 0));
  await expect(send).toBeInViewport({ ratio: 1 });
  await expect(button(store, "Choose another")).toBeInViewport({ ratio: 1 });
  await send.click();
  await expect(store.getByTestId("outcome")).toHaveAttribute("data-outcome", "uploaded");

  // Issue 12: the bill's date is written like every other date.
  await expect(page.getByText("Your invoice has been read.")).toBeVisible();
  await expect(page.locator("main")).toContainText("26 Nov 2026");
  await expect(page.locator("main")).not.toContainText("2026-11-26");

  // Issue 4: switching language is not one of the driver's answers.
  await kioskLanguage(page, "हिंदी");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await kioskLanguage(page, "English");
  await press(page, "Next");
  await heading(page, "Material");
  await press(page, "Steel Bars");
  await heading(page, "Supplier");
  await press(page, "Yes");
  await heading(page, "Transporter");
  await press(page, "Yes");
  await heading(page, "Phone number");
  await typeDigits(page, "9000000007");
  await press(page, "Next");
  await heading(page, "Your name");
  await press(page, "Skip");
  await heading(page, "Check");

  // Issue 14: a skipped name is said in words, in both languages.
  const name = page.getByRole("button", { name: /^Name/ });
  await expect(name).toContainText("Not given");
  await expect(name).not.toContainText("———");
  await kioskLanguage(page, "हिंदी");
  await expect(page.getByRole("button", { name: /^नाम/ })).toContainText("नहीं बताया");
  await kioskLanguage(page, "English");
  await press(page, "Next");

  // Issue 11: one question, asked once; and "Please stay still" once.
  const said = (words: string) => page.locator("body").getByText(words, { exact: true });
  await expect(page.getByTestId("ring")).toHaveAttribute("data-state", "filling");
  await expect(said("Please stay still")).toHaveCount(1);
  await expect(page.getByTestId("ring")).toHaveAttribute("data-state", "full");
  await expect(said("Is this weight right?")).toHaveCount(1);
  await press(page, "Next");
  await heading(page, "Go to CH-010+500");
  await leave(page, bridge);

  // While the supervisor has not answered, the store can cancel: with the same words.
  await store.goto("/store/trucks");
  const truck = store.getByRole("table").getByRole("row").filter({ hasText: "RJ 14 LM 2345" });
  await truck.getByRole("link", { name: /^View/ }).click();
  await expect(store.getByTestId("cancel-hint")).toBeVisible();

  // The supervisor, on a phone with no camera.
  const phoneContext = await browser.newContext({ viewport: PHONE, hasTouch: true });
  await phoneContext.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined });
  });
  await signIn(phoneContext, "vikram");
  const phone = await phoneContext.newPage();
  await phone.goto("/supervisor");
  await expect(phone.getByTestId("connection")).toHaveText("Online");
  // The very first tap on the page, while it still asks to be tapped for its sound: the
  // button under the finger must be the one that is pressed. Then the request is gone.
  await expect(phone.getByText("Tap the screen once")).toBeVisible();
  await phone.getByRole("link", { name: "Verify" }).tap();
  await expect(phone).toHaveURL(/\/supervisor\/verify\/\d+$/);
  await phone
    .getByTestId("camera-input")
    .setInputFiles(
      fileURLToPath(new URL("../../scripts/sample-plates/match-front.jpg", import.meta.url)),
    );
  await onOneLine(button(phone, "Use this photo"), button(phone, "Retake"));
  await button(phone, "Use this photo").click();

  // Issue 2: a demo reading says that the photo was not read.
  await expect(phone.getByTestId("demo-reading")).toContainText("your photo was not read");
  await expect(phone.getByTestId("result")).toContainText("Demo reading (not your photo)");
  await expect(phone.getByTestId("result")).not.toContainText("Read from your photo");
  await onOneLine(button(phone, "Retake (2 left)"), button(phone, "Reject"));
  await button(phone, "Approve").click();
  await expect(phone.getByTestId("outcome")).toHaveAttribute("data-outcome", "approved");
  await phone.goto("/supervisor/done");
  await expect(phone.getByRole("list", { name: "Done today" })).toContainText("demo reading");
  await phoneContext.close();

  await arrive(page, bridge, 18_250);
  await confirmPlate(page, "RJ 14 LM 2345");
  await press(page, "Second weight");
  await expect(page.getByTestId("ring")).toHaveAttribute("data-state", "full");
  await press(page, "Next");
  await heading(page, "Thank you, drive safely");

  // Issue 1: History says what the supervisor really answered.
  await store.goto("/store/history");
  const ended = store.getByRole("table").getByRole("row").filter({ hasText: "RJ 14 LM 2345" });
  await expect(ended).toContainText("Approved by supervisor: Vikram Sharma");
  await expect(ended).not.toContainText("Blocked");
  await store.getByRole("button", { name: "हिंदी" }).click();
  await expect(ended).toContainText("सुपरवाइज़र ने मंज़ूर किया");
  await expect(ended).not.toContainText("रोका");
  await store.getByRole("button", { name: "English" }).click();
  await ended.getByRole("link", { name: /^View/ }).click();
  await expect(store.getByTestId("who")).toContainText("Approved by supervisor: Vikram Sharma");
  await expect(store.getByTestId("who")).not.toContainText("Blocked");
  await expect(store.getByTestId("who")).toContainText("Driver help · Seen by store");

  // Issues 3 and 4: the timeline.
  const timeline = store.getByTestId("timeline");
  await expect(timeline).toContainText("Demo reading (photo not read): RJ 14 LM 2345");
  await expect(timeline).not.toContainText("your photo");
  await expect(timeline).toContainText("Driver has no phone: bill needed");
  const answers = timeline.locator('[data-event="DETAILS_SAVED"]');
  // Material, supplier, transporter and phone: no line for the two language switches.
  await expect(answers).toHaveCount(4);
  await expect(answers.nth(0)).toContainText("Material: Steel Bars");
  await expect(answers.nth(1)).toContainText("Supplier: Ganga Steel Traders");
  await expect(answers.nth(2)).toContainText("Transporter: Highway Carriers");
  await expect(answers.nth(3)).toContainText("Phone");
  await expect(timeline).not.toContainText("9000000007");

  // And the bill's date on the store's pages too (issue 12).
  await expect(store.getByTestId("bill-fields")).toContainText("26 Nov 2026");
  await storeContext.close();
});
