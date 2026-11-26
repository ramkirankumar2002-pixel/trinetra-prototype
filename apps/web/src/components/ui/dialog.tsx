"use client";

import { cn } from "cn";
import { Dialog as Primitive } from "radix-ui";
import type { ReactNode } from "react";
import { useTheme } from "../layout/theme-context";

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

/** A box over the page. Escape and the page behind close it; the buttons are the caller's. */
export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  const theme = useTheme();
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
      <Primitive.Content
        data-theme={theme}
        // Without a description, say so, or Radix warns.
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[min(92vw,28rem)] -translate-1/2 flex-col gap-4 overflow-auto rounded-2xl border-2 bg-background p-5 shadow-xl",
          "kiosk:w-[min(90vw,56rem)] kiosk:gap-8 kiosk:rounded-3xl kiosk:p-10 kiosk:text-[2rem]",
          className,
        )}
      >
        <Primitive.Title className="text-xl font-bold kiosk:text-5xl">{title}</Primitive.Title>
        {description && (
          <Primitive.Description className="text-muted-foreground">
            {description}
          </Primitive.Description>
        )}
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
