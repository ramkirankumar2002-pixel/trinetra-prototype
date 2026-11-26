// The whole app for ticket tests: a real database, readings fed in as the ESP32's would
// be, and pretend plate and invoice readers.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CameraPlateRead, InvoiceRead, PlateRead, UserRole } from "@trinetra/shared";
import { SEED_SETTINGS } from "@trinetra/shared/seed";
import { asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, InjectOptions } from "fastify";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import { buildApp } from "../app";
import { createDb } from "../db/client";
import { approvals, photos, settings, ticketEvents, tickets, users } from "../db/schema";
import { seedDatabase } from "../db/seed";
import { SESSION_COOKIE } from "../plugins/security";
import { loadInvoiceLists } from "../services/readers";
import { interpretInvoice, type RawInvoice } from "../services/readers/invoice";
import { LocalStorage } from "../services/storage";
import { resetTestDatabase } from "./database";
import { deviceTokenEnv, waitFor } from "./device-client";
import { testDatabaseUrl, testEnv } from "./env";

export const ADMIN_PIN = "864209";
export const STABLE_MS = 150;
const FEED_EVERY_MS = 30;

/** Seeded accounts by what the tests use them for. */
export type Who = "kiosk" | "store" | "amit" | "suresh";

export const PLATE = "MH12AB1234";
export const OTHER_PLATE = "MH14CD5678";

export const invoice = (values: Partial<RawInvoice> = {}): RawInvoice => ({
  invoice_number: "INV-1",
  invoice_date: "2026-11-26",
  supplier: "Sample Cement Depot",
  transporter: "Sri Balaji Transport",
  vehicle_number: "MH 12 AB 1234",
  material: "OPC Cement",
  quantity: 14.31,
  quantity_unit: "MT",
  ...values,
});

export interface Response<T = Record<string, never>> {
  status: number;
  body: T & { error?: { code: string; message: string; details?: unknown } };
  headers: Record<string, unknown>;
}

