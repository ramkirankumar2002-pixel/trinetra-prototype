// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_AFTER_MS, REMIND_AFTER_MS, useInactivity, useReturnAfter } from "./idle";

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const touch = () => act(() => void window.dispatchEvent(new Event("pointerdown")));

const setup = () =>
  renderHook(({ on, screen }) => useInactivity(on, screen), {
    initialProps: { on: true, screen: "material" },
  });

describe("a driver who stops answering", () => {
  it("is reminded after a minute and asked after three", () => {
    const { result } = setup();
    expect(REMIND_AFTER_MS).toBe(60_000);
    expect(ASK_AFTER_MS).toBe(180_000);
    wait(59_999);
    expect(result.current.stage).toBe("active");
    wait(1);
    expect(result.current.stage).toBe("remind");
    wait(120_000);
    expect(result.current.stage).toBe("ask");
  });

  it("starts the clock again at a touch", () => {
    const { result } = setup();
    wait(60_000);
    touch();
    expect(result.current.stage).toBe("active");
    wait(59_999);
    expect(result.current.stage).toBe("active");
  });

  it("keeps asking until a button answers", () => {
    const { result } = setup();
    wait(ASK_AFTER_MS);
    touch();
    expect(result.current.stage).toBe("ask");
    act(() => result.current.stay());
    expect(result.current.stage).toBe("active");
  });

  it("starts again on another screen, and says nothing where there is no question", () => {
    const { result, rerender } = setup();
    wait(60_000);
    rerender({ on: true, screen: "supplier" });
    expect(result.current.stage).toBe("active");
    rerender({ on: false, screen: "ready" });
    wait(ASK_AFTER_MS);
    expect(result.current.stage).toBe("active");
    // Coming back does not bring an old reminder with it.
    rerender({ on: true, screen: "supplier" });
    expect(result.current.stage).toBe("active");
  });
});

describe("a screen that goes away by itself", () => {
  it("leaves after its time without a touch", () => {
    const done = vi.fn();
    renderHook(() => useReturnAfter(15_000, done));
    wait(14_000);
    touch();
    wait(14_999);
    expect(done).not.toHaveBeenCalled();
    wait(1);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
