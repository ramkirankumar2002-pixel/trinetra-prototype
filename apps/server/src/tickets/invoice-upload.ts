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
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Env } from "../config/env";
import { UPLOAD_LINK_MS } from "../config/limits";
import { approvals, materials, tickets, uploadLinks } from "../db/schema";
import { AppError } from "../errors/app-error";
import type { Upload } from "../http/upload";
import { emitAfterCommit, type Transaction } from "../realtime/after-commit";
import { storeFile } from "../services/images/pipeline";
import { isDemoActive, tagDemo } from "./demo";
import {
  addEvent,
  getTicket,
  lockTicket,
  ticketRooms,
  updateTicket,
  wrongStage,
  type Actor,
  type TicketRow,
} from "./repo";

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

const needsStarted = (ticket: TicketRow) => {
  if (ticket.status !== "STARTED") {
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
    url: `${env.FRONTEND_ORIGIN}/upload/${code}`,
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
        // A ticket the driver walked away from did not use the invoice.
        ne(tickets.status, "ABANDONED"),
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

/** Saves what was read on the ticket. A new upload replaces the earlier invoice. */
async function saveInvoice(
  app: FastifyInstance,
  ticketId: number,
  photoId: string,
  read: InvoiceRead,
): Promise<void> {
  const demo = (await isDemoActive(app.db, app.hardware)) || read.source === "demo";

  await app.eventTransaction(async (tx) => {
    let ticket = await lockTicket(tx, ticketId);
    needsStarted(ticket);

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
    emitAfterCommit("invoice:read", ["kiosk"], { ticketId });
  });
}

/**
 * Stores the file, reads it and saves the fields. The code works once: it is taken before
 * the slow reading, and given back only if nothing was saved, so the driver can try again.
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

  try {
    const ticket = await getTicket(app.db, claimed.ticketId);
    // Reading can take a while, and must not let the ticket be abandoned meanwhile.
    await app.db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, ticket.id));
    const file = await storeFile(
      { storage: app.storage, db: app.db },
      {
        data: upload.buffer,
        contentType: upload.contentType,
        kind: "INVOICE",
        ticketId: ticket.id,
      },
    );
    const read = await app.readers.readInvoice(file, ticket.plate);
    await saveInvoice(app, ticket.id, file.id, read);
    return { ok: true, warnings: read.warnings.map((warning) => warning.code) };
  } catch (error) {
    await app.db.update(uploadLinks).set({ usedAt: null }).where(eq(uploadLinks.id, claimed.id));
    throw error;
  }
}
