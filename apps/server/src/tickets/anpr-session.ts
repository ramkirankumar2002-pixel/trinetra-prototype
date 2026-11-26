// What the cameras have read for the truck on the bridge now. The backend remembers it, so
// a browser cannot claim that the plates matched, or skip the retries. Kept in memory: after
// a restart the kiosk simply reads the plate again.
import type { PlatesRead } from "@trinetra/shared";

/** The first read, then 2 retries while front and back differ. */
export const PLATE_ATTEMPTS = 3;
const FORGET_AFTER_MS = 10 * 60 * 1000;

/** The two cameras read something, but not the same plate. */
export function platesDisagree(read: PlatesRead): boolean {
  return !read.match && (read.cameras.front.plate !== null || read.cameras.back.plate !== null);
}

export interface PlateVisit {
  attempts: number;
  last: PlatesRead;
  /** Every photo taken of this truck: all of them are evidence. */
  photoIds: string[];
}

export class AnprSession {
  private visit: (PlateVisit & { at: number }) | undefined;
  /** A read is running. The cameras and plate services are asked one truck at a time. */
  busy = false;

  constructor(private readonly now: () => number = Date.now) {}

  record(read: PlatesRead): PlateVisit {
    const previous = this.current();
    const photoIds = [read.cameras.front.photoId, read.cameras.back.photoId].filter(
      (id): id is string => id !== null,
    );
    this.visit = {
      attempts: (previous?.attempts ?? 0) + 1,
      last: read,
      photoIds: [...(previous?.photoIds ?? []), ...photoIds],
      at: this.now(),
    };
    return this.visit;
  }

  current(): PlateVisit | undefined {
    if (this.visit && this.now() - this.visit.at > FORGET_AFTER_MS) this.visit = undefined;
    return this.visit;
  }

  /** The truck has left, or its ticket has started. */
  clear(): void {
    this.visit = undefined;
  }
}
