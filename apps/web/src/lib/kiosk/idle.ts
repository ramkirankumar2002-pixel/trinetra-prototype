// A driver who stops answering (build plan section 8): a gentle reminder after a minute,
// and "Start over?" after three. Any touch or key press starts the clock again.
import { useCallback, useEffect, useRef, useState } from "react";

export const REMIND_AFTER_MS = 60_000;
export const ASK_AFTER_MS = 3 * 60_000;

export type IdleStage = "active" | "remind" | "ask";

function onActivity(listener: () => void): () => void {
  window.addEventListener("pointerdown", listener);
  window.addEventListener("keydown", listener);
  return () => {
    window.removeEventListener("pointerdown", listener);
    window.removeEventListener("keydown", listener);
  };
}

/** `resetKey` is anything whose change counts as activity, such as the screen. */
export function useInactivity(on: boolean, resetKey: string) {
  const [touches, setTouches] = useState(0);
  const clock = `${resetKey}#${touches}`;
  // A reminder counts only for the clock that raised it.
  const [raised, setRaised] = useState<{ clock: string; stage: IdleStage } | null>(null);
  const stage: IdleStage = on && raised?.clock === clock ? raised.stage : "active";

  const asking = useRef(false);
  useEffect(() => {
    asking.current = stage === "ask";
  }, [stage]);

  const stay = useCallback(() => setTouches((count) => count + 1), []);

  // While "Start over?" is asked, only its buttons answer it.
  useEffect(() => onActivity(() => !asking.current && stay()), [stay]);

  useEffect(() => {
    if (!on) return;
    const remind = setTimeout(() => setRaised({ clock, stage: "remind" }), REMIND_AFTER_MS);
    const ask = setTimeout(() => setRaised({ clock, stage: "ask" }), ASK_AFTER_MS);
    return () => {
      clearTimeout(remind);
      clearTimeout(ask);
      // Forgotten, so coming back to this screen does not bring the reminder back.
      setRaised(null);
    };
  }, [on, clock]);

  return { stage, stay };
}

/** Runs `done` after `ms` without a touch. For slips that go away by themselves. */
export function useReturnAfter(ms: number, done: () => void) {
  const latest = useRef(done);
  useEffect(() => {
    latest.current = done;
  });
  useEffect(() => {
    let timer = setTimeout(() => latest.current(), ms);
    const stop = onActivity(() => {
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), ms);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [ms]);
}
