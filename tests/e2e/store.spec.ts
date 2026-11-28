// Phase 13: the store officer's website, on a laptop and on a phone. The trucks are driven
// at the real weighbridge screen with the ESP32 simulator; the store officer decides on
// the real store pages. Plates and bills come from the demo "pick" modes, so no outside
// service is used.
//
// Set PHASE13_SHOTS=1 to save the pictures in docs/screenshots/phase13.
//
// IT RUNS "RESET DEMO DATA" FIRST: demo tickets in the development database are deleted.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { StoreRequestsResponse, TicketView } from "@trinetra/shared";
import { SEED_USERS, type SampleInvoiceId } from "@trinetra/shared/seed";
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
  sampleInvoice,
  uploadFromPhone,
  Weighbridge,
} from "./kiosk-world";
import { WEB_URL } from "./playwright.config";
import { LAPTOP, lookAt, PHONE } from "./staff-look";
import { signIn } from "./staff-session";

const SHOTS = process.env.PHASE13_SHOTS === "1";
const file = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const SHOT_FOLDER = file("docs/screenshots/phase13/");
const PIN = SEED_USERS.find((user) => user.username === "ram")!.pin;

const bridge = new Weighbridge();
let office: Office;
let kioskContext: BrowserContext;
let storeContext: BrowserContext;
let kioskApi: APIRequestContext;
let storeApi: APIRequestContext;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async ({ browser }) => {
  office = await Office.open(browser);
  kioskContext = await browser.newContext();
  storeContext = await browser.newContext();
  await signIn(kioskContext, "wb01");
  await signIn(storeContext, "ram");
  kioskApi = kioskContext.request;
  storeApi = storeContext.request;
  bridge.start();
});

test.afterAll(async () => {
  bridge.stop();
  await office?.allReal();
  await office?.reset();
  await office?.dispose();
  await kioskContext?.close();
  await storeContext?.close();
});

test.afterEach(() => bridge.driveOff());

// ---- Helpers ----

const pendingRequests = async () => {
  const answer = await storeApi.get(`${WEB_URL}/api/store/requests?status=pending`);
  return ((await answer.json()) as StoreRequestsResponse).requests;
};

/** A clean queue: demo tickets go, and old help calls that have no ticket are answered. */
async function emptyQueue() {
  await office.reset();
  for (const item of await pendingRequests()) {
    if (item.ticket) continue;
    await storeApi.post(`${WEB_URL}/api/approvals/${item.approval.id}/decide`, {
      data: { decision: "APPROVE" },
    });
  }
}

const ticketOf = async (plate: string): Promise<TicketView> => {
  const lists = await Promise.all(
    ["trucks", "history"].map(async (list) => {
      const answer = await storeApi.get(`${WEB_URL}/api/store/${list}`);
      return ((await answer.json()) as { tickets: { ticketId: number; plate: string }[] }).tickets;
    }),
  );
  const found = lists.flat().find((item) => item.plate === plate);
  expect(found, `${plate} has a ticket`).toBeDefined();
  const answer = await storeApi.get(`${WEB_URL}/api/tickets/${found!.ticketId}`);
  return (await answer.json()) as TicketView;
};

async function ok(answer: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(answer.ok(), await answer.text()).toBe(true);
  return answer.json();
}

/** A visit begun through the kiosk's API, with the sample bill sent as the phone does. */
async function startVisit(plate: string, invoice: SampleInvoiceId): Promise<number> {
  await office.pick(plate, invoice);
  const { ticket } = (await ok(
    await kioskApi.post(`${WEB_URL}/api/tickets`, {
      data: { plate, language: "en", manual: true },
    }),
  )) as { ticket: { id: number } };
  const link = (await ok(
    await kioskApi.post(`${WEB_URL}/api/tickets/${ticket.id}/upload-link`),
  )) as { code: string };
  await ok(
    await kioskApi.post(`${WEB_URL}/api/upload/${link.code}`, {
      multipart: {
        file: {
          name: "bill.pdf",
          mimeType: "application/pdf",
          buffer: await readFile(sampleInvoice(`${invoice}.pdf`)),
        },
      },
    }),
  );
  await expect
    .poll(async () => {
      const answer = await kioskApi.get(`${WEB_URL}/api/tickets/${ticket.id}`);
      return ((await answer.json()) as TicketView).invoice.state;
    })
    .toBe("read");
  return ticket.id;
}

