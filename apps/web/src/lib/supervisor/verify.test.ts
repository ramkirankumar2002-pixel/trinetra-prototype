import type { PhotoView, TicketView } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import {
  firstWeightFrontPhoto,
  photosLeft,
  reasonIsLongEnough,
  typedPlateMatches,
  isDemoReading,
} from "./verify";

const photo = (id: string, kind: PhotoView["kind"], takenAt: string): PhotoView => ({
  id,
  kind,
  takenAt,
  url: `/api/files/${id}.jpg`,
});

const ticket = (photos: PhotoView[]) =>
  ({ firstWeightAt: "2026-11-27T05:00:00.000Z", photos }) as unknown as TicketView;

describe("the verify page", () => {
  it("shows the front photo of the first weighing, not one of a later visit", () => {
    const shown = firstWeightFrontPhoto(
      ticket([
        photo("a", "FRONT_PLATE", "2026-11-27T04:50:00.000Z"),
        photo("b", "FRONT_PLATE", "2026-11-27T04:55:00.000Z"),
        photo("c", "BACK_PLATE", "2026-11-27T04:55:00.000Z"),
        photo("d", "FRONT_PLATE", "2026-11-27T06:00:00.000Z"),
      ]),
    );
    expect(shown?.id).toBe("b");
    expect(firstWeightFrontPhoto(ticket([]))).toBeUndefined();
  });

  it("counts the photos left", () => {
    const own = (id: string) => photo(id, "SUPERVISOR", "2026-11-27T05:10:00.000Z");
    expect(photosLeft(ticket([]))).toBe(3);
    expect(photosLeft(ticket([own("a"), own("b"), own("c"), own("d")]))).toBe(0);
  });

  it("needs 10 letters of reason, spaces at the ends not counted", () => {
    expect(reasonIsLongEnough("too short ")).toBe(false);
    expect(reasonIsLongEnough("plate muddy")).toBe(true);
    expect(reasonIsLongEnough("          ")).toBe(false);
  });

  it("compares a typed plate without spaces or dashes", () => {
    expect(typedPlateMatches("mh 12-ab 1234", "MH12AB1234")).toBe(true);
    expect(typedPlateMatches("MH12AB1235", "MH12AB1234")).toBe(false);
  });
});

describe("a photo that demo mode did not read", () => {
  const ticket = {
    timeline: [
      { type: "SUPERVISOR_PHOTO", data: { photoId: "a", source: "demo" } },
      { type: "SUPERVISOR_PHOTO", data: { photoId: "b", source: "plate_recognizer" } },
    ],
  } as unknown as Parameters<typeof isDemoReading>[0];

  it("is told apart from one that was read", () => {
    expect(isDemoReading(ticket, "a")).toBe(true);
    expect(isDemoReading(ticket, "b")).toBe(false);
    expect(isDemoReading(ticket, null)).toBe(false);
  });
});
