"use client";

// "Log out" asks first: on the kiosk's touchscreen it is easy to press by mistake.
import { LogOut } from "lucide-react";
import { useState } from "react";
import { useLanguageStore } from "@/i18n/language-store";
import { useT } from "@/i18n/use-t";
import { api } from "@/lib/api";
import { AREAS, type AreaName } from "@/lib/areas";
import { socketClient } from "@/lib/socket";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTrigger } from "./ui/dialog";
import { TONE_SOFT } from "./ui/tone";
import { YesNo } from "./ui/yes-no";

export function LogoutButton({ area }: { area: AreaName }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logOut() {
    setBusy(true);
    setFailed(false);
    try {
      await api.post("/api/auth/logout");
    } catch {
      // Still logged in: say so, and stay.
      setFailed(true);
      setBusy(false);
      return;
    }
    socketClient().disconnect();
    if (area === "kiosk") useLanguageStore.getState().resetKioskLanguage();
    // A full page load, so nothing of this login is left over.
    window.location.assign(AREAS[area].login);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setFailed(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <LogOut aria-hidden />
          {t("shell.logout")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("logout.title")} description={t("logout.description")}>
        {failed && (
          <p role="alert" className={`rounded-xl border-2 p-3 font-semibold ${TONE_SOFT.stop}`}>
            {t("logout.failed")}
          </p>
        )}
        <YesNo
          yesLabel={t("common.yes")}
          noLabel={t("common.no")}
          disabled={busy}
          onYes={() => void logOut()}
          onNo={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