const say = async (id: number, material: string) =>
  ok(await kioskApi.patch(`${WEB_URL}/api/tickets/${id}/details`, { data: { material } }));

async function weigh(id: number, kg: number) {
  bridge.driveOn(kg);
  await expect
    .poll(async () => (await kioskApi.post(`${WEB_URL}/api/tickets/${id}/first-weight`)).status(), {
      timeout: 30_000,
      intervals: [1000],
    })
    .toBe(200);
  bridge.driveOff();
}

interface Device {
  name: "laptop" | "phone";
  size: { width: number; height: number };
}

const DEVICES: Device[] = [
  { name: "laptop", size: LAPTOP },
  { name: "phone", size: PHONE },
];

/** A camera for a computer that has none: a stream that keeps showing one picture. */
async function pretendCamera(page: Page) {
  const picture = await readFile(file("scripts/sample-invoices/cement.jpg"));
  await page.addInitScript(
    (url) => {
      navigator.mediaDevices.getUserMedia = async () => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const draw = () => canvas.getContext("2d")!.drawImage(image, 0, 0);
        draw();
        setInterval(draw, 100);
        return canvas.captureStream(10);
      };
    },
    `data:image/jpeg;base64,${picture.toString("base64")}`,
  );
}

/** The store officer's own device, already logged in. */
async function storePage(device: Device, path = "/store/approvals") {
  const page = await storeContext.newPage();
  await pretendCamera(page);
  await page.setViewportSize(device.size);
  await page.goto(path);
  await online(page);
  return page;
}

const online = (page: Page) => expect(page.getByTestId("connection")).toHaveText("Online");

/** Pictures are saved from the laptop run only; both runs check both sizes. */
const look = (page: Page, name: string, device: Device) =>
  lookAt(page, name, {
    folder: SHOTS && device.name === "laptop" ? SHOT_FOLDER : null,
    back: device.size,
  });

const rowOf = (page: Page, plate: string) =>
  page.getByRole("table").getByRole("row").filter({ hasText: plate });

async function openRequest(page: Page, plate: string) {
  await rowOf(page, plate).getByRole("link", { name: /^Open/ }).click();
  await expect(page).toHaveURL(/\/store\/approvals\/\d+$/);
  await expect(page.getByTestId("actions")).toBeVisible();
}

const outcome = (page: Page, name: string) =>
  expect(page.getByTestId("outcome")).toHaveAttribute("data-outcome", name);

const button = (page: Page, name: string | RegExp) =>
  page.getByRole("button", typeof name === "string" ? { name, exact: true } : { name });

const field = (page: Page, key: string) => page.locator(`[data-field="${key}"]`);

/** Every decision the page sends, with its Idempotency-Key. */
function watchDecisions(page: Page) {
  const sent: (string | undefined)[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/decide")) sent.push(request.headers()["idempotency-key"]);
  });
  return sent;
}

// ---- The three journeys, on each device ----

