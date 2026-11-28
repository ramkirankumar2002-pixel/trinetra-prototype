// Everything around the weighbridge screen in the kiosk tests: the ESP32 simulator with
// both cameras, the demo "pick" modes (so no outside service is used), and the supervisor
// and store officer deciding through the API (their own pages have their own tests).
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import type { StoreRequestsResponse, SupervisorTicketView } from "@trinetra/shared";
import type { SampleInvoiceId } from "@trinetra/shared/seed";
import { SimDevice } from "../../scripts/sim/device";
import { WeightModel } from "../../scripts/sim/weight-model";
import { expectDriverRules, KIOSK_SIZES } from "./driver-rules";
import { WEB_URL } from "./playwright.config";
import { signIn } from "./staff-session";

const BACKEND = "http://localhost:4000";
const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

if (existsSync(root("apps/server/.env"))) process.loadEnvFile(root("apps/server/.env"));

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in apps/server/.env (see .env.example).`);
  return value;
}

/** Set PHASE10_SHOTS=1 to save the pictures in docs/screenshots/phase10. */
export const SHOTS = process.env.PHASE10_SHOTS === "1";
export const SHOT_FOLDER = root("docs/screenshots/phase10/");

export const sampleInvoice = (name: string) => root(`scripts/sample-invoices/${name}`);

export class Weighbridge {
  private readonly model = new WeightModel();
  private readonly devices: SimDevice[] = [];
  private sender: NodeJS.Timeout | undefined;

  start(): void {
    const url = `${BACKEND.replace("http", "ws")}/device`;
    const quiet = () => {};
    const main = new SimDevice({
      name: "main ESP32",
      url,
      token: setting("DEVICE_TOKEN"),
      log: quiet,
      onCommand: quiet,
    });
    const cameras = (["front", "back"] as const).map((camera) => {
      const token = setting(camera === "front" ? "CAM_FRONT_TOKEN" : "CAM_BACK_TOKEN");
      const device: SimDevice = new SimDevice({
        name: `${camera} camera`,
        url,
        token,
        log: quiet,
        onOpen: () => device.send({ t: "hello", cam: camera }),
        onCommand: (command) => {
          if (command.t !== "snap") return;
          void readFile(root(`scripts/sample-plates/match-${camera}.jpg`)).then((body) =>
            fetch(`${BACKEND}/api/device/photo/${String(command.id)}`, {
              method: "POST",
              headers: { "content-type": "image/jpeg", "x-device-token": token },
              body: new Uint8Array(body),
            }),
          );
        },
      });
      return device;
    });
    this.devices.push(main, ...cameras);
    this.devices.forEach((device) => device.connect());
    this.model.leave(performance.now() - 60_000);
    this.sender = setInterval(
      () => main.send({ t: "w", ...this.model.read(performance.now()) }),
      200,
    );
  }

  stop(): void {
    clearInterval(this.sender);
    this.devices.splice(0).forEach((device) => device.close());
  }

  driveOn(kg: number): void {
    this.model.arrive(kg, performance.now());
  }

  driveOff(): void {
    this.model.leave(performance.now());
    this.model.positionOk = true;
    if (this.model.unstable) this.model.toggleUnstable(performance.now());
  }

  position(ok: boolean): void {
    this.model.positionOk = ok;
  }

  wobble(on: boolean): void {
    if (this.model.unstable !== on) this.model.toggleUnstable(performance.now());
  }
}

/** The demo switches and the two people who decide. */
export class Office {
  private constructor(
    private readonly kiosk: APIRequestContext,
    private readonly store: APIRequestContext,
    private readonly supervisor: APIRequestContext,
    private readonly close: () => Promise<void>,
  ) {}

  static async open(browser: Browser): Promise<Office> {
    const contexts = await Promise.all(
      ["wb01", "ram", "amit"].map(async (username) => {
        const context = await browser.newContext();
        await signIn(context, username);
        return context;
      }),
    );
    const [kiosk, store, supervisor] = contexts.map((context) => context.request);
    return new Office(kiosk!, store!, supervisor!, async () => {
      await Promise.all(contexts.map((context) => context.close()));
    });
  }

  dispose(): Promise<void> {
    return this.close();
  }

  async demo(method: "put" | "post", path: string, data?: object): Promise<void> {
    const answer = await this.kiosk[method](`${WEB_URL}/api/demo/${path}`, {
      headers: { "x-admin-pin": setting("ADMIN_PIN") },
      ...(data ? { data } : {}),
    });
    expect(answer.ok(), await answer.text()).toBe(true);
  }

  async reset(): Promise<void> {
    await this.demo("put", "settings", { weightMode: "real" });
    await this.demo("post", "reset");
  }

  /** Every demo replacement off, as a test leaves the settings. */
  allReal(): Promise<void> {
    return this.demo("put", "settings", {
      anprMode: "real",
      supervisorMode: "real",
      ocrMode: "real",
    });
  }

  pick(plate: string, invoice: SampleInvoiceId): Promise<void> {
    return this.demo("put", "settings", {
      anprMode: "pick",
      supervisorMode: "pick",
      ocrMode: "pick",
      demoPlate: plate,
      demoInvoice: invoice,
    });
  }

  /**
   * A Type 1 truck (cement, which goes to Amit Kumar) with its first weight saved, made
   * through the kiosk's API and the simulated weighbridge. The truck then leaves.
   */
  async weighType1(bridge: Weighbridge, plate: string): Promise<number> {
    const started = await this.kiosk.post(`${WEB_URL}/api/tickets`, {
      data: { plate, language: "en", manual: true },
    });
    expect(started.ok(), await started.text()).toBe(true);
    const { ticket } = (await started.json()) as { ticket: { id: number } };
    const details = await this.kiosk.patch(`${WEB_URL}/api/tickets/${ticket.id}/details`, {
      data: { material: "Cement Bags" },
    });
    expect(details.ok(), await details.text()).toBe(true);
    bridge.driveOn(32_560);
    await expect
      .poll(
        async () =>
          (await this.kiosk.post(`${WEB_URL}/api/tickets/${ticket.id}/first-weight`)).status(),
        { timeout: 30_000, intervals: [1000] },
      )
      .toBe(200);
    bridge.driveOff();
    return ticket.id;
  }

  async storeDecides(plate: string, kind: string, decision: object): Promise<void> {
    let id: number | undefined;
    await expect
      .poll(async () => {
        const answer = await this.store.get(`${WEB_URL}/api/store/requests?status=pending`);
        const list = (await answer.json()) as StoreRequestsResponse;
        id = list.requests.find(
          (item) => item.ticket?.plate === plate && item.approval.kind === kind,
        )?.approval.id;
        return id;
      })
      .toBeDefined();
    const answer = await this.store.post(`${WEB_URL}/api/approvals/${id}/decide`, {
      data: decision,
    });
    expect(answer.ok(), await answer.text()).toBe(true);
  }

  /** The supervisor's live photo shows `seen`; then they decide. */
  async supervisorDecides(plate: string, seen: string, decision: object): Promise<void> {
    const list = await this.supervisor.get(`${WEB_URL}/api/supervisor/tickets?status=pending`);
    const { tickets } = (await list.json()) as { tickets: SupervisorTicketView[] };
    const truck = tickets.find((item) => item.plate === plate);
    expect(truck, `${plate} is on the supervisor's list`).toBeDefined();
    await this.demo("put", "settings", { supervisorMode: "pick", demoPlate: seen });
    const photo = await this.supervisor.post(
      `${WEB_URL}/api/supervisor/tickets/${truck!.ticketId}/photo`,
      {
        multipart: {
          file: {
            name: "photo.jpg",
            mimeType: "image/jpeg",
            buffer: await readFile(root("scripts/sample-plates/match-front.jpg")),
          },
        },
      },
    );
    expect(photo.ok(), await photo.text()).toBe(true);
    const answer = await this.supervisor.post(
      `${WEB_URL}/api/approvals/${truck!.approvalId}/decide`,
      { data: decision },
    );
    expect(answer.ok(), await answer.text()).toBe(true);
  }
}

