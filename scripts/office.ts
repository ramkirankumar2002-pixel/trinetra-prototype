// For trying the weighbridge by hand before the supervisor and store screens exist
// (Phases 12 and 13). It sets the demo "pick" modes and makes the people's decisions.
//   pnpm office pick cement          also: sand, steel-scrap, aggregate, steel-bars, bitumen
//   pnpm office list                 what is waiting for a person
//   pnpm office approve              the oldest waiting request
//   pnpm office reject               the same, refused
//   pnpm office real                 demo modes off
//   pnpm office reset                deletes demo tickets
// It talks to the backend on port 4000 with the demo logins and ADMIN_PIN.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  formatPlate,
  type StoreRequestsResponse,
  type SupervisorPhotoResponse,
  type SupervisorTicketView,
  type TicketView,
} from "@trinetra/shared";
import { SAMPLE_INVOICES, SEED_USERS } from "@trinetra/shared/seed";

const envFile = fileURLToPath(new URL("../apps/server/.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const BASE = process.env.OFFICE_SERVER_URL ?? "http://localhost:4000";

/** The simulator's empty truck is 18,250 kg: loaded, it carries what each invoice says. */
const LOADED_KG: Record<string, number> = {
  cement: 32_560,
  sand: 19_150,
  "steel-scrap": 19_750,
  // 14,310 kg against 14,500 kg on the invoice: this one fails the tolerance.
  aggregate: 32_560,
  "steel-bars": 32_560,
  bitumen: 32_560,
};

/** Those the unloading rules can send a Type 1 truck to. */
const SUPERVISORS = ["amit", "suresh", "vikram", "pankaj"] as const;

const cookies = new Map<string, string>();

async function call<T>(who: string, method: string, path: string, body?: unknown): Promise<T> {
  if (!cookies.has(who)) {
    const user = SEED_USERS.find((item) => item.username === who)!;
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: who, pin: user.pin }),
    });
    if (!login.ok) throw new Error(`Could not log in as ${who}. Has "pnpm db:seed" been run?`);
    cookies.set(who, login.headers.getSetCookie()[0]!.split(";")[0]!);
  }
  const form = body instanceof FormData;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      cookie: cookies.get(who)!,
      ...(path.startsWith("/api/demo") ? { "x-admin-pin": process.env.ADMIN_PIN ?? "" } : {}),
      ...(body === undefined || form ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
  });
  const data = (await response.json()) as T & { error?: { message: string } };
  if (!response.ok) throw new Error(`${path}: ${response.status} ${data.error?.message ?? ""}`);
  return data;
}

const demo = (method: string, path: string, body?: unknown) =>
  call("wb01", method, `/api/demo/${path}`, body);

async function pick(id: string): Promise<void> {
  const invoice = SAMPLE_INVOICES.find((item) => item.id === id);
  if (!invoice) throw new Error(`Pick one of: ${Object.keys(LOADED_KG).join(", ")}.`);
  const plate = invoice.printed.vehicle_number.replaceAll(" ", "");
  await demo("PUT", "settings", {
    anprMode: "pick",
    ocrMode: "pick",
    demoPlate: plate,
    demoInvoice: id,
  });
  console.log(`Demo modes on: plate ${formatPlate(plate)}, invoice "${id}".`);
  console.log(`In the simulator's terminal run:  pnpm sim --loaded ${LOADED_KG[id]}`);
  console.log(`At the weighbridge screen choose the material: ${invoice.expected.material}`);
}

interface Waiting {
  who: (typeof SUPERVISORS)[number] | "ram";
  approvalId: number;
  ticketId: number | null;
  kind: string;
  plate: string;
}

async function waiting(): Promise<Waiting[]> {
  const store = await call<StoreRequestsResponse>("ram", "GET", "/api/store/requests");
  const trucks = await Promise.all(
    SUPERVISORS.map(async (who) => {
      const { tickets } = await call<{ tickets: SupervisorTicketView[] }>(
        who,
        "GET",
        "/api/supervisor/tickets?status=pending",
      );
      return tickets.map((item) => ({ ...item, who }));
    }),
  );
  return [
    ...store.requests.map((item) => ({
      who: "ram" as const,
      approvalId: item.approval.id,
      ticketId: item.ticket?.id ?? null,
      kind: item.approval.kind,
      plate: item.ticket ? formatPlate(item.ticket.plate) : "no ticket yet",
    })),
    ...trucks.flat().map((item) => ({
      who: item.who,
      approvalId: item.approvalId,
      ticketId: item.ticketId,
      kind: "SUPERVISOR",
      plate: formatPlate(item.plate),
    })),
  ].sort((a, b) => a.approvalId - b.approvalId);
}

