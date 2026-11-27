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
    const { ringForTruck, unlockSound, VIBRATION } = await import("./alerts");

    ringForTruck();
    expect(vibrate).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();

    unlockSound();
    ringForTruck();
    expect(vibrate).toHaveBeenCalledWith(VIBRATION);
    expect(started).toHaveBeenCalledTimes(2);
  });
});

describe("the tap that turns the sound on", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("leaves the page as it is until the press is over, then says the sound is on", async () => {
    vi.useFakeTimers();
    const { unlockSound, soundIsOn, subscribeSound, HINT_STAYS_MS } = await import("./alerts");
    const changed = vi.fn();
    subscribeSound(changed);

    unlockSound();
    // Nothing on the page may move while the finger is on a button.
    expect(soundIsOn()).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HINT_STAYS_MS - 1);
    expect(soundIsOn()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(soundIsOn()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);

    // Later taps change nothing.
    unlockSound();
    vi.advanceTimersByTime(HINT_STAYS_MS);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("is turned on by the end of a press, never its start", async () => {
    const { SOUND_EVENTS } = await import("./alerts");
    expect(SOUND_EVENTS).toEqual(["pointerup", "keydown"]);
  });
});
