"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RESET_WORD } from "@trinetra/shared";
import { RotateCcw, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useT } from "@/i18n/use-t";
import { api } from "@/lib/api";
import { Panel } from "../dashboard/panel";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "../ui/dialog";
import { useToast } from "../ui/toast";

export function ResetPanel() {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const field = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim() === RESET_WORD;

  const reset = useMutation({
    mutationFn: () => api.post<{ deletedTickets: number }>("/api/demo/reset"),
    onSuccess: ({ deletedTickets }) => {
      setOpen(false);
      toast({ tone: "go", title: t("settings.resetDone", { count: deletedTickets }) });
      void queryClient.invalidateQueries();
    },
    onError: () => toast({ tone: "stop", title: t("settings.resetFailed") }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (confirmed && !reset.isPending) reset.mutate();
  }

  return (
    <Panel icon={RotateCcw} title={t("settings.reset")}>
      <p className="mb-3 text-sm text-muted-foreground">{t("settings.resetText")}</p>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          // The word is typed again every time.
          setTyped("");
          setOpen(next);
        }}
      >
        <DialogTrigger asChild>
          <Button size="lg" variant="danger" className="w-full">
            <Trash2 aria-hidden />
            {t("settings.reset")}
          </Button>
        </DialogTrigger>
        <DialogContent title={t("settings.resetTitle")} description={t("settings.resetText")}>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label htmlFor={field} className="font-semibold">
              {t("settings.resetType", { word: RESET_WORD })}
            </label>
            <input
              id={field}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={10}
              className="min-h-12 w-full rounded-lg border border-input bg-field px-3 text-lg tracking-widest outline-none focus-visible:ring-4 focus-visible:ring-ring/60"
            />
            <Button type="submit" size="lg" variant="stop" disabled={!confirmed || reset.isPending}>
              {t("settings.resetConfirm")}
            </Button>
            <DialogClose asChild>
              <Button size="lg" variant="outline">
                {t("settings.cancel")}
              </Button>
            </DialogClose>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
