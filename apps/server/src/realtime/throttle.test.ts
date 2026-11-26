import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { throttle } from "./throttle";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Requests a send for value 1, 2, 3, ... at the given gaps and records what is sent. */
function run(gaps: number[], interval = 200) {
  let value = 0;
  const sent: { at: number; value: number }[] = [];
  const start = Date.now();
  const throttled = throttle(
    () => sent.push({ at: Date.now() - start, value }),
    interval,
    () => Date.now(),
  );
  for (const gap of gaps) {
    vi.advanceTimersByTime(gap);
    value += 1;
    throttled.request();
  }
  return { sent, throttled, finish: () => vi.advanceTimersByTime(1000) };
}

const times = (count: number, gap: number) => Array<number>(count).fill(gap);

describe("throttle", () => {
  it("sends at most 5 times in any second, however fast the readings come", () => {
    const { sent, finish } = run(times(300, 10));
    finish();

    for (const { at } of sent) {
      expect(sent.filter((s) => s.at >= at && s.at < at + 1000).length).toBeLessThanOrEqual(5);
    }
    expect(sent.length).toBeGreaterThanOrEqual(15);
  });

  it("sends the first reading at once", () => {
    expect(run([0]).sent).toEqual([{ at: 0, value: 1 }]);
  });

  it("always delivers the newest value in the end", () => {
    const { sent, finish } = run([0, 10, 10, 10]);
    expect(sent.map((s) => s.value)).toEqual([1]);
    finish();
    expect(sent).toEqual([
      { at: 0, value: 1 },
      { at: 200, value: 4 },
    ]);
  });

  it("delays, and does not drop, readings that come a moment early", () => {
    // An ESP32 sending "every 200 ms" is sometimes a little early or late.
    const { sent, finish } = run([0, 199, 201, 198, 202, 199, 201]);
    finish();
    expect(sent.map((s) => s.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("does not add its own delay to slow readings", () => {
    const { sent } = run([0, 500, 500]);
    expect(sent.map((s) => s.at)).toEqual([0, 500, 1000]);
  });

  it("can be cancelled while waiting, and used again", () => {
    const { sent, throttled, finish } = run([0, 10]);
    throttled.cancel();
    finish();
    expect(sent).toHaveLength(1);
    throttled.request();
    expect(sent).toHaveLength(2);
  });
});
