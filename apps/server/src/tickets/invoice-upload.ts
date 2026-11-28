// The driver uploads the invoice from their own phone (build plan sections 7 and 8).
// The one-time code in the QR is the only permission, so only its hash is stored and it
// tells the phone nothing but the plate.
import { createHash, randomBytes } from "node:crypto";
import {
  matchMaterial,
  type InvoiceRead,
  type UploadInfoResponse,
  type UploadLinkResponse,
  type UploadResponse,
} from "@trinetra/shared";
import { and, desc, eq, gt, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { publicWebUrl, type Env } from "../config/env";
import { UPLOAD_LINK_MS } from "../config/limits";
import { approvals, materials, ticketEvents, tickets, uploadLinks } from "../db/schema";
import { AppError } from "../errors/app-error";
import { ReaderError } from "../services/readers/errors";
import type { Upload } from "../http/upload";
import { emitAfterCommit, type Transaction } from "../realtime/after-commit";
import { storeFile, type StoredFile } from "../services/images/pipeline";
import { markHandled } from "./decisions";
import { isDemoActive, tagDemo } from "./demo";
import {
  addEvent,
  getTicket,
  lockTicket,
  ticketRooms,
  updateTicket,
  userActor,
  wrongStage,
  type Actor,
  type TicketRow,
} from "./repo";

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

const needsStarted = (ticket: TicketRow) => {
  if (ticket.status !== "STARTED" || ticket.load === "EMPTY") {
    throw wrongStage("The invoice can only be added before the first weight.");
  }
};

export async function createUploadLink(
  app: FastifyInstance,
  env: Env,
  ticketId: number,
  actor: Actor,
): Promise<UploadLinkResponse> {
  const code = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + UPLOAD_LINK_MS);

  await app.eventTransaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId);
    needsStarted(ticket);
    // Only the newest QR works.
    await tx
      .update(uploadLinks)
      .set({ expiresAt: new Date() })
      .where(
        and(
          eq(uploadLinks.ticketId, ticketId),
          isNull(uploadLinks.usedAt),
          gt(uploadLinks.expiresAt, new Date()),
        ),
      );
    await tx.insert(uploadLinks).values({ ticketId, codeHash: hashCode(code), expiresAt });
    await updateTicket(tx, ticket, {});
    await addEvent(tx, ticketId, "INVOICE_LINK_CREATED", actor);
  });

  return {
    code,
    url: `${publicWebUrl(env)}/u/${code}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** The link and its ticket, if the code can still be used. */
async function usableLink(app: FastifyInstance, code: string) {
  const [link] = await app.db
    .select()
    .from(uploadLinks)
    .where(eq(uploadLinks.codeHash, hashCode(code)));
  if (!link) throw new AppError(404, "INVALID_CODE", "This upload link is not valid.");
  if (link.usedAt) {
    throw new AppError(410, "CODE_USED", "This upload link has already been used.");
  }
  if (link.expiresAt.getTime() <= Date.now()) {
    throw new AppError(410, "CODE_EXPIRED", "This upload link has expired. Scan the new code.");
  }
  const ticket = await getTicket(app.db, link.ticketId);
  needsStarted(ticket);
  return { link, ticket };
}

export async function uploadInfo(app: FastifyInstance, code: string): Promise<UploadInfoResponse> {
  const { link, ticket } = await usableLink(app, code);
  return {
    plate: ticket.plate,
    language: ticket.language,
    expiresAt: link.expiresAt.toISOString(),
  };
}

/** A warning, not a block: the same invoice number from the same supplier on another ticket. */
async function warnIfDuplicate(
  tx: Transaction,
  ticket: TicketRow,
  invoiceNo: string,
  supplier: string,
): Promise<void> {
  const number = invoiceNo.toLowerCase();
  const name = supplier.toLowerCase();
  // So two uploads of one invoice at the same moment cannot both look like the first.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${name}:${number}`}))`);
  const [other] = await tx
    .select({ ticketNo: tickets.ticketNo })
    .from(tickets)
    .where(
      and(
        ne(tickets.id, ticket.id),
        // A ticket the driver walked away from did not use the invoice. One the store
        // officer cancelled after a weighing did.
        or(ne(tickets.status, "ABANDONED"), isNotNull(tickets.firstWeightAt)),
        sql`lower(${tickets.invoiceNo}) = ${number}`,
        sql`lower(${tickets.supplier}) = ${name}`,
      ),
    )
    .limit(1);
  if (!other) return;
  await addEvent(tx, ticket.id, "INVOICE_DUPLICATE", "system", {
    message: `Invoice ${invoiceNo} from ${supplier} was already used on ticket ${other.ticketNo}.`,
    otherTicketNo: other.ticketNo,
  });
  emitAfterCommit("ticket:updated", ["store"], { ticketId: ticket.id, status: ticket.status });
}

/**
 * True if another file was uploaded after this one: its result is the one that counts.
 * The ticket must be locked.
 */
async function isSuperseded(tx: Transaction, ticketId: number, photoId: string) {
  const [newest] = await tx
    .select({ data: ticketEvents.data })
    .from(ticketEvents)
    .where(and(eq(ticketEvents.ticketId, ticketId), eq(ticketEvents.type, "INVOICE_RECEIVED")))
    .orderBy(desc(ticketEvents.id))
    .limit(1);
  return newest?.data.photoId !== photoId;
}

/** The store officer who uploads for a driver without a phone, and the driver's call. */
interface ForDriver {
  officerId: number;
  helpId: number;
}

/**
 * The bill the store officer uploaded has been read, so the weighbridge goes on: the
 * driver's call for help is answered, in the officer's name.
 */
async function answerHelpCall(
  tx: Transaction,
  ticket: TicketRow,
  { officerId, helpId }: ForDriver,
  photoId: string,
): Promise<void> {
  const reason = "Bill uploaded for the driver";
  const [answered] = await tx
    .update(approvals)
    .set({ status: "APPROVED", decidedBy: officerId, decidedAt: new Date(), reason })
    .where(and(eq(approvals.id, helpId), eq(approvals.status, "PENDING")))
    .returning({ id: approvals.id });
  // Already marked as handled while the bill was being read.
  if (!answered) return;
  await markHandled(tx, ticket, userActor(officerId), {
    approvalId: helpId,
    kind: "DRIVER_HELP",
    decision: "APPROVE",
    reason,
    photoId,
  });
  emitAfterCommit("approval:decided", ["kiosk", "store"], {
    approvalId: helpId,
    ticketId: ticket.id,
    kind: "DRIVER_HELP",
    status: "APPROVED",
  });
}

/** Saves what was read on the ticket. A new upload replaces the earlier invoice. */
async function saveInvoice(
  app: FastifyInstance,
  ticketId: number,
  photoId: string,
  read: InvoiceRead,
  forDriver?: ForDriver,
): Promise<void> {
  const demo = (await isDemoActive(app.db, app.hardware)) || read.source === "demo";

  await app.eventTransaction(async (tx) => {
    let ticket = await lockTicket(tx, ticketId);
    // The driver may have been weighed, have left, or have pressed "No invoice" while the
    // invoice was being read.
    if (ticket.status !== "STARTED" || ticket.noInvoice) return;
    if (await isSuperseded(tx, ticketId, photoId)) return;

    // A material chosen before must still agree with this invoice, or it is asked again.
    // Not if the store officer chose it.
    const list = await tx.select().from(materials);
    const [storeChoice] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.ticketId, ticketId),
          eq(approvals.kind, "MISMATCH"),
          eq(approvals.status, "APPROVED"),
        ),
      );
    const onInvoice = read.material.matched
      ? list.find((material) => material.name === read.material.matched)
      : read.material.raw
        ? matchMaterial(read.material.raw, list)?.material
        : undefined;
    const askAgain =
      !storeChoice &&
      ticket.materialId !== null &&
      onInvoice !== undefined &&
      onInvoice.id !== ticket.materialId;

    const supplier = read.supplier.matched ?? read.supplier.raw;
    ticket = await updateTicket(tx, ticket, {
      invoiceNo: read.invoiceNo,
      invoiceMaterial: read.material.matched ?? read.material.raw,
      invoiceDate: read.invoiceDate,
      invoiceWeightKg: read.weightKg,
      ...(supplier ? { supplier } : {}),
      // The vehicle list comes first for the transporter.
      transporter: ticket.transporter ?? read.transporter.matched ?? read.transporter.raw,
      ...(askAgain ? { materialId: null } : {}),
    });
    ticket = await tagDemo(tx, ticket, demo);

    await addEvent(tx, ticketId, "INVOICE_READ", "system", {
      photoId,
      source: read.source,
      model: read.model,
      invoiceNo: read.invoiceNo,
      material: ticket.invoiceMaterial,
      supplier,
      weightKg: read.weightKg,
      vehiclePlate: read.vehicle.plate,
      warnings: read.warnings.map((warning) => warning.code),
      materialAskedAgain: askAgain,
    });
    const vehicle = read.warnings.find((warning) => warning.code === "VEHICLE_MISMATCH");
    if (vehicle) {
      await addEvent(tx, ticketId, "INVOICE_VEHICLE_MISMATCH", "system", {
        message: vehicle.message,
      });
      emitAfterCommit("ticket:updated", ticketRooms(ticket), {
        ticketId,
        status: ticket.status,
      });
    }
    if (read.invoiceNo && supplier) {
      await warnIfDuplicate(tx, ticket, read.invoiceNo, supplier);
    }
    if (forDriver) await answerHelpCall(tx, ticket, forDriver, photoId);
    // The store officer's page follows the reading too.
    emitAfterCommit("invoice:read", ["kiosk"], { ticketId, ok: true, error: null });
    emitAfterCommit("ticket:updated", ["store"], { ticketId, status: ticket.status });
  });
}

/** Gives a code back, unless the kiosk has shown a newer one since. */
async function releaseCode(app: FastifyInstance, linkId: number, ticketId: number) {
  const [newest] = await app.db
    .select({ id: uploadLinks.id })
    .from(uploadLinks)
    .where(eq(uploadLinks.ticketId, ticketId))
    .orderBy(desc(uploadLinks.id))
    .limit(1);
  if (newest?.id !== linkId) return;
  await app.db.update(uploadLinks).set({ usedAt: null }).where(eq(uploadLinks.id, linkId));
}

/** Puts the failure on the ticket and tells the kiosk, so the driver can upload again. */
async function saveFailure(
  app: FastifyInstance,
  ticketId: number,
  photoId: string,
  error: string,
): Promise<void> {
  await app.eventTransaction(async (tx) => {
    const ticket = await lockTicket(tx, ticketId);
    if (ticket.status !== "STARTED" || (await isSuperseded(tx, ticketId, photoId))) return;
    await updateTicket(tx, ticket, {});
    await addEvent(tx, ticketId, "INVOICE_READ_FAILED", "system", { photoId, error });
    emitAfterCommit("invoice:read", ["kiosk"], { ticketId, ok: false, error });
    emitAfterCommit("ticket:updated", ["store"], { ticketId, status: ticket.status });
  });
}

/** The same codes an HTTP answer would have carried. */
const errorCode = (error: unknown) => {
  if (error instanceof ReaderError) return `READER_${error.code}`;
  return error instanceof AppError ? error.code : "INTERNAL_ERROR";
};

/** The slow part, after the uploader has its answer. */
async function readAndSave(
  app: FastifyInstance,
  ticketId: number,
  plate: string,
  file: StoredFile,
  options: { forDriver?: ForDriver; onFailure?: () => Promise<void> },
): Promise<void> {
  try {
    const read = await app.readers.readInvoice(file, plate);
    await saveInvoice(app, ticketId, file.id, read, options.forDriver);
  } catch (error) {
    const code = errorCode(error);
    if (code === "INTERNAL_ERROR") app.log.error({ err: error }, "could not read an invoice");
    else app.log.warn({ code }, "could not read an invoice");
    await options.onFailure?.();
    await saveFailure(app, ticketId, file.id, code);
  }
}

/**
 * Stores the file, notes it on the ticket and has it read in the background. The result or
 * the failure goes to the kiosk as "invoice:read".
 */
async function takeInvoiceFile(
  app: FastifyInstance,
  ticketId: number,
  upload: Upload,
  options: {
    actor: Actor;
    forDriver?: ForDriver;
    onFailure?: () => Promise<void>;
  },
): Promise<UploadResponse> {
  const ticket = await getTicket(app.db, ticketId);
  const file = await storeFile(
    { storage: app.storage, db: app.db },
    { data: upload.buffer, contentType: upload.contentType, kind: "INVOICE", ticketId },
  );
  await app.eventTransaction(async (tx) => {
    const locked = await lockTicket(tx, ticketId);
    needsStarted(locked);
    // Also counts as activity, so the ticket is not abandoned while we read. A file means
    // there is an invoice after all.
    await updateTicket(tx, locked, { noInvoice: false });
    await addEvent(tx, ticketId, "INVOICE_RECEIVED", options.actor, {
      photoId: file.id,
      ...(options.forDriver ? { forDriver: true } : {}),
    });
    // The kiosk shows "Reading invoice…".
    const change = { ticketId, status: locked.status };
    emitAfterCommit("ticket:updated", ["kiosk", "store"], change);
  });
  app.background.run("read invoice", () => readAndSave(app, ticketId, ticket.plate, file, options));
  return { ok: true, status: "received" };
}

/**
 * The driver's phone. The code works once: it is taken before anything slow, and given
 * back only if nothing could be saved or read.
 */
export async function receiveInvoice(
  app: FastifyInstance,
  code: string,
  readFile: () => Promise<Upload>,
): Promise<UploadResponse> {
  // Checked before the file is read, so a wrong code cannot make us take 8 MB.
  await usableLink(app, code);
  const upload = await readFile();

  const [claimed] = await app.db
    .update(uploadLinks)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(uploadLinks.codeHash, hashCode(code)),
        isNull(uploadLinks.usedAt),
        gt(uploadLinks.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!claimed) {
    throw new AppError(410, "CODE_USED", "This upload link has already been used.");
  }

  const giveBack = () => releaseCode(app, claimed.id, claimed.ticketId);
  try {
    return await takeInvoiceFile(app, claimed.ticketId, upload, {
      actor: "system",
      onFailure: giveBack,
    });
  } catch (error) {
    await giveBack();
    throw error;
  }
}

/** The driver's pending call for help, if a bill may be uploaded for it. */
async function helpCallFor(app: FastifyInstance, approvalId: number) {
  const [request] = await app.db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!request) throw new AppError(404, "NOT_FOUND", "There is no such request.");
  if (request.kind !== "DRIVER_HELP") {
    throw wrongStage("A bill can only be uploaded for a driver who asked for help.");
  }
  if (request.status !== "PENDING") {
    throw new AppError(409, "ALREADY_DECIDED", "This request has already been decided.");
  }
  if (request.ticketId === null) {
    throw wrongStage("This driver has not started a visit yet, so there is no ticket.");
  }
  needsStarted(await getTicket(app.db, request.ticketId));
  return request.ticketId;
}

/**
 * The store officer uploads the bill of a driver without a phone, from their own device.
 * It is read as the driver's own upload is, and the kiosk goes on by itself.
 */
export async function receiveStoreInvoice(
  app: FastifyInstance,
  approvalId: number,
  officerId: number,
  readFile: () => Promise<Upload>,
): Promise<UploadResponse> {
  // Checked before the file is read.
  const ticketId = await helpCallFor(app, approvalId);
  const upload = await readFile();
  return takeInvoiceFile(app, ticketId, upload, {
    actor: userActor(officerId),
    forDriver: { officerId, helpId: approvalId },
  });
}
