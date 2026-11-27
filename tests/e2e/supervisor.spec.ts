// Phase 12: the supervisor's phone. A Type 1 truck weighed at the real weighbridge screen
// appears on the phone by itself, is checked with a live photo (a pretend camera stream
// showing a number plate), and the approval moves the weighbridge to the second weight.
// Plates come from the demo "pick" mode, so no outside service is used.
//
// Set PHASE12_SHOTS=1 to save the pictures in docs/screenshots/phase12.
//
// IT RUNS "RESET DEMO DATA" FIRST: demo tickets in the development database are deleted.
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { SEED_USERS } from "@trinetra/shared/seed";
import {
  answerQuestions,
  arrive,
  confirmPlate,
  confirmWeight,
  heading,
  leave,
  Office,
  openKiosk,
  press,
  uploadFromPhone,
  Weighbridge,
} from "./kiosk-world";
import { WEB_URL } from "./playwright.config";
import { signIn } from "./staff-session";

const SHOTS = process.env.PHASE12_SHOTS === "1";
const file = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const SHOT_FOLDER = file("docs/screenshots/phase12/");

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1366, height: 768 };
const PIN = SEED_USERS.find((user) => user.username === "amit")!.pin;

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

/** A camera for a computer that has none: a stream that keeps showing a truck's plate. */
async function pretendCamera(page: Page) {
  const picture = await readFile(file("scripts/sample-plates/match-front.jpg"));
  await page.addInitScript(
    (url) => {
      const state = window as unknown as { cameraAsked: MediaStreamConstraints[] };
      state.cameraAsked = [];
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        state.cameraAsked.push(constraints!);
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = 1200;
        const draw = () => canvas.getContext("2d")!.drawImage(image, 0, 0, 1600, 1200);
        draw();
        // A stream has a new picture only when the canvas is drawn on.
        setInterval(draw, 100);
        return canvas.captureStream(10);
      };
    },
    `data:image/jpeg;base64,${picture.toString("base64")}`,
  );
}

/** Counts the vibrations: a test phone cannot be felt. */
async function countVibrations(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { buzzed: number };
    state.buzzed = 0;
    navigator.vibrate = () => {
      state.buzzed += 1;
      return true;
    };
  });
}

const vibrations = (page: Page) =>
  page.evaluate(() => (window as unknown as { buzzed: number }).buzzed);

async function openPhone(browser: Browser): Promise<{ phone: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: PHONE, hasTouch: true });
  const phone = await context.newPage();
  await pretendCamera(phone);
  await countVibrations(phone);
  return { phone, context };
}

async function signedInPhone(browser: Browser) {
  const opened = await openPhone(browser);
  await signIn(opened.context, "amit");
  return opened;
}

const tabs = (page: Page) => page.getByRole("navigation", { name: "Main pages" });

const online = (page: Page) => expect(page.getByTestId("connection")).toHaveText("Online");

const noSidewaysScroll = async (page: Page, name: string) => {
  const extra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(extra, `${name}: nothing scrolls sideways`).toBeLessThanOrEqual(0);
};

/** Every button and tab on the phone can be hit with a thumb. */
async function bigEnough(page: Page, name: string) {
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "main button, main a[data-slot='button'], main label.cursor-pointer",
      ),
    ]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.height < 47.5;
      })
      .map(
        (element) => `${element.textContent?.trim()} (${element.getBoundingClientRect().height})`,
      ),
  );
  expect(small, `${name}: buttons are at least 48 px tall`).toEqual([]);
}

