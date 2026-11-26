"use client";

// Short messages that go away by themselves: const toast = useToast(); toast({ ... }).
import { cn } from "cn";
import { Toast as Primitive } from "radix-ui";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useTheme } from "../layout/theme-context";
import { TONE_ICONS, TONE_SOFT, type Tone } from "./tone";

export interface ToastMessage {
  tone: Tone;
  title: string;
}

const ToastContext = createContext<((message: ToastMessage) => void) | null>(null);

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a ToastProvider.");
  return show;
}

/** Put it inside PageShell, so the messages take the page's layout. */
export function ToastProvider({ children, label }: { children: ReactNode; label: string }) {
  const theme = useTheme();
  const [toasts, setToasts] = useState<(ToastMessage & { id: number })[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: ToastMessage) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...message, id }]);
  }, []);
  const remove = (id: number) => setToasts((current) => current.filter((item) => item.id !== id));

  return (
    <ToastContext.Provider value={show}>
      <Primitive.Provider label={label} duration={4000}>
        {children}
        {toasts.map(({ id, tone, title }) => {
          const Icon = TONE_ICONS[tone];
          return (
            <Primitive.Root
              key={id}
              data-theme={theme}
              onOpenChange={(open) => !open && remove(id)}
              className={cn(
                "flex items-center gap-3 rounded-xl border-2 p-4 font-semibold shadow-lg kiosk:p-6 kiosk:text-[2rem]",
                TONE_SOFT[tone],
              )}
            >
              <Icon aria-hidden className="size-5 shrink-0 kiosk:size-10" />
              <Primitive.Title>{title}</Primitive.Title>
            </Primitive.Root>
          );
        })}
        {/* Above the bottom bar, so it never covers its buttons. */}
        <Primitive.Viewport className="fixed right-4 bottom-32 z-50 flex w-[min(92vw,26rem)] flex-col gap-2" />
      </Primitive.Provider>
    </ToastContext.Provider>
  );
}
