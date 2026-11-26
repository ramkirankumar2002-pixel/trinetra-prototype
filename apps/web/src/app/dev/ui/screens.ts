// Kept apart from the samples: a server page cannot read a list from a "use client" file.
export const KIOSK_SCREENS = ["start", "details", "weight", "question", "number"] as const;
export type KioskScreen = (typeof KIOSK_SCREENS)[number];
