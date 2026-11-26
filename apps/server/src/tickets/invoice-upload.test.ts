import { createHash } from "node:crypto";
import type {
  CreateTicketResponse,
  TicketView,
  UploadInfoResponse,
  UploadLinkResponse,
  UploadResponse,
} from "@trinetra/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { photos, uploadLinks } from "../db/schema";
import { ReaderError } from "../services/readers/errors";
import { testDatabaseUrl } from "../test/env";
import { OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("invoice upload", { timeout: 30_000 }, () => {
  const h = useTicketHarness();

  async function newTicket(plate = PLATE) {
    const response = await h.call<CreateTicketResponse>("kiosk", "POST", "/api/tickets", {
      plate,
      language: "hi",
      manual: true,
    });
    return response.body.ticket.id;
  }
  const link = (ticketId: number) =>
    h.call<UploadLinkResponse>("kiosk", "POST", `/api/tickets/${ticketId}/upload-link`);

  async function send(code: string, file?: { data: Buffer; type: string } | null) {
    const body = h.form(file === undefined ? { data: await h.jpeg(), type: "image/jpeg" } : file);
    return h.call<UploadResponse>(null, "POST", `/api/upload/${code}`, body.payload, body.headers);
  }

  async function uploadFor(ticketId: number) {
    return send((await link(ticketId)).body.code);
  }

  const view = async (ticketId: number) =>
    (await h.call<TicketView>("kiosk", "GET", `/api/tickets/${ticketId}`)).body;

  describe("the link", () => {
    it("is for the logged-in kiosk only", async () => {
      await h.expectRoles("POST", "/api/tickets/1/upload-link", ["kiosk"]);
    });

    it("gives a code and the phone address, and stores only a hash", async () => {
      const id = await newTicket();
      const { status, body } = await link(id);
      expect(status).toBe(200);
      expect(body.url).toBe(`http://localhost:3000/upload/${body.code}`);
      const tenMinutes = new Date(body.expiresAt).getTime() - Date.now();
      expect(tenMinutes).toBeGreaterThan(9 * 60_000);
      expect(tenMinutes).toBeLessThanOrEqual(10 * 60_000);

      const [row] = await h.db.select().from(uploadLinks);
      expect(row!.codeHash).toBe(createHash("sha256").update(body.code).digest("hex"));
      expect(JSON.stringify(row)).not.toContain(body.code);
    });

    it("answers 404, 400 and 409", async () => {
      expect((await link(999)).status).toBe(404);
      expect((await h.call("kiosk", "POST", "/api/tickets/x/upload-link")).status).toBe(400);
      const id = await newTicket();
      await h.db.execute("update tickets set status = 'READY_FOR_SECOND'");
      expect((await link(id)).body.error?.code).toBe("WRONG_STAGE");
    });

    it("replaces the earlier one", async () => {
      const id = await newTicket();
      const old = (await link(id)).body.code;
      await link(id);
      expect((await h.call(null, "GET", `/api/upload/${old}`)).body.error?.code).toBe(
        "CODE_EXPIRED",
      );
    });
  });

  describe("GET /api/upload/:code", () => {
    it("tells the phone the plate and language, and nothing private", async () => {
      const id = await newTicket();
      await h.call("kiosk", "PATCH", `/api/tickets/${id}/details`, {
        driverName: "Ravi",
        driverPhone: "9876543210",
      });
      const { code } = (await link(id)).body;
      const { status, body } = await h.call<UploadInfoResponse>(null, "GET", `/api/upload/${code}`);
      expect(status).toBe(200);
      expect(Object.keys(body).sort()).toEqual(["expiresAt", "language", "plate"]);
      expect(body.plate).toBe(PLATE);
    });

    it.each(["short", "no-such-code-at-all-000000000000"])("refuses %s", async (code) => {
      const response = await h.call(null, "GET", `/api/upload/${code}`);
      expect(response.status).toBe(404);
      expect(response.body.error?.code).toBe("INVALID_CODE");
      expect((await send(code)).status).toBe(404);
    });

    it("refuses an expired code, for both routes", async () => {
      const { code } = (await link(await newTicket())).body;
      await h.db.update(uploadLinks).set({ expiresAt: new Date(Date.now() - 1000) });
      expect((await h.call(null, "GET", `/api/upload/${code}`)).status).toBe(410);
      expect((await send(code)).body.error?.code).toBe("CODE_EXPIRED");
    });
  });

  describe("POST /api/upload/:code", () => {
    it("reads the invoice and saves it on the ticket, once", async () => {
      h.invoiceReads();
      const id = await newTicket();
      const { code } = (await link(id)).body;
      const response = await send(code);

      expect(response).toMatchObject({ status: 200, body: { ok: true, warnings: [] } });
      expect(await view(id)).toMatchObject({
        invoice: {
          number: "INV-1",
          material: "Cement Bags",
          date: "2026-11-26",
          weightKg: 14_310,
        },
        supplier: "Sample Cement Depot",
        isDemo: false,
      });
      expect(await h.db.select().from(photos).where(eq(photos.kind, "INVOICE"))).toHaveLength(1);

      const again = await send(code);
      expect(again.status).toBe(410);
      expect(again.body.error?.code).toBe("CODE_USED");
    });

    it("takes the file only once when two arrive together", async () => {
      h.invoiceReads();
      const { code } = (await link(await newTicket())).body;
      const answers = await Promise.all([send(code), send(code)]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 410]);
    });

    it.each([
      ["no file", null, 400],
      ["text", { data: Buffer.from("hello"), type: "text/plain" }, 415],
      ["text called a photo", { data: Buffer.from("hello"), type: "image/jpeg" }, 415],
      ["a file over 8 MB", { data: Buffer.alloc(8 * 1024 * 1024 + 1), type: "image/jpeg" }, 413],
    ])("refuses %s and keeps the code usable", async (_what, file, status) => {
      h.invoiceReads();
      const { code } = (await link(await newTicket())).body;
      expect((await send(code, file)).status).toBe(status);
      expect((await send(code)).status).toBe(200);
    });

    it("keeps the code usable when the reader fails", async () => {
      const id = await newTicket();
      const { code } = (await link(id)).body;
      h.app.readers.readInvoice = async () => {
        throw new ReaderError("gemini", "BUSY", "busy");
      };
      const failed = await send(code);
      expect(failed.status).toBe(502);
      expect(failed.body.error?.code).toBe("READER_BUSY");

      h.invoiceReads();
      expect((await send(code)).status).toBe(200);
    });

    it("warns when the invoice names another truck", async () => {
      h.invoiceReads({ vehicle_number: OTHER_PLATE });
      const id = await newTicket();
      expect((await uploadFor(id)).body.warnings).toEqual(["VEHICLE_MISMATCH"]);
      const ticket = await view(id);
      expect(ticket.warnings).toMatchObject([{ type: "INVOICE_VEHICLE_MISMATCH" }]);
      // A warning, not a block.
      expect(ticket.status).toBe("STARTED");
    });

    it("warns about the same invoice number from the same supplier", async () => {
      h.invoiceReads();
      const first = await newTicket();
      await uploadFor(first);
      const second = await newTicket(OTHER_PLATE);
      h.invoiceReads({ invoice_number: "inv-1", vehicle_number: OTHER_PLATE });
      await uploadFor(second);

      expect((await view(second)).warnings).toMatchObject([{ type: "DUPLICATE_INVOICE" }]);
      expect(await h.eventTypes(first)).not.toContain("INVOICE_DUPLICATE");
      const store = await h.call<{ warnings: unknown[] }>("store", "GET", "/api/store/requests");
      if (store.status === 200) expect(store.body.warnings).toHaveLength(1);
    });

    it("does not warn for another supplier", async () => {
      h.invoiceReads();
      await uploadFor(await newTicket());
      const second = await newTicket(OTHER_PLATE);
      h.invoiceReads({ supplier: "Shree Ram Crushers", vehicle_number: OTHER_PLATE });
      await uploadFor(second);
      expect((await view(second)).warnings).toEqual([]);
    });

    it("asks for the material again if the new invoice disagrees with it", async () => {
      const id = await newTicket();
      await h.call("kiosk", "PATCH", `/api/tickets/${id}/details`, { material: "Sand" });
      h.invoiceReads();
      await uploadFor(id);
      expect((await view(id)).material).toBeNull();
    });
  });
});
