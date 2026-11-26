import { MAX_PIN_FAILURES, PIN_LOCK_SECONDS } from "../config/limits";
import { AppError } from "../errors/app-error";

interface State {
  failures: number;
  /** Attempts still being checked. Counted, so parallel requests cannot get extra guesses. */
  checking: number;
  lockedUntil: number;
}

export function lockedError(secondsLeft: number): AppError {
  return new AppError(429, "LOCKED", `Too many wrong PINs. Try again in ${secondsLeft} seconds.`, {
    secondsLeft,
  });
}

export interface Attempt {
  succeed(): void;
  /** Returns the seconds left if this failure locked the username, otherwise 0. */
  fail(): number;
  /** The PIN could not be checked (e.g. the database failed): count nothing. */
  cancel(): void;
}

/**
 * Locks a username after too many wrong PINs. Kept in memory: a server restart clears it,
 * which is fine for one server.
 */
export class LoginLockout {
  private readonly states = new Map<string, State>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Call before checking a PIN. Throws a LOCKED error when no attempt is allowed. */
  start(username: string): Attempt {
    const state = this.states.get(username) ?? { failures: 0, checking: 0, lockedUntil: 0 };
    this.states.set(username, state);

    if (state.lockedUntil > this.now()) throw lockedError(this.secondsLeft(state));
    if (state.lockedUntil > 0) {
      // The lock has run out: start counting again.
      state.lockedUntil = 0;
      state.failures = 0;
    }
    if (state.failures + state.checking >= MAX_PIN_FAILURES) throw lockedError(PIN_LOCK_SECONDS);
    state.checking += 1;

    return {
      succeed: () => {
        state.checking -= 1;
        state.failures = 0;
        this.forgetIfIdle(username, state);
      },
      fail: () => {
        state.checking -= 1;
        state.failures += 1;
        if (state.failures < MAX_PIN_FAILURES) return 0;
        state.lockedUntil = this.now() + PIN_LOCK_SECONDS * 1000;
        return this.secondsLeft(state);
      },
      cancel: () => {
        state.checking -= 1;
        this.forgetIfIdle(username, state);
      },
    };
  }

  private secondsLeft(state: State): number {
    return Math.ceil((state.lockedUntil - this.now()) / 1000);
  }

  private forgetIfIdle(username: string, state: State): void {
    if (state.checking === 0 && state.failures === 0) this.states.delete(username);
  }
}
