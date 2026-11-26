// Yes and No are always two big buttons: green ✓ on the left, red ✕ on the right, in the
// same place on every screen (build plan section 8).
import { cn } from "cn";
import { Check, X } from "lucide-react";
import { Button } from "./button";

export interface YesNoProps {
  yesLabel: string;
  noLabel: string;
  onYes: () => void;
  onNo: () => void;
  disabled?: boolean;
  className?: string;
}

export function YesNo({ yesLabel, noLabel, onYes, onNo, disabled, className }: YesNoProps) {
  return (
    <div className={cn("grid w-full grid-cols-2 gap-4 kiosk:gap-8", className)}>
      <Button variant="go" size="lg" disabled={disabled} onClick={onYes}>
        <Check aria-hidden strokeWidth={3} />
        {yesLabel}
      </Button>
      <Button variant="stop" size="lg" disabled={disabled} onClick={onNo}>
        <X aria-hidden strokeWidth={3} />
        {noLabel}
      </Button>
    </div>
  );
}