for (const device of DEVICES) {
  test.describe(`on a ${device.name}`, () => {
    test("a Type 2 truck waits, then fails the tolerance: approve, then accept the invoice weight", async ({
      page,
      browser,
    }) => {
      await emptyQueue();
      await office.pick("DL01NP6789", "aggregate");
      const store = await storePage(device);
      await expect(store.getByText("Nothing is waiting for you")).toBeVisible();
      await expect(store).toHaveTitle("Trinetra");
      const decisions = watchDecisions(store);

      await openKiosk(page);
      await arrive(page, bridge, 32_560);
      await confirmPlate(page, "DL 01 NP 6789");
      await uploadFromPhone(browser, page, "aggregate.jpg");
      await press(page, "Next");
      await answerQuestions(page, "Aggregate 20 mm", "9000000005");
      await press(page, "Next");
      await confirmWeight(page, "32,560 kg");
      await expect(page.getByTestId("message-waitStore")).toContainText("move aside and wait");
      expect((await ticketOf("DL01NP6789")).firstWeightKg).toBeNull();

      // The store page, untouched: the request is there, with a message and the tab's number.
      await expect(rowOf(store, "DL 01 NP 6789")).toContainText("Type 2 check", { timeout: 5000 });
      await expect(
        store.getByText("New request: Type 2 check, DL 01 NP 6789").first(),
      ).toBeVisible();
      await expect(store).toHaveTitle("(1) Trinetra");
      await expect(store.getByTestId("bell")).toContainText("Alerts: 1");
      await openRequest(store, "DL 01 NP 6789");
      await expect(store.getByTestId("bill-fields")).toContainText("SMPL-AGG-004");
      await look(store, "04-type2-detail", device);
      await button(store, "Approve").dblclick();
      await outcome(store, "approved");
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toBeTruthy();

      // The first weight is saved, and the weighbridge shows the slip by itself.
      await heading(page, /^Go to /);
      expect((await ticketOf("DL01NP6789")).firstWeightKg).toBe(32_560);
      await leave(page, bridge);

      await arrive(page, bridge, 18_250);
      await confirmPlate(page, "DL 01 NP 6789");
      await press(page, "Second weight");
      await confirmWeight(page, "18,250 kg");
      await expect(page.getByTestId("message-hold")).toContainText("does not match the invoice");

      await store.getByRole("link", { name: "Back to approvals" }).click();
      await expect(rowOf(store, "DL 01 NP 6789")).toContainText("Weight HOLD");
      await openRequest(store, "DL 01 NP 6789");
      await expect(field(store, "slip.invoiceWeight")).toHaveText("14,500 kg");
      await expect(field(store, "slip.netWeight")).toHaveText("14,310 kg");
      await expect(field(store, "store.calc.difference")).toHaveText("−190 kg");
      await expect(field(store, "store.calc.percent")).toHaveText("1.31%");
      await expect(field(store, "store.calc.limit")).toHaveText("0.5%");
      await look(store, "05-hold-detail", device);

      await button(store, "Accept INVOICE weight: 14,500 kg").click();
      const confirm = button(store, "Accept invoice weight");
      await expect(confirm).toBeDisabled();
      await button(store, "Loss on the way (moisture or spillage)").click();
      await look(store, "05b-hold-reason", device);
      await confirm.click();
      await outcome(store, "approved");
      await expect(store).toHaveTitle("Trinetra");

      // The slip carries the weight the store officer chose.
      await heading(page, "Thank you, drive safely");
      await expect(page.getByTestId("slip")).toContainText("Accepted (invoice)");
      await expect(page.getByTestId("slip")).toContainText("14,500 kg");
      await expect(page.getByTestId("slip")).toContainText("Store approved");
      const done = await ticketOf("DL01NP6789");
      expect(done).toMatchObject({ status: "COMPLETED", finalWeightKg: 14_500, netKg: 14_310 });
      await store.close();
    });

    test('"No phone?": the store officer uploads the bill and the weighbridge goes on', async ({
      page,
    }) => {
      await emptyQueue();
      await office.pick("MH12AB1234", "cement");
      const store = await storePage(device);
      await openKiosk(page);
      await arrive(page, bridge, 32_560);
      await confirmPlate(page, "MH 12 AB 1234");
      await press(page, "No phone?");
      await expect(page.getByTestId("no-phone")).toBeVisible();

      await expect(rowOf(store, "MH 12 AB 1234")).toContainText("No phone: send bill", {
        timeout: 5000,
      });
      await openRequest(store, "MH 12 AB 1234");
      await expect(store.getByTestId("upload-bill")).toBeVisible();
      await look(store, "07-driver-help-upload", device);

      // The camera is offered too, framed for a bill.
      await button(store, "Take photo").click();
      await expect(store.getByTestId("camera-video")).toBeVisible();
      await expect(store.getByText("Put the whole bill inside the box.")).toBeVisible();
      await button(store, "Take photo").click();
      await expect(store.getByTestId("bill-preview")).toBeVisible();
      await button(store, "Choose another").click();

      await store.getByTestId("bill-file").setInputFiles(sampleInvoice("cement.jpg"));
      await expect(store.getByTestId("bill-preview")).toBeVisible();
      await look(store, "07b-driver-help-preview", device);
      await button(store, "Send the bill").click();
      await outcome(store, "uploaded");
      await expect(store.getByText("Done. The bill was read")).toBeVisible();
      await look(store, "07c-driver-help-done", device);

      // The weighbridge went on by itself.
      await expect(page.getByText("Your invoice has been read.")).toBeVisible();
      await expect(page.locator("main")).toContainText("SMPL-CEM-001");
      const ticket = await ticketOf("MH12AB1234");
      expect(ticket.approvals).toMatchObject([
        { kind: "DRIVER_HELP", status: "APPROVED", decidedBy: "Ram (Sr. Manager)" },
      ]);

      // "Wrong invoice" offers the code and "No phone?" again.
      await press(page, "Wrong invoice");
      await expect(page.getByTestId("upload-qr")).toBeVisible();
      await expect(page.getByRole("button", { name: "No phone?" })).toBeVisible();
      await store.close();
    });
  });
}

