// One full truck journey for each scenario, through the HTTP API only.
//   pnpm journey
//   pnpm journey --url http://localhost:4000
// The weights come from the ESP32 simulator, and the plates and invoices from the demo
// "pick" modes, so no camera or outside service is used. Every ticket is tagged demo.
// It starts the backend itself if none is running.
//
// IT RUNS "RESET DEMO DATA" FIRST: demo tickets in that database are deleted.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  formatIST,
  formatKg,
  formatPlate,
  type AnprResponse,
  type CreateTicketResponse,
  type DemoSettings,
  type DetailsResponse,
  type KioskStateResponse,
  type LiveSummaryResponse,
  type PublicTicketView,
  type StoreRequestsResponse,
  type SupervisorPhotoResponse,
  type SupervisorTicketView,
  type TicketStatus,
  type TicketView,
  type UploadInfoResponse,
  type UploadLinkResponse,
} from "@trinetra/shared";
import { SEED_USERS, type SampleInvoiceId } from "@trinetra/shared/seed";
import { SimDevice } from "./sim/device";
import { WeightModel } from "./sim/weight-model";

const envFile = fileURLToPath(new URL("../apps/server/.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { url: { type: "string" } },
});
const BASE = args.url ?? process.env.JOURNEY_SERVER_URL ?? "http://localhost:4000";

