"use client";

// "Help", always in the same place. On a logged-in weighbridge screen it calls the store
// officer (POST /api/help). It only says "called" once the backend has said so.
import { Headset } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/use-t";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "../ui/dialog";
import { Spinner } from "../ui/spinner";

type Call = "calling" | "called" | "failed";

export function HelpButton({
  className,
  onAsk,
}: {
  className?: string;
  /** Resolves true once the store officer has been told. */
  onAsk?: (() => Promise<boolean>) | undefined;
}) {
  const t = useT();
  const [call, setCall] = useState<Call | null>(null);

  async function ask() {
    if (!onAsk || call === "calling") return;
    setCall("calling");
    setCall((await onAsk().catch(() => false)) ? "called" : "failed");
  }

  const text =
    call === "called"
      ? t("kiosk.helpCalled")
      : call === "failed"
        ? t("kiosk.helpFailed")
        : t("kiosk.helpText");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className={className} onClick={() => void ask()}>
          <Headset aria-hidden />
          {t("kiosk.help")}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={t("kiosk.helpTitle")}
        {...(call === "calling" ? {} : { description: text })}
      >
        {call === "calling" && <Spinner label={t("kiosk.helpCalling")} />}
        <DialogClose asChild>
          <Button>{t("common.ok")}</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
