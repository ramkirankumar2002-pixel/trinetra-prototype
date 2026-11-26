// Brings a ticket to the step a test needs, through the API as the kiosk would.
import type { CreateTicketResponse, TicketView } from "@trinetra/shared";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { tickets } from "../db/schema";
import { PLATE, type TicketHarness } from "./ticket-harness";

export const LOADED = 32_560;
/** The truck after unloading 14,310 kg. */
export const EMPTY = 18_250;

export interface TruckOptions {
  plate?: string;
  material?: string;
  /** What the invoice says, in kg. Null: no invoice was read. */
  invoiceKg?: number | null;
}

export function flows(h: TicketHarness) {
  const view = async (id: number) =>
    (await h.call<TicketView>("store", "GET", `/api/tickets/${id}`)).body;

  const post = <T = TicketView>(id: number, action: string, body?: unknown) =>
    h.call<T>("kiosk", "POST", `/api/tickets/${id}/${action}`, body);

  /** A STARTED ticket with its material chosen. Cement is Type 1, Bricks Type 3. */
  async function started(options: TruckOptions = {}): Promise<number> {
    const { plate = PLATE, material = "Bricks", invoiceKg = 14_310 } = options;
    const created = await h.call<CreateTicketResponse>("kiosk", "POST", "/api/tickets", {
      plate,
      language: "en",
      manual: true,
    });
    expect(created.status).toBe(201);
    const id = created.body.ticket.id;
    await h.db.update(tickets).set({ invoiceWeightKg: invoiceKg }).where(eq(tickets.id, id));
    const details = await h.call("kiosk", "PATCH", `/api/tickets/${id}/details`, { material });
    expect(details.status).toBe(200);
    return id;
  }

  /** Weighed once with `kg` on the bridge. */
  async function weighed(options: TruckOptions & { kg?: number } = {}): Promise<number> {
    const id = await started(options);
    await h.settle(options.kg ?? LOADED);
    const response = await post(id, "first-weight");
    expect(response.body.error).toBeUndefined();
    return id;
  }

  async function secondWeight(id: number, kg = EMPTY) {
    await h.settle(kg);
    return post(id, "second-weight");
  }

  /** The pending request of a ticket. */
  async function pending(ticketId: number, kind: string): Promise<number> {
    const row = (await h.approvalRows()).find(
      (item) => item.ticketId === ticketId && item.kind === kind && item.status === "PENDING",
    );
    expect(row, `a pending ${kind} request`).toBeDefined();
    return row!.id;
  }

  return { view, post, started, weighed, secondWeight, pending };
}