function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in apps/server/.env (see .env.example).`);
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (text: string) => console.log(`  ${text}`);
let stepNumber = 0;
const step = (text: string) => say(`${String(++stepNumber).padStart(2)}. ${text}`);

class JourneyError extends Error {
  override name = "JourneyError";
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new JourneyError(message);
}

// ---- The HTTP API ----

interface ApiOptions {
  who?: string;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** The status this call must be answered with. */
  expect?: number;
}

const cookies = new Map<string, string>();

async function api<T>(method: string, path: string, options: ApiOptions = {}) {
  const { who, body, form, expect: wanted } = options;
  const headers: Record<string, string> = { ...options.headers };
  if (who) headers.cookie = cookies.get(who)!;
  // As the real screens will: a repeat of the same press must not act twice.
  if (who && method !== "GET") headers["idempotency-key"] = randomUUID();
  if (body !== undefined) headers["content-type"] = "application/json";
  const payload = form ?? (body === undefined ? undefined : JSON.stringify(body));
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(payload === undefined ? {} : { body: payload }),
  });
  const data = (await response.json()) as T & { error?: { code: string; message: string } };
  const asExpected = wanted === undefined ? response.ok : response.status === wanted;
  check(
    asExpected,
    `${method} ${path} answered ${response.status} ${data.error?.code ?? ""} ` +
      `${data.error?.message ?? ""}`,
  );
  return data;
}

/** A call that must be refused. Returns the error code and says it in one line. */
async function refused(
  method: string,
  path: string,
  status: number,
  options: ApiOptions,
): Promise<string> {
  const { error } = await api<object>(method, path, { ...options, expect: status });
  return `${status} ${error!.code}: "${error!.message}"`;
}

async function logIn(username: string): Promise<void> {
  const user = SEED_USERS.find((item) => item.username === username)!;
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, pin: user.pin }),
  });
  check(response.ok, `Could not log in as ${username}. Has "pnpm db:seed" been run?`);
  cookies.set(username, response.headers.getSetCookie()[0]!.split(";")[0]!);
}

const KIOSK = "wb01";
const STORE = "ram";
const SUPERVISOR = "amit";
const VIKRAM = "vikram";

const demo = <T>(method: string, path: string, body?: unknown) =>
  api<T>(method, `/api/demo/${path}`, {
    who: KIOSK,
    headers: { "x-admin-pin": setting("ADMIN_PIN") },
    ...(body === undefined ? {} : { body }),
  });

async function fileForm(
  path: string,
  type: string,
  fields: Record<string, string> = {},
): Promise<FormData> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const data = await readFile(new URL(path, import.meta.url));
  form.append("file", new Blob([new Uint8Array(data)], { type }), path.split("/").pop()!);
  return form;
}

// ---- The weighbridge (the ESP32 simulator) ----

const bridge = new WeightModel();
const commands: string[] = [];
/** What the light and the display show, to catch a command that changes nothing. */
const showing = new Map<string, string>();
const repeated: string[] = [];
let sender: NodeJS.Timeout | undefined;
let esp32: SimDevice | undefined;

const kioskState = () => api<KioskStateResponse>("GET", "/api/kiosk/state", { who: KIOSK });

async function waitForState(
  done: (state: KioskStateResponse) => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await kioskState();
    if (done(state)) return;
    check(Date.now() < deadline, `Timed out waiting for ${what}: ${JSON.stringify(state)}`);
    await sleep(250);
  }
}

async function startWeighbridge(): Promise<void> {
  esp32 = new SimDevice({
    name: "main ESP32",
    url: `${BASE.replace(/^http/, "ws")}/device`,
    token: setting("DEVICE_TOKEN"),
    log: () => {},
    onCommand: (command) => {
      if (command.t === "buzz") commands.push("buzzer");
      if (command.t !== "light" && command.t !== "display") return;
      const value = command.t === "light" ? String(command.c) : `"${String(command.text)}"`;
      if (showing.get(command.t) === value) repeated.push(`${command.t} ${value}`);
      showing.set(command.t, value);
      commands.push(`${command.t} ${value}`);
    },
  });
  esp32.connect();
  sender = setInterval(() => esp32!.send({ t: "w", ...bridge.read(performance.now()) }), 200);
  await waitForState((state) => state.devices.main.online, "the simulated ESP32");
}

/** What the weighbridge's lights and display were told since the last time. */
function hardwareSaid(): void {
  const said = commands.splice(0);
  if (said.length > 0) say(`    weighbridge: ${said.join(", ")}`);
  check(repeated.length === 0, `The weighbridge was told twice: ${repeated.join(", ")}.`);
}

/** A truck drives on and stands still. */
async function driveOn(kg: number): Promise<void> {
  bridge.arrive(kg, performance.now());
  await waitForState(
    (state) => state.canCapture.ok && state.weight?.kg === kg,
    `a stable ${formatKg(kg)}`,
  );
  step(`A truck of ${formatKg(kg)} stands still on the bridge.`);
}

async function driveOff(): Promise<void> {
  bridge.leave(performance.now());
  await waitForState(
    (state) => (state.weight?.kg ?? Number.POSITIVE_INFINITY) === 0,
    "an empty bridge",
  );
  await sleep(300);
  step("The truck drives off.");
  hardwareSaid();
}

// ---- The kiosk's side of a journey ----

interface Truck {
  plate: string;
  invoice: SampleInvoiceId;
  material: string;
  loadedKg: number;
  emptyKg: number;
}

const pickDemo = (truck: Truck) =>
  demo<DemoSettings>("PUT", "settings", {
    anprMode: "pick",
    ocrMode: "pick",
    demoPlate: truck.plate,
    demoInvoice: truck.invoice,
  });

async function readPlate(): Promise<AnprResponse> {
  const read = await api<AnprResponse>("POST", "/api/anpr", { who: KIOSK });
  step(
    `Plate read: front ${formatPlate(read.front.plate ?? "?")}, ` +
      `back ${formatPlate(read.back.plate ?? "?")}, match ${read.match ? "yes" : "no"} ` +
      `(${read.sources.front}).` +
      (read.openTicket
        ? ` Open ticket ${read.openTicket.ticketNo} (${read.openTicket.status}).`
        : "") +
      (read.blockedTicket ? ` BLOCKED ticket ${read.blockedTicket.ticketNo}.` : ""),
  );
  return read;
}

/** The invoice is read after the phone's upload is answered, as the kiosk sees it. */
async function waitForInvoice(ticketId: number): Promise<TicketView> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const ticket = await api<TicketView>("GET", `/api/tickets/${ticketId}`, { who: KIOSK });
    const { state, error } = ticket.invoice;
    if (state === "read") return ticket;
    check(state === "reading", `The invoice was not read: ${state} ${error ?? ""}`);
    check(Date.now() < deadline, "Timed out waiting for the invoice to be read.");
    await sleep(200);
  }
}

/** Plate, ticket, invoice from the "phone", and the driver's answers. */
async function checkIn(truck: Truck): Promise<TicketView> {
  await pickDemo(truck);
  await driveOn(truck.loadedKg);
  const read = await readPlate();

  const { ticket } = await api<CreateTicketResponse>("POST", "/api/tickets", {
    who: KIOSK,
    body: { plate: read.plate, language: "hi", photoIds: read.photoIds },
  });
  step(`Driver confirms the plate. Ticket ${ticket.ticketNo} is ${ticket.status}.`);
  hardwareSaid();

  const link = await api<UploadLinkResponse>("POST", `/api/tickets/${ticket.id}/upload-link`, {
    who: KIOSK,
  });
  const phone = await api<UploadInfoResponse>("GET", `/api/upload/${link.code}`);
  step(`Kiosk shows the QR. The driver's phone sees only plate ${formatPlate(phone.plate)}.`);
  await api("POST", `/api/upload/${link.code}`, {
    form: await fileForm(`./sample-invoices/${truck.invoice}.jpg`, "image/jpeg"),
    expect: 202,
  });
  step("The phone is told at once that the file arrived; it is read after that.");
  const withInvoice = await waitForInvoice(ticket.id);
  const { invoice } = withInvoice;
  step(
    `Invoice read: ${invoice.number}, ${invoice.material}, ` +
      `${formatKg(invoice.weightKg!)}, from ${withInvoice.supplier}.`,
  );
  for (const warning of withInvoice.warnings) say(`    WARNING: ${warning.message}`);
  say(`    The same QR again: ${await refused("GET", `/api/upload/${link.code}`, 410, {})}`);

  const details = await api<DetailsResponse>("PATCH", `/api/tickets/${ticket.id}/details`, {
    who: KIOSK,
    body: {
      material: truck.material,
      supplier: withInvoice.supplier,
      transporter: withInvoice.transporter,
      driverName: "Test Driver",
      driverPhone: "9000000001",
    },
  });
  check(details.materialMatched, "The material did not match the invoice.");
  step(`Driver answers: ${truck.material}, supplier, transporter, name and phone.`);
  return details.ticket;
}

