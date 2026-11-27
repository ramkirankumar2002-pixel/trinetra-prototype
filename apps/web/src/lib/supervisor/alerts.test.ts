import { afterEach, describe, expect, it, vi } from "vitest";

describe("a new truck", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("is news only if it was not in the list before, and not on the first list", async () => {
    const { newArrivals } = await import("./alerts");
    expect(newArrivals(null, [1, 2])).toEqual([]);
    expect(newArrivals(new Set([1, 2]), [1, 2])).toEqual([]);
    expect(newArrivals(new Set([1]), [2, 1, 3])).toEqual([2, 3]);
  });

  it("puts the number waiting in the tab's title", async () => {
    const { tabTitle } = await import("./alerts");
    expect(tabTitle(2)).toBe("(2) Trinetra");
    expect(tabTitle(0)).toBe("Trinetra");
  });

  it("makes no sound and no vibration before the first tap", async () => {
    const vibrate = vi.fn();
    const started = vi.fn();
    const node = () => ({
      frequency: { value: 0 },
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: (next: unknown) => next,
      start: started,
      stop: () => {},
    });
    class FakeAudio {
      state = "running";
      currentTime = 0;
      destination = {};
      createOscillator = node;
      createGain = node;
    }
    vi.stubGlobal("window", { AudioContext: FakeAudio });
    vi.stubGlobal("navigator", { vibrate });
    const { ringForTruck, unlockSound, soundIsOn, VIBRATION } = await import("./alerts");

    ringForTruck();
    expect(vibrate).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();

    unlockSound();
    expect(soundIsOn()).toBe(true);
    ringForTruck();
    expect(vibrate).toHaveBeenCalledWith(VIBRATION);
    expect(started).toHaveBeenCalledTimes(2);
  });
});