/** The screen on a phone and a laptop, in English and Hindi, without leaving its state. */
async function look(page: Page, name: string) {
  await noSidewaysScroll(page, name);
  await bigEnough(page, name);
  if (!SHOTS) return;
  await mkdir(SHOT_FOLDER, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const shoot = async (language: "en" | "hi") => {
    for (const [device, size] of [
      ["laptop", LAPTOP],
      ["mobile", PHONE],
    ] as const) {
      await page.setViewportSize(size);
      // A tall phone picture of the whole page, with the bottom tabs at the bottom.
      if (device === "mobile") {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() =>
        [...document.images].every((image) => image.complete && image.naturalWidth > 0),
      );
      await noSidewaysScroll(page, `${name} ${language} ${device}`);
      await page.screenshot({
        path: `${SHOT_FOLDER}${name}-${device}-${language}.png`,
        animations: "disabled",
        // Messages that fade away are not part of the screen.
        style: "ol[tabindex='-1']{visibility:hidden!important}",
      });
    }
  };
  /** The language switch is in the sidebar (laptop) and under the login card. */
  const choose = async (language: string) => {
    await page.setViewportSize(LAPTOP);
    await page.getByRole("button", { name: language, exact: true }).first().click();
  };
  await shoot("en");
  await choose("हिंदी");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await shoot("hi");
  await choose("English");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.setViewportSize(PHONE);
}

async function takePhoto(phone: Page) {
  await expect(phone.getByTestId("camera-video")).toBeVisible();
  await phone.getByRole("button", { name: "Take photo" }).click();
  await expect(phone.getByTestId("preview")).toBeVisible();
  await phone.getByRole("button", { name: "Use this photo" }).click();
}

const result = (phone: Page, name: string) =>
  expect(phone.getByTestId("result")).toHaveAttribute("data-result", name);

const outcome = (phone: Page, name: string) =>
  expect(phone.getByTestId("outcome")).toHaveAttribute("data-outcome", name);

test("a Type 1 truck: from the weighbridge to the phone and back", async ({ page, browser }) => {
  await office.pick("MH12AB1234", "cement");

  // The supervisor logs in on their phone.
  const { phone, context } = await openPhone(browser);
  await phone.goto("/supervisor");
  await expect(phone).toHaveURL(`${WEB_URL}/supervisor/login`);
  await look(phone, "01-login");
  await phone.getByLabel("Username").fill("amit");
  const pad = phone.getByRole("group", { name: "Number pad" });
  for (const digit of PIN) await pad.getByRole("button", { name: digit, exact: true }).click();
  await phone.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(phone).toHaveURL(`${WEB_URL}/supervisor`);
  await online(phone);
  await expect(phone.getByText("No truck is waiting")).toBeVisible();
  await expect(phone).toHaveTitle("Trinetra");
  // The first tap turns the sound on.
  await phone.getByRole("heading", { name: "Next truck" }).click();
  await expect(phone.getByText("Tap the screen once")).toHaveCount(0);

  // The driver, at the real weighbridge screen.
  await openKiosk(page);
  await arrive(page, bridge, 32_560);
  await confirmPlate(page, "MH 12 AB 1234");
  await uploadFromPhone(browser, page, "cement.jpg");
  await press(page, "Next");
  await answerQuestions(page, "Cement Bags", "9000000002");
  await press(page, "Next");
  await confirmWeight(page, "32,560 kg");
  await heading(page, "Go to Plant");

  // The phone, untouched: the truck is there, with a message, a buzz and the tab's number.
  const next = phone.getByTestId("next-truck");
  await expect(next).toContainText("MH 12 AB 1234", { timeout: 5000 });
  await expect(phone.getByText("New truck: MH 12 AB 1234").first()).toBeVisible();
  await expect(phone).toHaveTitle("(1) Trinetra");
  expect(await vibrations(phone)).toBe(1);
  await expect(phone.getByTestId("kpi").filter({ hasText: "Waiting for verify" })).toContainText(
    "1",
  );
  await look(phone, "02-home");

  await tabs(phone).getByRole("link", { name: "My trucks" }).click();
  await expect(phone.getByRole("table")).toContainText("MH 12 AB 1234");
  await expect(phone.getByRole("table")).toContainText("0 min");
  // The title stays after moving to another page.
  await expect(phone).toHaveTitle("(1) Trinetra");
  await look(phone, "03-trucks");

  // The driver comes back before the check: the weighbridge waits.
  await leave(page, bridge);
  await arrive(page, bridge, 18_250);
  await confirmPlate(page, "MH 12 AB 1234");
  await expect(page.getByText("Waiting for supervisor approval")).toBeVisible();

  await phone.getByRole("link", { name: "Verify" }).click();
  await expect(phone.getByTestId("plate").first()).toHaveText("MH 12 AB 1234");
  await expect(phone.locator("main")).toContainText("32,560 kg");
  await expect(phone.getByTestId("camera-video")).toBeVisible();
  const asked = await phone.evaluate(
    () => (window as unknown as { cameraAsked: MediaStreamConstraints[] }).cameraAsked,
  );
  expect(asked.at(-1)).toMatchObject({ video: { facingMode: { ideal: "environment" } } });
  // No way to choose a picture from the gallery.
  await expect(phone.locator("input[type=file]")).toHaveCount(0);
  await expect(phone.getByRole("button", { name: "Take photo" })).toBeEnabled();
  await look(phone, "04-verify-camera");

  const upload = phone.waitForRequest((request) => request.url().endsWith("/photo"));
  await takePhoto(phone);
  const sent = await upload;
  expect(sent.headers()["idempotency-key"]).toBeTruthy();
  await result(phone, "MATCH");
  await expect(phone.getByText("Plate matches").first()).toBeVisible();
  await look(phone, "05-verify-match");

  // Approve, tapped twice. The weighbridge moves on by itself.
  const decisions: string[] = [];
  phone.on("request", (request) => {
    if (request.url().includes("/decide")) decisions.push(request.url());
  });
  const approve = phone.getByRole("button", { name: "Approve", exact: true });
  const pressedAt = Date.now();
  await approve.dblclick();
  await expect(page.getByText("Approved. You can take the second weight.")).toBeVisible();
  const reaction = Date.now() - pressedAt;
  console.log(`  the weighbridge showed the approval ${reaction} ms after the tap`);
  expect(reaction, "the build plan asks for under 1 second").toBeLessThan(1500);
  await outcome(phone, "approved");
  expect(decisions).toHaveLength(1);
  await expect(phone).toHaveTitle("Trinetra");

  await press(page, "Second weight");
  await confirmWeight(page, "18,250 kg");
  await heading(page, "Thank you, drive safely");

  // Done today, and the two photos side by side.
  await tabs(phone).getByRole("link", { name: "Done" }).click();
  const item = phone.getByRole("list", { name: "Done today" }).getByRole("link");
  await expect(item).toContainText("MH 12 AB 1234");
  await expect(item).toContainText("Verified");
  await expect(item.locator("img")).toBeVisible();
  await look(phone, "10-done");
  await item.click();
  await expect(phone.getByRole("img", { name: "At the weighbridge" })).toBeVisible();
  await expect(phone.getByRole("img", { name: "My photo" })).toBeVisible();
  await look(phone, "11-done-detail");
  await context.close();
});

test("one letter different, a wrong truck, and a rejection", async ({ browser }) => {
  // The ticket's plate is one letter from the one the photo will "read".
  const close = await office.weighType1(bridge, "MH12AB1235");
  const wrong = await office.weighType1(bridge, "UP32EF9012");
  await office.demo("put", "settings", { anprMode: "pick", demoPlate: "MH12AB1234" });
  const { phone, context } = await signedInPhone(browser);

  await phone.goto(`/supervisor/verify/${close}`);
  await takePhoto(phone);
  await result(phone, "CLOSE");
  await expect(phone.getByText("Almost matches, check with your eyes")).toBeVisible();
  await look(phone, "06-verify-close");
  await phone.getByRole("button", { name: "Approve", exact: true }).click();
  await outcome(phone, "approved");

  await phone.goto(`/supervisor/verify/${wrong}`);
  await takePhoto(phone);
  await result(phone, "NO_MATCH");
  const anyway = phone.getByRole("button", { name: "Approve anyway" });
  await expect(anyway).toBeDisabled();
  const reason = phone.getByLabel(/To approve, type why/);
  await reason.fill("too short");
  await expect(anyway).toBeDisabled();
  await look(phone, "07-verify-no-match");
  await reason.fill("Plate is bent but it is this truck");
  await expect(anyway).toBeEnabled();

  // Rejecting needs a reason.
  await phone.getByRole("button", { name: "Reject", exact: true }).click();
  const confirm = phone.getByRole("button", { name: "Reject truck" });
  await expect(confirm).toBeDisabled();
  await phone.getByRole("button", { name: "Other" }).click();
  await expect(confirm).toBeDisabled();
  await phone.getByRole("button", { name: "Wrong truck" }).click();
  await look(phone, "07-verify-reject");
  await confirm.click();
  await outcome(phone, "rejected");

  await phone.goto(`/supervisor/done/${wrong}`);
  await expect(phone.locator("main")).toContainText("Wrong truck");
  await expect(phone.locator("main")).toContainText("Rejected");
  await context.close();
});

test("a plate that could not be read: a manual check", async ({ browser }) => {
  const id = await office.weighType1(bridge, "MH14CD5678");
  await office.demo("put", "settings", { anprMode: "pick", demoPlate: "MH14CD5678" });
  const { phone, context } = await signedInPhone(browser);
  // Demo mode always reads a plate, so "not read" is put into the backend's answer. (The
  // backend's own handling of an unread photo is in its API tests.)
  await phone.route(`**/api/tickets/${id}`, async (route) => {
    const real = await route.fetch();
    const body = await real.json();
    for (const approval of body.approvals ?? []) {
      if (approval.matchResult)
        Object.assign(approval, { matchResult: "NOT_READ", plateRead: null });
    }
    await route.fulfill({ response: real, json: body });
  });
  let decision: unknown;
  await phone.route("**/decide", async (route) => {
    decision = route.request().postDataJSON();
    await route.fulfill({ json: { approval: {}, ticket: null } });
  });

  await phone.goto(`/supervisor/verify/${id}`);
  await takePhoto(phone);
  await result(phone, "NOT_READ");
  await expect(phone.getByText("Could not read")).toBeVisible();
  await look(phone, "08-verify-not-read");
  await phone.getByRole("button", { name: "Manual check" }).click();
  const send = phone.getByRole("button", { name: "Approve (manual check)" });
  await expect(send).toBeDisabled();
  await phone.getByLabel("Type the plate you see on the truck").fill("MH 14 CD 5679");
  await expect(phone.getByText("That is not this ticket's plate.")).toBeVisible();
  await phone.getByLabel("Type the plate you see on the truck").fill("mh 14 cd 5678");
  await phone.getByLabel(/To approve, type why/).fill("Mud on the plate, read by eye");
  await expect(send).toBeEnabled();
  await look(phone, "09-verify-manual");
  await send.click();
  await outcome(phone, "approved");
  expect(decision).toEqual({
    decision: "APPROVE",
    manualCheck: true,
    note: "Mud on the plate, read by eye",
    seenPlate: "mh 14 cd 5678",
  });
  await context.close();
});

test("lost network, a decision made elsewhere, and logging in again", async ({ browser }) => {
  const id = await office.weighType1(bridge, "UP70GH3456");
  await office.demo("put", "settings", { anprMode: "pick", demoPlate: "UP70GH3456" });
  const { phone, context } = await signedInPhone(browser);
  await phone.goto(`/supervisor/verify/${id}`);
  await online(phone);

  // The upload fails: the photo stays, with "Try again". Nothing is sent later by itself.
  let blocked = true;
  const keys: string[] = [];
  await phone.route("**/photo", (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    return blocked ? route.abort() : route.continue();
  });
  await takePhoto(phone);
  await expect(phone.getByRole("alert").first()).toContainText("Cannot reach the server");
  await expect(phone.getByTestId("preview")).toBeVisible();
  blocked = false;
  await phone.getByRole("button", { name: "Try again" }).click();
  await result(phone, "MATCH");
  // The same photo, so the same key: it could never count twice.
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);

  // Decided somewhere else while this page still shows the buttons.
  await phone.route("**/api/tickets/*", async (route) => {
    // The page does not hear of it before the tap.
    const real = await route.fetch();
    const body = await real.json();
    body.status = "SUPERVISOR_PENDING";
    await route.fulfill({ response: real, json: body });
  });
  await office.supervisorDecides("UP70GH3456", "UP70GH3456", { decision: "APPROVE" });
  await phone.getByRole("button", { name: "Approve", exact: true }).click();
  await outcome(phone, "taken");
  await expect(phone.getByText("Already done by someone else.")).toBeVisible();
  await expect(phone).toHaveURL(`${WEB_URL}/supervisor/trucks`);

  // The decision arrives but its answer is lost: the page must not blame someone else.
  const own = await office.weighType1(bridge, "BR06QR4321");
  await office.demo("put", "settings", { demoPlate: "BR06QR4321" });
  await phone.unrouteAll({ behavior: "wait" });
  await phone.goto(`/supervisor/verify/${own}`);
  await takePhoto(phone);
  await result(phone, "MATCH");
  await phone.route("**/decide", async (route) => {
    await route.fetch();
    await route.abort();
  });
  await phone.getByRole("button", { name: "Approve", exact: true }).click();
  await outcome(phone, "approved");

  // The login ends: after logging in again, the same page comes back.
  await context.clearCookies();
  await phone.goto(`/supervisor/done/${id}`);
  await expect(phone).toHaveURL(/\/supervisor\/login\?next=/);
  await phone.getByLabel("Username").fill("amit");
  const pad = phone.getByRole("group", { name: "Number pad" });
  for (const digit of PIN) await pad.getByRole("button", { name: digit, exact: true }).click();
  await phone.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(phone).toHaveURL(`${WEB_URL}/supervisor/done/${id}`);
  await context.close();
});