function describeFirstWeight(ticket: TicketView): void {
  if (ticket.status === "STORE_PENDING") {
    step(`First weight ${formatKg(ticket.heldWeightKg!)} is HELD (${ticket.type}).`);
  } else {
    step(
      `First weight ${formatKg(ticket.firstWeightKg!)} saved (${ticket.type}), trip ` +
        `${ticket.tripNo}. Go to ${ticket.unloadingPoint!.code}, ${ticket.supervisor!.name}.`,
    );
  }
  say(`    Status: ${ticket.status}`);
}

async function firstWeight(ticket: TicketView): Promise<TicketView> {
  const saved = await api<TicketView>("POST", `/api/tickets/${ticket.id}/first-weight`, {
    who: KIOSK,
  });
  describeFirstWeight(saved);
  await sleep(200);
  hardwareSaid();
  return saved;
}

const printSlip = async (id: number, kind: "FIRST" | "FINAL") => {
  await api("POST", `/api/tickets/${id}/printed`, { who: KIOSK, body: { kind } });
  step(`Print button: ${kind} slip.`);
};

/** The truck comes back empty and is weighed again. */
async function secondVisit(truck: Truck, ticket: TicketView): Promise<TicketView> {
  await pickDemo(truck);
  await driveOn(truck.emptyKg);
  const read = await readPlate();
  check(read.openTicket?.id === ticket.id, "The kiosk did not find the open ticket.");
  const saved = await api<TicketView>("POST", `/api/tickets/${ticket.id}/second-weight`, {
    who: KIOSK,
  });
  step(
    `Second weight ${formatKg(saved.secondWeightKg!)}: net ${formatKg(saved.netKg!)}, invoice ` +
      `${formatKg(saved.invoice.weightKg!)}, variance ${saved.variancePct}%.`,
  );
  say(`    Status: ${saved.status}${saved.holdReason ? ` (${saved.holdReason})` : ""}`);
  await sleep(200);
  hardwareSaid();
  return saved;
}

// ---- The people who decide ----