export function useTicketHarness() {
  let folder: string;
  let storage: LocalStorage;
  let connection: ReturnType<typeof createDb>;
  let app: FastifyInstance;
  let feeder: NodeJS.Timeout | undefined;
  const accounts = new Map<Who, { id: number; role: UserRole; name: string }>();

  beforeAll(async () => {
    if (!testDatabaseUrl) return;
    await resetTestDatabase(testDatabaseUrl);
    connection = createDb(testDatabaseUrl, { max: 3 });
    await seedDatabase(connection.db);
    const rows = await connection.db.select().from(users);
    for (const [who, username] of [
      ["kiosk", "wb01"],
      ["store", "ram"],
      ["amit", "amit"],
      ["suresh", "suresh"],
    ] as const) {
      accounts.set(
        who,
        rows.find((row) => row.username === username)!,
      );
    }
    folder = await mkdtemp(join(tmpdir(), "trinetra-tickets-"));
    storage = new LocalStorage(folder, testEnv().JWT_SECRET);
  }, 60_000);

  afterAll(async () => {
    await connection?.close();
    if (folder) await rm(folder, { recursive: true, force: true });
  });

  async function startApp() {
    app = await buildApp({
      env: testEnv({ ...deviceTokenEnv, ADMIN_PIN }),
      storage,
      hardware: {
        settings: { wakeThresholdKg: 500, stableWindowMs: STABLE_MS, stableSpreadKg: 10 },
      },
    });
    await app.ready();
  }

  beforeEach(async () => {
    await connection.db.execute(
      sql`truncate table approvals, photos, ticket_events, upload_links, tickets restart identity cascade`,
    );
    for (const [key, value] of Object.entries(SEED_SETTINGS)) {
      await connection.db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
    }
    await connection.db.execute(
      sql`delete from settings where key = 'trip_count_from' or key like 'ticket_counter:%'`,
    );
    await startApp();
  }, 30_000);

  afterEach(async () => {
    clearInterval(feeder);
    feeder = undefined;
    await app.close();
  });

  // ---- The weighbridge ----

  const current = { kg: 0, stable: true, pos: true };

  /** Sends this reading again and again, as the ESP32 would. */
  function weigh(kg: number, options: { stable?: boolean; pos?: boolean } = {}) {
    Object.assign(current, { kg, stable: options.stable ?? true, pos: options.pos ?? true });
    const send = () => app.hardware.listener.mainMessage({ t: "w", ...current });
    send();
    feeder ??= setInterval(send, FEED_EVERY_MS);
  }

  /** Puts a still truck on the bridge and waits until its weight may be captured. */
  async function settle(kg: number) {
    weigh(kg);
    await waitFor(() => {
      const decision = app.hardware.state.canCapture();
      return decision.ok && decision.kg === kg;
    });
  }

  function leave() {
    weigh(0);
  }

  // ---- The readers ----

  async function fakePhoto(kind: "FRONT_PLATE" | "BACK_PLATE", ticketId: number | null) {
    const id = randomUUID();
    await connection.db
      .insert(photos)
      .values({ id, ticketId, kind, storagePath: `photos/test/${id}.jpg`, sha256: "test" });
    return id;
  }

  const plateRead = (plate: string | null): PlateRead => ({
    plate,
    source: plate ? "plate_recognizer" : null,
    model: null,
    confidence: plate ? 0.9 : null,
    validFormat: plate !== null,
    ms: 1,
    problems: [],
  });

  /** What the two cameras will read from now on. */
  function cameras(front: string | null = PLATE, back: string | null = front) {
    app.readers.readPlates = async (ticketId) => {
      const camera = async (
        plate: string | null,
        kind: "FRONT_PLATE" | "BACK_PLATE",
      ): Promise<CameraPlateRead> => ({
        ...plateRead(plate),
        photoId: await fakePhoto(kind, ticketId),
        cameraFailure: null,
      });
      const match = front !== null && front === back;
      return {
        cameras: {
          front: await camera(front, "FRONT_PLATE"),
          back: await camera(back, "BACK_PLATE"),
        },
        match,
        plate: match ? front : null,
        demo: false,
      };
    };
  }

  /** What the next invoices will say. */
  function invoiceReads(values: Partial<RawInvoice> = {}) {
    app.readers.readInvoice = async (_file, ticketPlate): Promise<InvoiceRead> =>
      interpretInvoice(invoice(values), {
        lists: await loadInvoiceLists(connection.db),
        ticketPlate,
        source: "gemini",
        ms: 1,
      });
  }

  /** What the supervisor's photo will show. */
  function supervisorSees(plate: string | null) {
    app.readers.readSupervisorPlate = async () => plateRead(plate);
  }

  // ---- Requests ----

  function cookie(who: Who) {
    const { id, role, name } = accounts.get(who)!;
    return { [SESSION_COOKIE]: app.jwt.sign({ userId: id, role, name, use: "session" }) };
  }

  async function call<T = Record<string, never>>(
    who: Who | null,
    method: "GET" | "POST" | "PUT" | "PATCH",
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response<T>> {
    const options: InjectOptions = {
      method,
      url,
      headers,
      ...(who ? { cookies: cookie(who) } : {}),
      ...(body === undefined ? {} : { payload: body as object }),
    };
    const response = await app.inject(options);
    return { status: response.statusCode, body: response.json(), headers: response.headers };
  }

  /** Not logged in is 401, and every role outside `allowed` is 403. */
  async function expectRoles(
    method: "GET" | "POST" | "PUT" | "PATCH",
    url: string,
    allowed: Who[],
    body?: unknown,
  ) {
    expect((await call(null, method, url, body)).status, `${url} without a login`).toBe(401);
    for (const who of ["kiosk", "store", "amit"] as const) {
      if (allowed.includes(who)) continue;
      expect((await call(who, method, url, body)).status, `${url} as ${who}`).toBe(403);
    }
  }

  const jpeg = () =>
    sharp({ create: { width: 40, height: 30, channels: 3, background: "#888888" } })
      .jpeg()
      .toBuffer();

  /** A multipart body with fields and, if given, one file. */
  function form(
    file: { data: Buffer; type: string } | null,
    fields: Record<string, string> = {},
  ): { payload: Buffer; headers: Record<string, string> } {
    const boundary = "trinetra-test-boundary";
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        ),
      );
    }
    if (file) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a"\r\n` +
            `Content-Type: ${file.type}\r\n\r\n`,
        ),
        file.data,
        Buffer.from("\r\n"),
      );
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return {
      payload: Buffer.concat(parts),
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    };
  }

  // ---- The database ----

  const ticketRow = async (id: number) =>
    (await connection.db.select().from(tickets).where(eq(tickets.id, id)))[0]!;
  const eventTypes = async (ticketId: number) =>
    (
      await connection.db
        .select()
        .from(ticketEvents)
        .where(eq(ticketEvents.ticketId, ticketId))
        .orderBy(asc(ticketEvents.id))
    ).map((row) => row.type);
  const approvalRows = () => connection.db.select().from(approvals).orderBy(asc(approvals.id));
  const allTickets = () => connection.db.select().from(tickets).orderBy(asc(tickets.id));

  return {
    get app() {
      return app;
    },
    get db() {
      return connection.db;
    },
    userId: (who: Who) => accounts.get(who)!.id,
    restart: async () => {
      clearInterval(feeder);
      feeder = undefined;
      await app.close();
      await startApp();
    },
    weigh,
    settle,
    leave,
    cameras,
    invoiceReads,
    supervisorSees,
    cookie,
    call,
    expectRoles,
    jpeg,
    form,
    ticketRow,
    eventTypes,
    approvalRows,
    allTickets,
  };
}

export type TicketHarness = ReturnType<typeof useTicketHarness>;