/** Warnings and help calls change nothing: they are marked handled on the way. */
const isNotice = async (item: Waiting): Promise<boolean> => {
  if (item.kind === "DRIVER_HELP") return true;
  if (item.kind !== "PLATE_WARNING" || item.ticketId === null) return false;
  const ticket = await call<TicketView>("ram", "GET", `/api/tickets/${item.ticketId}`);
  return (
    ticket.approvals.find((row) => row.id === item.approvalId)?.plateWarningReason ===
    "FRONT_BACK_MISMATCH"
  );
};

/** The supervisor's live photo. In pick mode it "shows" the demo plate: the truck's own. */
async function supervisorPhoto(item: Waiting): Promise<void> {
  const ticket = await call<TicketView>("ram", "GET", `/api/tickets/${item.ticketId}`);
  await demo("PUT", "settings", { anprMode: "pick", demoPlate: ticket.plate });
  const form = new FormData();
  const photo = await readFile(new URL("./sample-plates/match-front.jpg", import.meta.url));
  form.append("file", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "photo.jpg");
  const result = await call<SupervisorPhotoResponse>(
    item.who,
    "POST",
    `/api/supervisor/tickets/${item.ticketId}/photo`,
    form,
  );
  console.log(`Supervisor's photo: ${result.match ? "MATCH" : "NO MATCH"}.`);
}

async function decide(approve: boolean): Promise<void> {
  let item: Waiting | undefined;
  for (const next of await waiting()) {
    if (await isNotice(next)) {
      await call(next.who, "POST", `/api/approvals/${next.approvalId}/decide`, {
        decision: "APPROVE",
      });
      console.log(`Marked as handled: ${next.kind} (${next.plate}).`);
      continue;
    }
    item = next;
    break;
  }
  if (!item) return console.log("Nothing is waiting for a decision.");

  if (approve && item.kind === "SUPERVISOR") await supervisorPhoto(item);
  const extra: Record<string, string> = approve ? {} : { reason: "Tried by hand" };
  if (approve && item.kind === "HOLD") extra.chosenWeight = "NET";
  if (approve && item.kind === "MISMATCH") {
    const ticket = await call<TicketView>("ram", "GET", `/api/tickets/${item.ticketId}`);
    const onInvoice = SAMPLE_INVOICES.find(
      (sample) => sample.printed.invoice_number === ticket.invoice.number,
    );
    extra.chosenMaterial = onInvoice?.expected.material ?? "Cement Bags";
  }
  await call(item.who, "POST", `/api/approvals/${item.approvalId}/decide`, {
    decision: approve ? "APPROVE" : "REJECT",
    ...extra,
  });
  const by = item.who === "ram" ? "Store officer" : `Supervisor (${item.who})`;
  console.log(`${by}: ${approve ? "APPROVED" : "REJECTED"} ${item.kind} for ${item.plate}.`);
}

const [command, argument = ""] = process.argv.slice(2).filter((arg) => arg !== "--");

const COMMANDS: Record<string, () => Promise<unknown>> = {
  pick: () => pick(argument),
  list: async () => {
    const list = await waiting();
    if (list.length === 0) console.log("Nothing is waiting.");
    for (const item of list) console.log(`${item.kind.padEnd(14)} ${item.plate}`);
  },
  approve: () => decide(true),
  reject: () => decide(false),
  real: async () => {
    await demo("PUT", "settings", { anprMode: "real", ocrMode: "real", weightMode: "real" });
    console.log("Demo modes off: real cameras, readers and weight.");
  },
  reset: async () => {
    const { deletedTickets } = (await demo("POST", "reset")) as { deletedTickets: number };
    console.log(`Deleted ${deletedTickets} demo ticket(s).`);
  },
};

try {
  const run = COMMANDS[command ?? ""];
  if (!run) throw new Error(`Use: pnpm office ${Object.keys(COMMANDS).join(" | ")}`);
  await run();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
