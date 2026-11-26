import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

// In the kiosk theme every button is at least 96 px tall with 32 px text, whatever its
// size. On a phone the normal size is a 44 px tap target.
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-semibold select-none",
    "text-center transition-[filter,background-color] outline-none focus-visible:ring-4 focus-visible:ring-ring/60",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
    "kiosk:min-h-24 kiosk:gap-4 kiosk:rounded-2xl kiosk:border-2 kiosk:px-8 kiosk:text-[2rem] kiosk:[&_svg:not([class*='size-'])]:size-10",
  ],
  {
    variants: {
      variant: {
        /** The one main thing to do: "Next", "Log in". Glows on the kiosk. */
        primary:
          "border-primary-edge bg-linear-to-b from-primary to-primary-to text-primary-foreground shadow-primary hover:brightness-110",
        /** A second choice beside the main one. */
        outline: "border-outline-edge bg-card text-outline-ink hover:bg-accent",
        /** Neutral actions in the bar: "Edit", "Back". */
        dark: "border-secondary-border bg-secondary text-secondary-foreground hover:brightness-125",
        /** "Wrong…", "Reject": a red outline. */
        danger: "border-stop-edge bg-stop-soft text-stop-ink hover:brightness-110",
        /** Yes, Approve. */
        go: "border-go-edge bg-linear-to-b from-go to-go-to text-go-foreground shadow-go hover:brightness-110 kiosk:from-go/75 kiosk:to-go-to/80",
        /** No, Stop. */
        stop: "border-stop-edge bg-linear-to-b from-stop to-stop-to text-stop-foreground shadow-stop hover:brightness-110 kiosk:from-stop/75 kiosk:to-stop-to/80",
        ghost: "border-transparent text-foreground hover:bg-muted",
        /** On the navy sidebar. */
        nav: "border-white/25 bg-transparent text-nav-foreground hover:bg-white/10",
        /** Logout on the navy sidebar. */
        "nav-danger": "border-nav-danger/60 bg-transparent text-nav-danger hover:bg-nav-danger/10",
      },
      size: {
        sm: "min-h-9 px-3 text-sm [&_svg:not([class*='size-'])]:size-4",
        default: "min-h-11 px-4 text-base",
        lg: "min-h-14 px-6 text-lg",
        kiosk: "min-h-24 px-8 text-[2rem]",
        "kiosk-xl":
          "min-h-40 px-10 text-5xl kiosk:min-h-40 kiosk:text-5xl kiosk:[&_svg:not([class*='size-'])]:size-16",
        icon: "size-11 px-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

function Button({
  className,
  variant = "primary",
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
