// How the supervisor's phone calls for attention when a truck is sent to them: a short
// sound, a vibration, a message and the number in the tab's title.

/**
 * The trucks that were not in the list before. `known` is null for the first list after
 * the page loads: those trucks are not news.
 */
export function newArrivals(known: ReadonlySet<number> | null, ids: readonly number[]): number[] {
  return known === null ? [] : ids.filter((id) => !known.has(id));
}

export const tabTitle = (waiting: number): string =>
  waiting > 0 ? `(${waiting}) Trinetra` : "Trinetra";

// ---- Sound ----

// Browsers play no sound until the person has touched the page once.
let audio: AudioContext | null = null;
let touched = false;
const listeners = new Set<() => void>();

export const soundIsOn = (): boolean => touched;

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Call from a real tap or key press. */
export function unlockSound(): void {
  const Context = typeof window === "undefined" ? undefined : window.AudioContext;
  if (Context) {
    audio ??= new Context();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  }
  if (touched) return;
  touched = true;
  listeners.forEach((listener) => listener());
}

/** Two short beeps. Silent before the first tap. */
function beep(context: AudioContext): void {
  for (const [start, pitch] of [
    [0, 880],
    [0.22, 1175],
  ] as const) {
    const tone = context.createOscillator();
    const volume = context.createGain();
    const at = context.currentTime + start;
    tone.frequency.value = pitch;
    volume.gain.setValueAtTime(0.0001, at);
    volume.gain.exponentialRampToValueAtTime(0.4, at + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    tone.connect(volume).connect(context.destination);
    tone.start(at);
    tone.stop(at + 0.2);
  }
}

export const VIBRATION = [200, 100, 200];

export function ringForTruck(): void {
  if (!touched) return;
  if (audio) {
    try {
      beep(audio);
    } catch {
      // The message on screen still says it.
    }
  }
  // iPhones have no vibration for web pages.
  navigator.vibrate?.(VIBRATION);
}
