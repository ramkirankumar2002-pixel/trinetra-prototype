// What the verify page shows for a truck, worked out from the ticket the backend sent.
import {
  MAX_SUPERVISOR_PHOTOS,
  OVERRIDE_REASON_MIN,
  normalizePlate,
  type ApprovalView,
  type PhotoView,
  type TicketView,
} from "@trinetra/shared";

/** The supervisor's check of this ticket. */
export const supervisorCheck = (ticket: TicketView): ApprovalView | undefined =>
  ticket.approvals.filter((row) => row.kind === "SUPERVISOR").at(-1);

export const photoById = (ticket: TicketView, id: string | null | undefined) =>
  id ? ticket.photos.find((photo) => photo.id === id) : undefined;

/** The front camera's photo at the first weighing (not one from a later visit). */
export function firstWeightFrontPhoto(ticket: TicketView): PhotoView | undefined {
  const until = ticket.firstWeightAt ? Date.parse(ticket.firstWeightAt) : Number.POSITIVE_INFINITY;
  const front = ticket.photos.filter((photo) => photo.kind === "FRONT_PLATE");
  return front.filter((photo) => Date.parse(photo.takenAt) <= until).at(-1) ?? front[0];
}

export const photosLeft = (ticket: TicketView) =>
  Math.max(
    0,
    MAX_SUPERVISOR_PHOTOS - ticket.photos.filter((photo) => photo.kind === "SUPERVISOR").length,
  );

/** The backend checks this too: it only decides whether the button can be pressed. */
export const reasonIsLongEnough = (reason: string) => reason.trim().length >= OVERRIDE_REASON_MIN;

export const typedPlateMatches = (typed: string, plate: string) => normalizePlate(typed) === plate;

/** Someone has already answered this truck's check, or it has moved on. */
export const SOMEONE_ELSE = new Set(["WRONG_STAGE", "ALREADY_DECIDED"]);
