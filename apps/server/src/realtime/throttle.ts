export interface Throttled {
  /** Asks for `run` to happen now, or as soon as the interval allows. */
  request(): void;
  cancel(): void;
}

/**
 * Runs `run` at most once every `intervalMs`. A request that comes too soon is delayed,
 * not dropped, so the newest state is always sent in the end. `run` reads that state itself.
 */
export function throttle(
  run: () => void,
  intervalMs: number,
  now: () => number = () => performance.now(),
): Throttled {
  let lastRun = Number.NEGATIVE_INFINITY;
  let timer: NodeJS.Timeout | undefined;

  const fire = () => {
    timer = undefined;
    lastRun = now();
    run();
  };

  return {
    request() {
      if (timer) return; // Already waiting: it will send the newest state.
      const wait = lastRun + intervalMs - now();
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
