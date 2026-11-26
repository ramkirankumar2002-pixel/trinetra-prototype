import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon
        aria-hidden
        className="size-14 text-muted-foreground kiosk:size-24 kiosk:text-highlight"
      />
      <h2 className="text-xl font-bold kiosk:text-6xl">{title}</h2>
      {children && <div className="text-muted-foreground">{children}</div>}
    </div>
  );
}
