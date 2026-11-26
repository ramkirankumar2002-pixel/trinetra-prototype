import { cn } from "cn";
import type { ComponentProps } from "react";

/** A white card on the dashboard; a glass panel with a glowing edge on the kiosk. */
export const SURFACE =
  "rounded-xl border border-card-border bg-card text-card-foreground shadow-card kiosk:rounded-3xl kiosk:backdrop-blur-md";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(SURFACE, "flex flex-col gap-3 p-4 kiosk:gap-4 kiosk:p-6", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("text-lg font-bold kiosk:text-5xl", className)} {...props} />;
}