async function storeDecides(
  ticket: TicketView,
  kind: string,
  decision: Record<string, unknown>,
): Promise<void> {
  const list = await api<StoreRequestsResponse>("GET", "/api/store/requests?status=pending", {
    who: STORE,
  });
  const request = list.requests.find(
    (item) => item.ticket?.id === ticket.id && item.approval.kind === kind,
  );
  check(request, `The store officer has no ${kind} request for ${ticket.ticketNo}.`);
  await api("POST", `/api/approvals/${request.approval.id}/decide`, {
    who: STORE,
    body: decision,
  });
  const chosen = decision.chosenWeight ? ` with the ${String(decision.chosenWeight)} weight` : "";
  const reason = decision.reason ? `: "${String(decision.reason)}"` : "";
  step(`Store officer: ${String(decision.decision)} ${kind}${chosen}${reason}.`);
}

const waitingFor = async (who: string) =>
  (
    await api<{ tickets: SupervisorTicketView[] }>(
      "GET",
      "/api/supervisor/tickets?status=pending",
      { who },
    )
  ).tickets;

async function supervisorChecks(ticket: TicketView, seen: string, who: string = SUPERVISOR) {
  const tickets = await waitingFor(who);
  const mine = tickets.find((item) => item.ticketId === ticket.id);
  check(mine, "The truck is not on the supervisor's list.");
  step(`Supervisor sees ${formatPlate(mine.plate)} waiting at ${mine.unloadingPoint!.code}.`);

  // In pick mode the photo "shows" the demo plate.
  await demo("PUT", "settings", { demoPlate: seen });
  const photo = await api<SupervisorPhotoResponse>(
    "POST",
    `/api/supervisor/tickets/${ticket.id}/photo`,
    {
      who,
      form: await fileForm("./sample-plates/match-front.jpg", "image/jpeg", {
        lat: "21.2514",
        lng: "81.6296",
        accuracyM: "15",
      }),
    },
  );
  step(
    `Supervisor's live photo reads ${formatPlate(photo.plateRead ?? "?")}: ` +
      `${photo.match ? "MATCH" : "NO MATCH"} (photo ${photo.photosUsed} of 3).`,
  );
  return { approvalId: mine.approvalId, match: photo.match };
}

const decideAsSupervisor = (
  approvalId: number,
  body: Record<string, unknown>,
  who: string = SUPERVISOR,
) => api("POST", `/api/approvals/${approvalId}/decide`, { who, body });

// ---- The final ticket ----

/** The rows that open a request: the move that needs it, or APPROVAL_REQUESTED. */
const REQUEST_ROWS = new Set([
  "APPROVAL_REQUESTED",
  "MISMATCH_LIMIT_REACHED",
  "FIRST_WEIGHT_HELD",
  "SUPERVISOR_REQUESTED",
  "SECOND_WEIGHT_FAILED",
]);

function checkOneRowPerRequest(ticket: TicketView): void {
  for (const { id, kind } of ticket.approvals) {
    const rows = ticket.timeline.filter(
      (entry) => REQUEST_ROWS.has(entry.type) && entry.data.approvalId === id,
    );
    check(rows.length === 1, `The ${kind} request has ${rows.length} timeline rows, not 1.`);
  }
}

async function showTicket(id: number, expected: TicketStatus): Promise<TicketView> {
  const ticket = await api<TicketView>("GET", `/api/tickets/${id}`, { who: STORE });
  check(ticket.status === expected, `Expected ${expected}, got ${ticket.status}.`);
  const kg = (value: number | null) => (value === null ? "-" : formatKg(value));
  const lines: [string, string][] = [
    ["Ticket", `${ticket.ticketNo}  ${formatPlate(ticket.plate)}  ${ticket.status}`],
    ["Material", `${ticket.material} (${ticket.type}), ${ticket.supplier}`],
    ["Invoice", `${ticket.invoice.number}, ${kg(ticket.invoice.weightKg)}`],
    ["Weights", `first ${kg(ticket.firstWeightKg)}, second ${kg(ticket.secondWeightKg)}`],
    [
      "Result",
      `net ${kg(ticket.netKg)}, variance ${ticket.variancePct ?? "-"}%, ` +
        `accepted ${kg(ticket.finalWeightKg)}`,
    ],
    [
      "Unload",
      ticket.unloadingPoint
        ? `trip ${ticket.tripNo}, ${ticket.unloadingPoint.code}, ${ticket.supervisor!.name}`
        : "-",
    ],
    ["Closed", ticket.closedAt ? formatIST(new Date(ticket.closedAt)) : "-"],
    ["Demo", ticket.isDemo ? "yes (tagged)" : "no"],
  ];
  console.log("\n  Final ticket");
  for (const [name, value] of lines) say(`  ${name.padEnd(9)} ${value}`);
  say("  Timeline");
  for (const entry of ticket.timeline) say(`    ${entry.type.padEnd(24)} ${entry.actorName}`);
  checkOneRowPerRequest(ticket);
  return ticket;
}

