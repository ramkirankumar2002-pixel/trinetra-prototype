import { cn } from "cn";
import { LoaderCircle } from "lucide-react";

/** `label` says what is being waited for; it is shown and read aloud. */
export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex items-center justify-center gap-3 text-muted-foreground", className)}
    >
      <LoaderCircle
        aria-hidden
        className="size-7 animate-spin motion-reduce:animate-none kiosk:size-16"
      />
      <span>{label}</span>
    </div>
  );
}
