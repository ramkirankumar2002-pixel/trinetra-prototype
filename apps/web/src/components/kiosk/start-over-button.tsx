"use client";

// "Start over" asks first: on a touchscreen it is easy to press by mistake.
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/use-t";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTrigger } from "../ui/dialog";
import { YesNo } from "../ui/yes-no";

export function StartOverButton({
  className,
  onStartOver,
}: {
  className?: string;
  onStartOver: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="dark" className={className}>
          <RotateCcw aria-hidden />
          {t("kiosk.startOver")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("kiosk.startOverTitle")} description={t("kiosk.startOverText")}>
        <YesNo
          yesLabel={t("common.yes")}
          noLabel={t("common.no")}
          onYes={() => {
            setOpen(false);
            onStartOver();
          }}
          onNo={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
