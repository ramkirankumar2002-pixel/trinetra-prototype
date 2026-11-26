import { cn } from "cn";
import type { ComponentProps } from "react";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col gap-3 rounded-2xl border-2 bg-card p-4 text-card-foreground kiosk:gap-4 kiosk:rounded-3xl kiosk:p-8",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("text-xl font-bold kiosk:text-5xl", className)} {...props} />;
}
