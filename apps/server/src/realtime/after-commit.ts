// Live events that announce database changes are sent only once the change is saved.
//
//   await app.eventTransaction(async (tx) => {
//     await tx.update(tickets)...;
//     emitAfterCommit("ticket:updated", ["kiosk", "store"], { ticketId, status });
//   });
//
// If the transaction rolls back, for any reason, nothing is sent.
import { AsyncLocalStorage } from "node:async_hooks";
import type { RealtimeEventName, RealtimeEvents, Room } from "@trinetra/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../db/client";
import { assertAudience, type OutgoingEvent, type Publish } from "./publish";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface Scope {
  tx: Transaction;
  queue: OutgoingEvent[];
  /** False once the work is done: a later call would never be sent. */
  open: boolean;
}

const scopes = new AsyncLocalStorage<Scope>();

const openScope = () => {
  const scope = scopes.getStore();
  return scope?.open ? scope : undefined;
};

/** Queues an event for when the current transaction commits. Throws if there is none. */
export function emitAfterCommit<Name extends RealtimeEventName>(
  event: Name,
  rooms: readonly Room[],
  payload: RealtimeEvents[Name],
): void {
  const scope = openScope();
  if (!scope) {
    throw new Error(`emitAfterCommit("${event}") was called outside eventTransaction().`);
  }
  // Checked now, so a mistake rolls the change back instead of being found after saving.
  assertAudience(event, rooms);
  // Copies: later changes to the caller's objects do not change what is sent.
  scope.queue.push({ event, rooms: [...rooms], payload: structuredClone(payload) });
}

export function createEventTransaction(db: Database, publish: Publish, log: FastifyBaseLogger) {
  return async function eventTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    // Inside another one, this is a savepoint: its events wait for the outer commit,
    // and are dropped alone if only this part rolls back.
    const parent = openScope();
    const queue: OutgoingEvent[] = [];

    const result = await (parent?.tx ?? db).transaction(async (tx) => {
      const scope: Scope = { tx, queue, open: true };
      try {
        return await scopes.run(scope, () => work(tx));
      } finally {
        scope.open = false;
      }
    });
    // Reaching here means the commit (or the savepoint) succeeded.

    if (parent) {
      parent.queue.push(...queue);
      return result;
    }
    for (const { event, rooms, payload } of queue) {
      try {
        publish(event, rooms, payload);
      } catch (error) {
        // The change is saved, so the caller must not be told it failed.
        // A screen that misses an event reloads its data when it reconnects.
        log.error({ err: error, event }, "could not send a live event");
      }
    }
    return result;
  };
}

export type EventTransaction = ReturnType<typeof createEventTransaction>;