// ---- Login, the queue, the other requests and the lists ----

for (const device of DEVICES) {
  test(`login, home, mismatch, blocked plate, trucks and history on a ${device.name}`, async ({
    browser,
  }) => {
    await emptyQueue();

    // Not logged in: to the login, and back to the page asked for.
    const context = await browser.newContext({ viewport: device.size });
    const store = await context.newPage();
    await store.goto("/store/approvals");
    await expect(store).toHaveURL(`${WEB_URL}/store/login?next=%2Fstore%2Fapprovals`);
    await expect(store.getByLabel("Username")).toBeEnabled();
    await look(store, "01-login", device);
    await store.getByLabel("Username").fill("ram");
    const pad = store.getByRole("group", { name: "Number pad" });
    for (const digit of PIN) await pad.getByRole("button", { name: digit, exact: true }).click();
    await button(store, "Log in").click();
    await expect(store).toHaveURL(`${WEB_URL}/store/approvals`);
    await online(store);

    // A truck the store officer rejects, which then comes back.
    const first = await startVisit("UP32EF9012", "steel-scrap");
    await say(first, "Steel Scrap");
    await weigh(first, 19_750);
    await expect(rowOf(store, "UP 32 EF 9012")).toContainText("Type 2 check");
    await openRequest(store, "UP 32 EF 9012");
    await button(store, "Reject").click();
    const reject = button(store, "Reject truck");
    await expect(reject).toBeDisabled();
    await store.getByLabel("More words").fill("Load does not match");
    await reject.click();
    await outcome(store, "rejected");
    await startVisit("UP32EF9012", "steel-scrap");

    // A material that did not match five times.
    const mismatch = await startVisit("MH12AB1234", "cement");
    for (let n = 0; n < 5; n++) await say(mismatch, "Sand");

    // A Type 2 truck waiting, and a supervisor's truck that gets blocked.
    const waiting = await startVisit("DL01NP6789", "aggregate");
    await say(waiting, "Aggregate 20 mm");
    await weigh(waiting, 32_560);
    const blocked = await startVisit("RJ14LM2345", "steel-bars");
    await say(blocked, "Steel Bars");
    await weigh(blocked, 32_560);

    await store.goto("/store");
    await online(store);
    const kpi = (label: string) => store.getByTestId("kpi").filter({ hasText: label });
    await expect(kpi("Waiting for me")).toContainText("3");
    await expect(kpi("Rejected")).toContainText("1");
    await expect(kpi("Trucks on site")).toContainText("4");
    await expect(kpi("Completed trips")).toContainText("0");
    await expect(store.getByTestId("live-status")).toContainText("Connected");
    await expect(store.getByRole("table").getByRole("link", { name: /^Open/ })).toHaveCount(3);
    await look(store, "02-home", device);

    await store.goto("/store/approvals");
    await online(store);
    await expect(store.getByRole("table").getByRole("row")).toHaveCount(4);
    await look(store, "03-approvals", device);
    await button(store, "Plate (1)").click();
    await expect(store.getByRole("table").getByRole("row")).toHaveCount(2);
    await button(store, "HOLD (0)").click();
    await expect(store.getByText("No request of this kind is waiting.")).toBeVisible();
    await button(store, "All (3)").click();

    await openRequest(store, "UP 32 EF 9012");
    await expect(store.getByText("This plate was blocked or rejected")).toBeVisible();
    await expect(store.getByText("Rejected by the store officer")).toBeVisible();
    await look(store, "08-plate-warning", device);
    await button(store, "Allow").click();
    await expect(button(store, "Allow truck")).toBeDisabled();
    await button(store, "Checked the truck in person").click();
    await button(store, "Allow truck").click();
    await outcome(store, "approved");

    await store.goto("/store/approvals");
    await openRequest(store, "MH 12 AB 1234");
    const material = store.getByLabel("Correct material");
    await expect(button(store, "Set material and continue")).toBeDisabled();
    await material.selectOption("Cement Bags");
    await look(store, "06-mismatch", device);
    await button(store, "Set material and continue").click();
    await outcome(store, "material");

    // Answered somewhere else while this page is open: "Already handled", then the list.
    await store.goto("/store/approvals");
    await openRequest(store, "DL 01 NP 6789");
    await office.storeDecides("DL01NP6789", "STORE_TYPE2", { decision: "APPROVE" });
    await outcome(store, "taken");
    await expect(store.getByText("Already handled.")).toBeVisible();
    await expect(store).toHaveURL(`${WEB_URL}/store/approvals`, { timeout: 15_000 });

    // A supervisor blocks a truck: the store officer is told.
    await expect(store.getByRole("heading", { name: "Approvals" })).toBeVisible();
    await office.demo("put", "settings", { supervisorMode: "pick", demoPlate: "RJ14LM2345" });
    const vikram = await browser.newContext();
    await signIn(vikram, "vikram");
    const mine = (await (
      await vikram.request.get(`${WEB_URL}/api/supervisor/tickets?status=pending`)
    ).json()) as { tickets: { approvalId: number; ticketId: number }[] };
    const truck = mine.tickets.find((item) => item.ticketId === blocked)!;
    await ok(
      await vikram.request.post(`${WEB_URL}/api/approvals/${truck.approvalId}/decide`, {
        data: { decision: "REJECT", reason: "Wrong truck" },
      }),
    );
    await vikram.close();
    await expect(store.getByText("A supervisor blocked a truck.").first()).toBeVisible();

    await store.goto("/store/trucks");
    await online(store);
    await expect(rowOf(store, "DL 01 NP 6789")).toContainText("then second weight");
    await expect(rowOf(store, "MH 12 AB 1234")).toContainText("answering questions");
    await look(store, "09-trucks", device);
    await rowOf(store, "DL 01 NP 6789").getByRole("link", { name: /^View/ }).click();
    await expect(store.getByTestId("timeline")).toContainText("Store officer approved");
    await expect(store.getByTestId("who")).toContainText("Approved by store: Ram (Sr. Manager)");
    // To read only.
    await expect(button(store, "Approve")).toHaveCount(0);
    await look(store, "09b-truck-timeline", device);

    await store.goto("/store/history");
    await online(store);
    await expect(rowOf(store, "UP 32 EF 9012")).toContainText(
      "Rejected by store: Ram (Sr. Manager)",
    );
    await expect(rowOf(store, "RJ 14 LM 2345")).toContainText(
      "Rejected by supervisor: Vikram Sharma",
    );
    await look(store, "10-history", device);
    await store.getByRole("searchbox").fill("rj 14");
    await expect(store.getByRole("table").getByRole("row")).toHaveCount(2);
    await store.getByRole("searchbox").fill("ZZ99");
    await expect(store.getByText("No truck matches")).toBeVisible();
    await store.getByRole("searchbox").fill("");
    await rowOf(store, "RJ 14 LM 2345").getByRole("link", { name: /^View/ }).click();
    await expect(store.getByTestId("who")).toContainText("Rejected by supervisor");
    await expect(store).toHaveURL(/\/store\/history\/\d+$/);
    await look(store, "10b-history-detail", device);

    // The login ends: to the login, and back to the same page.
    const page = store.url();
    await context.clearCookies();
    await store.reload();
    await expect(store).toHaveURL(/\/store\/login\?next=/);
    await expect(store.getByLabel("Username")).toBeEnabled();
    await store.getByLabel("Username").fill("ram");
    for (const digit of PIN) await pad.getByRole("button", { name: digit, exact: true }).click();
    await button(store, "Log in").click();
    await expect(store).toHaveURL(page);
    await context.close();
  });
}

