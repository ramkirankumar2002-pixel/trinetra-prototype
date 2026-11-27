import { afterEach, describe, expect, it, vi } from "vitest";
import { BACK_CAMERA, cameraProblem, hasLiveCamera } from "./camera";

describe("the camera", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the back camera, with no sound", () => {
    expect(BACK_CAMERA).toMatchObject({ audio: false });
    expect(BACK_CAMERA.video).toMatchObject({ facingMode: { ideal: "environment" } });
  });

  it("is only missing where the page cannot open one at all", () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => {} } });
    expect(hasLiveCamera()).toBe(true);
    vi.stubGlobal("navigator", {});
    expect(hasLiveCamera()).toBe(false);
  });

  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "missing"],
    ["NotReadableError", "busy"],
    ["TypeError", "failed"],
  ])("names %s", (name, problem) => {
    expect(cameraProblem({ name })).toBe(problem);
  });
});
