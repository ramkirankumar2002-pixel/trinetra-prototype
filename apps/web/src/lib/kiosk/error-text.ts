// The driver never sees the backend's English message: each error code gets simple words
// in the driver's language.
import type { MessageKey } from "@/i18n/translate";
import type { ApiError } from "../api";

const BY_CODE: Record<string, MessageKey> = {
  NETWORK_ERROR: "kiosk.error.network",
  SERVER_UNREACHABLE: "kiosk.error.network",
  // Why the weighbridge cannot be used now.
  SETTINGS_NOT_LOADED: "kiosk.weigh.starting",
  WEIGHBRIDGE_FAULT: "kiosk.fault.title",
  DEVICE_OFFLINE: "kiosk.weigh.offline",
  STALE_READING: "kiosk.weigh.waiting",
  NO_TRUCK: "kiosk.weigh.noTruck",
  POSITION_NOT_OK: "kiosk.position.title",
  NOT_STABLE: "kiosk.weigh.stayStill",
  ANPR_IN_PROGRESS: "kiosk.plate.reading",
  NOT_APPROVED_EARLIER: "kiosk.notApprovedEarlier.title",
  INVOICE_WEIGHT_REQUIRED: "kiosk.error.invoiceNeeded",
  INVOICE_WEIGHT_INVALID: "kiosk.error.invoiceNeeded",
  WAITING_FOR_SUPERVISOR: "kiosk.visit2.waiting",
  NOT_APPROVED: "kiosk.blocked.title",
  ALREADY_LOADED: "kiosk.error.alreadyLoaded",
};

export const kioskErrorKey = (error: Pick<ApiError, "code">): MessageKey =>
  BY_CODE[error.code] ?? "kiosk.error.generic";