test("another supervisor sees nothing of it", async ({ browser }) => {
  const id = await office.weighType1(bridge, "RJ14LM2345");
  const context = await browser.newContext({ viewport: PHONE });
  await signIn(context, "ravi");
  const phone = await context.newPage();
  await phone.goto("/supervisor/trucks");
  await expect(phone.getByText("No truck is waiting")).toBeVisible();
  await phone.goto(`/supervisor/verify/${id}`);
  await expect(phone.getByText("This truck was not sent to your unloading point.")).toBeVisible();
  expect((await context.request.get(`${WEB_URL}/api/tickets/${id}`)).status()).toBe(403);
  await context.close();
});

test("a camera that is refused, and a page that cannot open one", async ({ browser }) => {
  const id = await office.weighType1(bridge, "DL01NP6789");
  await office.demo("put", "settings", { anprMode: "pick", demoPlate: "DL01NP6789" });

  const denied = await browser.newContext({ viewport: PHONE });
  await signIn(denied, "amit");
  const first = await denied.newPage();
  await first.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("no", "NotAllowedError"));
  });
  await first.goto(`/supervisor/verify/${id}`);
  await expect(first.getByTestId("camera-problem")).toContainText("Please allow it");
  await expect(first.getByTestId("camera-problem").getByRole("listitem")).toHaveCount(3);
  await expect(first.locator("input[type=file]")).toHaveCount(0);
  await look(first, "12-camera-denied");
  await denied.close();

  const without = await browser.newContext({ viewport: PHONE });
  await signIn(without, "amit");
  const phone = await without.newPage();
  await phone.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined });
  });
  await phone.goto(`/supervisor/verify/${id}`);
  const input = phone.getByTestId("camera-input");
  await expect(input).toHaveAttribute("capture", "environment");
  await expect(input).toHaveAttribute("accept", "image/*");
  await input.setInputFiles(file("scripts/sample-plates/match-front.jpg"));
  await phone.getByRole("button", { name: "Use this photo" }).click();
  await result(phone, "MATCH");
  const ticket = await (await without.request.get(`${WEB_URL}/api/tickets/${id}`)).json();
  expect(ticket.approvals.at(-1)).toMatchObject({ captureSource: "fallback" });
  await without.close();
});
