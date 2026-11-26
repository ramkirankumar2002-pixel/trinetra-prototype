// "Every ticket made while any switch is on Simulated / Pick is tagged demo."
import type { Hardware } from "../hardware";
import type { Transaction } from "../realtime/after-commit";
import { loadReaderModes } from "../services/readers/modes";
import { updateTicket, type Reader, type TicketRow } from "./repo";

/** True while any demo replacement is switched on. */
export async function isDemoActive(db: Reader, hardware: Hardware): Promise<boolean> {
  if (hardware.simulatedWeight.current()) return true;
  const modes = await loadReaderModes(db);
  return modes.anpr_mode === "pick" || modes.ocr_mode === "pick";
}

/** Once demo, always demo: the tag is never removed. */
export async function tagDemo(tx: Transaction, ticket: TicketRow, demo: boolean) {
  return demo && !ticket.isDemo ? updateTicket(tx, ticket, { isDemo: true }) : ticket;
}
