import { describe, expect, it } from "vitest";
import { LoginLockout } from "./lockout";

function clock() {
  let time = 1_000_000;
  return { now: () => time, pass: (seconds: number) => void (time += seconds * 1000) };
}

const failTimes = (lockout: LoginLockout, count: number) =>
  Array.from({ length: count }, () => lockout.start("amit").fail());

describe("LoginLockout", () => {
  it("locks on the fifth failure for 60 seconds", () => {
    const lockout = new LoginLockout(clock().now);
    expect(failTimes(lockout, 5)).toEqual([0, 0, 0, 0, 60]);
    expect(() => lockout.start("amit")).toThrow(/60 seconds/);
  });

  it("counts down, then allows five new attempts", () => {
    const time = clock();
    const lockout = new LoginLockout(time.now);
    failTimes(lockout, 5);

    time.pass(18);
    expect(() => lockout.start("amit")).toThrow(/42 seconds/);

    time.pass(42);
    expect(failTimes(lockout, 4)).toEqual([0, 0, 0, 0]);
  });

  it("forgets failures after a success", () => {
    const lockout = new LoginLockout(clock().now);
    failTimes(lockout, 4);
    lockout.start("amit").succeed();
    expect(failTimes(lockout, 4)).toEqual([0, 0, 0, 0]);
  });

  it("locks each username separately", () => {
    const lockout = new LoginLockout(clock().now);
    failTimes(lockout, 5);
    expect(() => lockout.start("ram")).not.toThrow();
  });

  it("gives no extra guesses to parallel attempts", () => {
    const lockout = new LoginLockout(clock().now);
    const running = Array.from({ length: 5 }, () => lockout.start("amit"));
    expect(() => lockout.start("amit")).toThrow(/Too many/);

    running.forEach((attempt) => attempt.cancel());
    expect(() => lockout.start("amit")).not.toThrow();
  });
});
