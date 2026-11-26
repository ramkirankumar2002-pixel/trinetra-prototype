import { createContext, useContext } from "react";

/** The two looks of the website (globals.css). */
export type ThemeName = "kiosk" | "dashboard";

export const ThemeContext = createContext<ThemeName>("dashboard");

/** Dialogs and toasts are drawn outside the page, so they read the theme from here. */
export const useTheme = () => useContext(ThemeContext);
