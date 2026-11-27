"use client";

// "Cancel visit": for a visit that waits for a person and will not go on, such as a truck
// that has left. It is not a rejection. The backend refuses it unless the visit really is
// waiting, and saves who cancelled it, when and why.
import { useQueryClient } from "@tanstack/react-query";
import { formatPlate, type TicketView } from "@trinetra/shared";
import { Ban } from "lucide-react";
import { useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { api } from "@/lib/api";
import { useAction } from "@/lib/kiosk/use-action";
import { ALREADY_HANDLED, CANCEL_CHIPS } from "@/lib/store/logic";
import { STORE_KEY } from "@/lib/store/queries";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { ReasonForm } from "./reason-form";

const PROBLEMS: Partial<Record<string, MessageKey>> = {
  NETWORK_ERROR: "error.network",
  SERVER_UNREACHABLE: "error.network",
  RATE_LIMITED: "error.tooMany",
};

export function CancelVisit({
  ticket,
  open,
  onOpen,
  onSend,
  onDone,
}: {
  ticket: TicketView;
  /** The reason is being asked for. */
  open: boolean;
  onOpen: (open: boolean) => void;
  /** The press is on its way: the ticket may now change before the answer arrives. */
  onSend?: () => void;
  /** "taken": someone else answered first, or the visit has moved on. */
  onDone: (result: "cancelled" | "taken") => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { busy, run } = useAction();
  const [problem, setProblem] = useState<MessageKey | null>(null);

  async function send(reason: string) {
    setProblem(null);
    onSend?.();
    // The same press, sent again after a lost answer, keeps its Idempotency-Key.
    const answer = await run(`cancel:${ticket.id}:${reason}`, (key) =>
      api.post(`/api/store/tickets/${ticket.id}/cancel`, {
        body: { reason },
        idempotencyKey: key,
      }),
    );
    if (!answer) return;
    void queryClient.invalidateQueries({ queryKey: STORE_KEY });
    if (answer.ok) return onDone("cancelled");
    if (ALREADY_HANDLED.has(answer.error.code)) return onDone("taken");
    setProblem(PROBLEMS[answer.error.code] ?? "error.generic");
  }

  if (!open) {
    // Set apart from "Reject", which refuses the truck: quieter, and saying what it is.
    return (
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <Button size="lg" variant="outline" onClick={() => onOpen(true)}>
          <Ban aria-hidden />
          {t("store.cancel.button")}
        </Button>
        <p data-testid="cancel-hint" className="text-sm text-muted-foreground">
          {t("store.cancel.hint")}
        </p>
      </div>
    );
  }
  return (
    <ReasonForm
      title={t("store.cancel.title", { plate: formatPlate(ticket.plate) })}
      chips={CANCEL_CHIPS}
      confirm="store.cancel.confirm"
      danger
      busy={busy}
      problem={
        <>
          <Banner tone="wait">{t("store.cancel.warning")}</Banner>
          {problem && (
            <Banner tone="stop">
              <span role="alert">{t(problem)}</span>
            </Banner>
          )}
        </>
      }
      onBack={() => {
        setProblem(null);
        onOpen(false);
      }}
      onConfirm={(reason) => void send(reason)}
    />
  );
}
