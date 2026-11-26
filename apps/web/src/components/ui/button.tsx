import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

// In the kiosk layout every button is at least 96 px tall with 32 px text, whatever its
// size. On phones the normal size is a 48 px tap target.
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-transparent font-semibold select-none",
    "text-center transition-colors outline-none focus-visible:ring-4 focus-visible:ring-ring/60",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
    "kiosk:min-h-24 kiosk:rounded-3xl kiosk:px-8 kiosk:text-[2rem] kiosk:[&_svg:not([class*='size-'])]:size-10",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        outline: "border-neutral-400 bg-background text-foreground hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-neutral-200",
        ghost: "text-foreground hover:bg-muted",
        go: "bg-go text-go-foreground hover:bg-go/90",
        wait: "bg-wait text-wait-foreground hover:bg-wait/90",
        stop: "bg-stop text-stop-foreground hover:bg-stop/90",
      },
      size: {
        sm: "min-h-10 px-3 text-sm",
        default: "min-h-12 px-4 text-base",
        lg: "min-h-14 px-6 text-lg",
        kiosk: "min-h-24 px-8 text-[2rem]",
        "kiosk-xl":
          "min-h-40 px-10 text-5xl kiosk:min-h-40 kiosk:text-5xl kiosk:[&_svg:not([class*='size-'])]:size-16",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      // A button never submits a form unless it says so.
      type={asChild ? type : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
