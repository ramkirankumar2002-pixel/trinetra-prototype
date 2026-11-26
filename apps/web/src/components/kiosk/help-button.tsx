"use client";

// "Help", always in the same place. Until Phase 10 connects it to the store officer
// (POST /api/help), it tells the driver where to go and calls nobody.
import { Headset } from "lucide-react";
import { useT } from "@/i18n/use-t";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "../ui/dialog";

export function HelpButton({ className }: { className?: string }) {
  const t = useT();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className={className}>
          <Headset aria-hidden />
          {t("kiosk.help")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("kiosk.helpTitle")} description={t("kiosk.helpText")}>
        <DialogClose asChild>
          <Button>{t("common.ok")}</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
