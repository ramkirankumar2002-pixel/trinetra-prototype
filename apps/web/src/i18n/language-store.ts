// The chosen language, kept apart for two kinds of user:
//   kiosk: each driver chooses. It is not saved, and goes back to English when the kiosk
//          goes back to Ready (resetKioskLanguage).
//   staff: the supervisor, the store officer and other pages. English until switched, and
//          remembered on that phone.
import type { Language } from "@trinetra/shared";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type LanguageScope = "kiosk" | "staff";

export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_STORAGE_KEY = "trinetra.language";

/** Browser storage can be missing or blocked: the switch must still work. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // Not remembered, that is all.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // Nothing to remove.
    }
  },
};

interface LanguageState {
  kiosk: Language;
  staff: Language;
  setLanguage: (scope: LanguageScope, language: Language) => void;
  /** Call when the kiosk goes back to Ready: the next driver starts fresh. */
  resetKioskLanguage: () => void;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      kiosk: DEFAULT_LANGUAGE,
      staff: DEFAULT_LANGUAGE,
      setLanguage: (scope, language) => set({ [scope]: language }),
      resetKioskLanguage: () => set({ kiosk: DEFAULT_LANGUAGE }),
    }),
    {
      name: LANGUAGE_STORAGE_KEY,
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ staff }) => ({ staff }),
      // Read after the first render, so it matches the page the server sent.
      skipHydration: true,
    },
  ),
);
