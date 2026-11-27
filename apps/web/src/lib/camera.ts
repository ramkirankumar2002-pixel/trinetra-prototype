// The phone's camera, opened inside the page.

/** The longest side of a photo that is sent. */
export const CAPTURE_MAX_SIDE = 1280;

/**
 * False where a page cannot open a camera at all: an old browser, or a page that is not
 * https (or localhost). Only then may the phone's own camera app be used instead.
 */
export const hasLiveCamera = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

export type CameraProblem = "denied" | "missing" | "busy" | "failed";

/** Why getUserMedia refused, by the error's name. */
export function cameraProblem(error: unknown): CameraProblem {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "failed";
}

/** The back camera, in the largest size it offers up to full HD. */
export const BACK_CAMERA: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
};
