// Switches a theme on for everything inside it, including dialogs and messages.
import { cn } from "cn";
import type { ComponentProps } from "react";
import { ThemeContext, type ThemeName } from "./theme-context";

export function ThemeRoot({
  theme,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { theme: ThemeName }) {
  return (
    <ThemeContext.Provider value={theme}>
      <div data-theme={theme} className={cn("bg-background text-foreground", className)} {...props}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