test("the store officer cancels visits that wait for a person", async ({ page, browser }) => {
  const device = DEVICES[0]!;
  await emptyQueue();
  await office.pick("UP32EF9012", "steel-scrap");
  const store = await storePage(device);

  // A Type 2 truck waits at the real weighbridge screen for a decision.
  await openKiosk(page);
  await arrive(page, bridge, 19_750);
  await confirmPlate(page, "UP 32 EF 9012");
  await uploadFromPhone(browser, page, "steel-scrap.jpg");
  await press(page, "Next");
  await answerQuestions(page, "Steel Scrap", "9000000004");
  await press(page, "Next");
  await confirmWeight(page, "19,750 kg");
  await expect(page.getByTestId("message-waitStore")).toBeVisible();

  await openRequest(store, "UP 32 EF 9012");
  await button(store, "Cancel visit").click();
  // The decision's own buttons are out of the way while the reason is asked.
  await expect(store.getByTestId("actions")).toHaveCount(0);
  await expect(button(store, "Yes, cancel visit")).toBeDisabled();
  await button(store, "Truck has left the site").click();
  await look(store, "11-cancel-reason", device);
  await button(store, "Yes, cancel visit").click();
  await outcome(store, "cancelled");
  await expect(store).toHaveTitle("Trinetra");
  await expect(page.getByTestId("message-timedOut")).toContainText("This visit has ended.");
  await leave(page, bridge);

  // A truck waiting for its supervisor can be cancelled from "Trucks on site".
  const id = await startVisit("RJ14LM2345", "steel-bars");
  await say(id, "Steel Bars");
  await weigh(id, 32_560);
  await store.goto("/store/trucks");
  await online(store);
  const row = rowOf(store, "RJ 14 LM 2345");
  await expect(row).toContainText("waiting for Vikram Sharma");
  await expect(row.getByTestId("wait")).toHaveText("0 min");
  await row.getByRole("link", { name: /^View/ }).click();
  await expect(store.getByText("Waiting for a decision:")).toBeVisible();
  await button(store, "Cancel visit").click();
  await store.getByLabel("More words").fill("Sent back at the gate");
  await button(store, "Yes, cancel visit").click();
  await outcome(store, "cancelled");
  await expect(store.getByTestId("timeline")).toContainText("Store officer cancelled the visit");
  await expect(button(store, "Cancel visit")).toHaveCount(0);

  const vikram = await browser.newContext();
  await signIn(vikram, "vikram");
  const answer = await vikram.request.get(`${WEB_URL}/api/supervisor/tickets?status=pending`);
  expect(((await answer.json()) as { tickets: unknown[] }).tickets).toEqual([]);
  await vikram.close();

  await store.goto("/store/history");
  await online(store);
  for (const [plate, why] of [
    ["UP 32 EF 9012", "Truck has left the site"],
    ["RJ 14 LM 2345", "Sent back at the gate"],
  ] as const) {
    await expect(rowOf(store, plate)).toContainText("Cancelled by Ram (Sr. Manager)");
    await expect(rowOf(store, plate)).toContainText(why);
  }
  await look(store, "11b-history-cancelled", device);
  await store.close();
});

test("a Bitumen truck in demo mode is sent to Suresh Yadav", async ({ page, browser }) => {
  await emptyQueue();
  await office.pick("BR06QR4321", "bitumen");
  await openKiosk(page);
  await arrive(page, bridge, 32_560);
  await confirmPlate(page, "BR 06 QR 4321");
  await uploadFromPhone(browser, page, "bitumen.pdf");
  await press(page, "Next");
  await answerQuestions(page, "Bitumen", "9000000006");
  await press(page, "Next");
  await confirmWeight(page, "32,560 kg");
  await heading(page, "Go to CH-003+750");
  await expect(page.locator("body")).toContainText("Suresh Yadav");
  await leave(page, bridge);
});