function title(text: string): void {
  stepNumber = 0;
  commands.length = 0;
  console.log(`\n${"=".repeat(78)}\n${text}\n${"=".repeat(78)}`);
}

// ---- The six journeys ----

async function typeThreeAutomatic(): Promise<string> {
  title("1. Type 3, fully automatic: sand, 900 kg on the invoice");
  const truck: Truck = {
    plate: "MP09JK7890",
    invoice: "sand",
    material: "Sand",
    loadedKg: 19_150,
    emptyKg: 18_250,
  };
  let ticket = await firstWeight(await checkIn(truck));
  check(ticket.status === "READY_FOR_SECOND", "A Type 3 truck needs nobody.");
  await printSlip(ticket.id, "FIRST");
  await driveOff();
  ticket = await secondVisit(truck, ticket);
  await printSlip(ticket.id, "FINAL");
  await driveOff();
  await showTicket(ticket.id, "COMPLETED");

  const shared = await api<PublicTicketView>("GET", `/api/public/tickets/${ticket.ticketNo}`);
  const text = JSON.stringify(shared);
  check(!text.includes("9000000001"), "The public timeline shows a phone number.");
  say(`\n  Public timeline (no login): ${shared.timeline.length} entries, no phone numbers.`);
  return ticket.ticketNo;
}

async function typeOneApproved(): Promise<string> {
  title("2. Type 1, supervisor approves: cement");
  const truck: Truck = {
    plate: "MH12AB1234",
    invoice: "cement",
    material: "Cement Bags",
    loadedKg: 32_560,
    emptyKg: 18_250,
  };
  let ticket = await firstWeight(await checkIn(truck));
  check(ticket.status === "SUPERVISOR_PENDING", "A Type 1 truck needs its supervisor.");
  await printSlip(ticket.id, "FIRST");
  await driveOff();

  await driveOn(truck.emptyKg);
  say(
    `    Weighing too early: ${await refused("POST", `/api/tickets/${ticket.id}/second-weight`, 409, { who: KIOSK })}`,
  );
  await driveOff();

  const { approvalId, match } = await supervisorChecks(ticket, truck.plate);
  check(match, "The supervisor's photo should match.");
  await decideAsSupervisor(approvalId, { decision: "APPROVE" });
  step("Supervisor: APPROVE.");

  ticket = await secondVisit(truck, ticket);
  await printSlip(ticket.id, "FINAL");
  await driveOff();
  await showTicket(ticket.id, "COMPLETED");
  return ticket.ticketNo;
}

async function fraudBlocked(): Promise<string> {
  title("3. Fraud blocked: another truck is at the unloading point");
  const truck: Truck = {
    plate: "MH14CD5678",
    invoice: "cement",
    material: "Cement Bags",
    loadedKg: 32_560,
    emptyKg: 18_250,
  };
  const ticket = await firstWeight(await checkIn(truck));
  await driveOff();

  const { approvalId, match } = await supervisorChecks(ticket, "RJ14LM2345");
  check(!match, "The supervisor's photo should not match.");
  say(
    `    Approving anyway: ${await refused("POST", `/api/approvals/${approvalId}/decide`, 409, { who: SUPERVISOR, body: { decision: "APPROVE" } })}`,
  );
  await decideAsSupervisor(approvalId, { decision: "REJECT", reason: "Wrong vehicle" });
  step('Supervisor: REJECT, "Wrong vehicle". The ticket is BLOCKED.');

  // The real truck comes back: its own plate again.
  await pickDemo(truck);
  await driveOn(truck.emptyKg);
  const back = await readPlate();
  check(back.blockedTicket?.id === ticket.id, "The kiosk did not find the blocked ticket.");
  say(
    `    Second weight: ${await refused("POST", `/api/tickets/${ticket.id}/second-weight`, 409, { who: KIOSK })}`,
  );
  say(
    `    Final slip: ${await refused("POST", `/api/tickets/${ticket.id}/printed`, 409, { who: KIOSK, body: { kind: "FINAL" } })}`,
  );
  await driveOff();
  const blocked = await showTicket(ticket.id, "BLOCKED");

  console.log("\n  The same truck tries to start over:");
  const retry = await checkIn(truck);
  check(retry.plateCheck === "PENDING", "A blocked plate must wait for the store officer.");
  say(
    `    First weight: ${await refused("POST", `/api/tickets/${retry.id}/first-weight`, 409, { who: KIOSK })}`,
  );
  await storeDecides(retry, "PLATE_WARNING", {
    decision: "REJECT",
    reason: "Blocked earlier today",
  });
  await driveOff();
  const again = await api<TicketView>("GET", `/api/tickets/${retry.id}`, { who: STORE });
  check(again.status === "REJECTED", "The new ticket should be rejected.");
  say(`    New ticket ${again.ticketNo}: ${again.status}, no weight saved.`);
  return blocked.ticketNo;
}