// ---- The weighbridge screen ----

const rail = (page: Page) => page.locator("aside");

export async function openKiosk(page: Page): Promise<void> {
  // The print dialog cannot be answered by a test: count the calls instead.
  await page.addInitScript(() => {
    const counter = window as unknown as { printed: number };
    counter.printed = 0;
    window.print = () => void (counter.printed += 1);
  });
  await page.setViewportSize(KIOSK_SIZES[0]);
  await signIn(page.context(), "wb01");
  await page.goto("/kiosk");
  await expect(page.getByTestId("connection")).toHaveText("Online");
  await expect(page.getByTestId("weighbridge")).toHaveText("Weighbridge online");
}

export const printCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { printed: number }).printed);

export const heading = (page: Page, name: string | RegExp) =>
  expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

export const press = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).click();

async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  );
}

async function picture(page: Page, name: string) {
  if (!SHOTS) return;
  await mkdir(SHOT_FOLDER, { recursive: true });
  // The development tools are not part of the website.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({ path: `${SHOT_FOLDER}${name}.png`, animations: "disabled" });
}

/**
 * The driver rules at both kiosk sizes, in English and in Hindi, for the screen now shown;
 * and its picture at 1366×768 in both. Leaves the kiosk as it was: in English.
 */
export async function look(page: Page, name: string): Promise<void> {
  const shown = page.getByTestId("screen");
  const screen = (await shown.getAttribute("data-screen"))!;
  for (const language of ["en", "hi"] as const) {
    if (language === "hi") await rail(page).getByRole("button", { name: "हिंदी" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    for (const size of [...KIOSK_SIZES].reverse()) {
      await page.setViewportSize(size);
      await settled(page);
      await atScreen(`${name} (${language}, ${size.width}×${size.height})`, page, () =>
        expectDriverRules(page),
      );
      // The switch of language, and anything it saved, left the same screen.
      await expect(shown, name).toHaveAttribute("data-screen", screen);
    }
    await picture(page, `${name}-${language}`);
  }
  await rail(page).getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
}

/** Names the screen that broke a rule, and keeps its picture. */
async function atScreen(title: string, page: Page, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    await page.screenshot({ path: "test-results/broken-screen.png" });
    (error as Error).message = `${title}\n${(error as Error).message}`;
    throw error;
  }
}

// ---- The driver ----

/** A truck drives on: the screen wakes, and the driver chooses English. */
export async function arrive(page: Page, bridge: Weighbridge, kg: number): Promise<void> {
  bridge.driveOn(kg);
  await expect(page.getByRole("button", { name: /^English/ }).first()).toBeVisible();
  await heading(page, "Language");
  await page
    .locator("main")
    .getByRole("button", { name: /^English/ })
    .click();
}

export async function leave(page: Page, bridge: Weighbridge): Promise<void> {
  bridge.driveOff();
  await expect(page.getByTestId("bridge-status")).toContainText("Weighbridge ready");
}

export async function confirmPlate(page: Page, shown: string): Promise<void> {
  await expect(page.getByTestId("plate")).toHaveText(shown);
  await press(page, "Yes");
}

export async function typeDigits(page: Page, digits: string): Promise<void> {
  const pad = page.getByRole("group", { name: "Number pad" });
  for (const digit of digits) {
    await pad.getByRole("button", { name: digit, exact: true }).click();
  }
}

/** The phone of the driver: a second browser, with no login. */
export async function openPhone(browser: Browser, page: Page) {
  const qr = page.getByTestId("upload-qr");
  await expect(qr).toHaveAttribute("data-url", /\/u\//);
  const url = await qr.getAttribute("data-url");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const phone = await context.newPage();
  await phone.goto(url!);
  return { phone, url: url!, close: () => context.close() };
}

export async function phonePicture(phone: Page, name: string): Promise<void> {
  await phone.evaluate(() => document.fonts.ready);
  const fits = await phone.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits, `${name}: nothing scrolls sideways on the phone`).toBe(true);
  await picture(phone, name);
}

export async function uploadFromPhone(browser: Browser, page: Page, file: string) {
  const { phone, close } = await openPhone(browser, page);
  await expect(phone.getByRole("button", { name: /Take photo|फ़ोटो लें/ })).toBeVisible();
  await phone.getByTestId("upload-file").setInputFiles(sampleInvoice(file));
  await expect(phone.getByTestId("upload-sent")).toBeVisible();
  await close();
}

/** Material to the check screen, taking what the invoice and the vehicle list say. */
export async function answerQuestions(
  page: Page,
  material: string,
  phoneNumber: string,
): Promise<void> {
  await heading(page, "Material");
  await press(page, material);
  await heading(page, "Supplier");
  await press(page, "Yes");
  await heading(page, "Transporter");
  await press(page, "Yes");
  await heading(page, "Phone number");
  await typeDigits(page, phoneNumber);
  await press(page, "Next");
  await heading(page, "Your name");
  await press(page, "Skip");
  await heading(page, "Check");
}

/** The ring fills while the truck stands still, then the driver confirms the weight. */
export async function confirmWeight(page: Page, weight: string): Promise<void> {
  await expect(page.getByTestId("ring")).toHaveAttribute("data-state", "full");
  // The unit is drawn smaller, in its own element.
  await expect(page.locator("main")).toContainText(new RegExp(weight.replace(" ", "\\s*")));
  await press(page, "Next");
}
