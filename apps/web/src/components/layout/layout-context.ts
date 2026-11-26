import { createContext, useContext } from "react";

/** "kiosk": a landscape touchscreen. "phone": supervisor, store officer and other pages. */
export type LayoutKind = "kiosk" | "phone";

export const LayoutContext = createContext<LayoutKind>("phone");

/** Dialogs and toasts are drawn outside the page, so they read the layout from here. */
export const useLayout = () => useContext(LayoutContext);