async function typeTwoApproved(): Promise<string> {
  title("4. Type 2, approved by the store officer: steel scrap, 1,500 kg");
  const truck: Truck = {
    plate: "UP32EF9012",
    invoice: "steel-scrap",
    material: "Steel Scrap",
    loadedKg: 19_750,
    emptyKg: 18_250,
  };
  let ticket = await firstWeight(await checkIn(truck));
  check(ticket.status === "STORE_PENDING", "A Type 2 weight is held.");
  await driveOff();
  await storeDecides(ticket, "STORE_TYPE2", { decision: "APPROVE" });
  ticket = await api<TicketView>("GET", `/api/tickets/${ticket.id}`, { who: KIOSK });
  describeFirstWeight(ticket);
  await printSlip(ticket.id, "FIRST");
  ticket = await secondVisit(truck, ticket);
  await printSlip(ticket.id, "FINAL");
  await driveOff();
  await showTicket(ticket.id, "COMPLETED");
  return ticket.ticketNo;
}

async function toleranceFail(): Promise<string> {
  title("5. Tolerance fail, resolved by the store officer: aggregate, 14,500 kg invoiced");
  const truck: Truck = {
    plate: "DL01NP6789",
    invoice: "aggregate",
    material: "Aggregate 20 mm",
    loadedKg: 32_560,
    emptyKg: 18_250,
  };
  let ticket = await firstWeight(await checkIn(truck));
  await driveOff();
  // 14,500 kg of aggregate is above 500 kg, so this truck is Type 2 first.
  await storeDecides(ticket, "STORE_TYPE2", { decision: "APPROVE" });
  ticket = await api<TicketView>("GET", `/api/tickets/${ticket.id}`, { who: KIOSK });
  describeFirstWeight(ticket);
  ticket = await secondVisit(truck, ticket);
  check(ticket.status === "HOLD_PENDING", "1.31% is outside the 0.5% tolerance.");
  await driveOff();
  await storeDecides(ticket, "HOLD", { decision: "APPROVE", chosenWeight: "NET" });
  await printSlip(ticket.id, "FINAL");
  await showTicket(ticket.id, "COMPLETED");
  return ticket.ticketNo;
}

// ---- Running it ----

async function serverAnswers(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/api/health`)).ok;
  } catch {
    return false;
  }
}

async function steelBarsToVikram(): Promise<string> {
  title("6. Type 1 at another unloading point: steel bars go to Vikram Sharma");
  const truck: Truck = {
    plate: "RJ14LM2345",
    invoice: "steel-bars",
    material: "Steel Bars",
    loadedKg: 32_560,
    emptyKg: 18_250,
  };
  let ticket = await firstWeight(await checkIn(truck));
  check(ticket.status === "SUPERVISOR_PENDING", "A Type 1 truck needs its supervisor.");
  check(
    ticket.unloadingPoint?.code === "CH-010+500" && ticket.supervisor?.name === "Vikram Sharma",
    `Steel Bars should go to CH-010+500, Vikram Sharma, not ${ticket.supervisor?.name}.`,
  );
  await printSlip(ticket.id, "FIRST");
  await driveOff();

  const amits = await waitingFor(SUPERVISOR);
  check(!amits.some((item) => item.ticketId === ticket.id), "Amit Kumar must not see it.");
  step("Amit Kumar's list does not show the truck.");
  say(
    `    Amit opens it anyway: ${await refused("GET", `/api/tickets/${ticket.id}`, 403, { who: SUPERVISOR })}`,
  );

  const { approvalId, match } = await supervisorChecks(ticket, truck.plate, VIKRAM);
  check(match, "Vikram's photo should match.");
  await decideAsSupervisor(approvalId, { decision: "APPROVE" }, VIKRAM);
  step("Vikram Sharma: APPROVE.");

  ticket = await secondVisit(truck, ticket);
  await printSlip(ticket.id, "FINAL");
  await driveOff();
  await showTicket(ticket.id, "COMPLETED");
  return ticket.ticketNo;
}

/** Starts the backend if none is running. Returns the process to stop afterwards. */
async function ensureServer(): Promise<ChildProcess | undefined> {
  if (await serverAnswers()) {
    console.log(`Using the backend already running at ${BASE}.`);
    return undefined;
  }
  check(!args.url, `No healthy backend answers at ${BASE}.`);
  console.log("No backend is running: starting one for this run.");
  const log: string[] = [];
  const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: fileURLToPath(new URL("../apps/server/", import.meta.url)),
    env: { ...process.env, PORT: new URL(BASE).port || "4000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream!.on("data", (data: Buffer) => {
      log.push(data.toString());
      if (log.length > 40) log.shift();
    });
  }
  for (let tries = 0; tries < 60; tries++) {
    if (await serverAnswers()) return server;
    if (server.exitCode !== null) break;
    await sleep(500);
  }
  server.kill();
  throw new JourneyError(`The backend did not start:\n${log.join("")}`);
}

async function main(): Promise<void> {
  const server = await ensureServer();
  let before: DemoSettings | undefined;
  try {
    for (const user of [KIOSK, STORE, SUPERVISOR, VIKRAM]) await logIn(user);
    before = await demo<DemoSettings>("GET", "settings");
    await demo("PUT", "settings", { weightMode: "real" });
    const reset = await demo<{ deletedTickets: number }>("POST", "reset");
    console.log(`Reset demo data: ${reset.deletedTickets} earlier demo ticket(s) deleted.`);
    await startWeighbridge();
    bridge.leave(performance.now());

    const results: [string, string][] = [
      ["Type 3 automatic", await typeThreeAutomatic()],
      ["Type 1 supervisor approves", await typeOneApproved()],
      ["Fraud blocked", await fraudBlocked()],
      ["Type 2 store approves", await typeTwoApproved()],
      ["Tolerance fail resolved", await toleranceFail()],
      ["Steel bars to Vikram", await steelBarsToVikram()],
    ];

    title("All six journeys finished");
    for (const [name, ticketNo] of results) {
      const ticket = await api<PublicTicketView>("GET", `/api/public/tickets/${ticketNo}`);
      say(`${name.padEnd(28)} ${ticketNo}  ${ticket.status}`);
    }
    const summary = await api<LiveSummaryResponse>("GET", "/api/live/summary");
    say(
      `Live summary: ${summary.trucksToday} trucks today, ${summary.blockedOrRejected} ` +
        `blocked or rejected, ${summary.pendingApprovals} waiting. Received: ` +
        summary.kgByMaterial.map((row) => `${row.material} ${formatKg(row.kg)}`).join(", "),
    );
  } finally {
    // The demo switches go back to how they were.
    if (before) {
      await demo("PUT", "settings", {
        anprMode: before.anprMode,
        ocrMode: before.ocrMode,
        ...(before.demoPlate ? { demoPlate: before.demoPlate } : {}),
        ...(before.demoInvoice ? { demoInvoice: before.demoInvoice } : {}),
      }).catch((error: Error) =>
        console.error(`Could not restore the demo settings: ${error.message}`),
      );
    }
    clearInterval(sender);
    esp32?.close();
    server?.kill();
  }
}

try {
  await main();
} catch (error) {
  console.error(`\nJOURNEY FAILED: ${(error as Error).message}`);
  process.exitCode = 1;
}
