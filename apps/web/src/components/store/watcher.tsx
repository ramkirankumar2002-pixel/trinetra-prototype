"use client";

// On every store officer page: keeps the lists fresh from the live events of the store's
// room, calls for attention when a request arrives, and keeps the number waiting in the
// tab's title.
import { useQueryClient } from "@tanstack/react-query";
import { formatPlate, type ApprovalDecidedEvent } from "@trinetra/shared";
import { usePathname } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useT } from "@/i18n/use-t";
import { useSocketEvent } from "@/lib/socket-hooks";
import { kindPill } from "@/lib/store/logic";
import { STORE_KEY, useStorePending } from "@/lib/store/queries";
import {
  newArrivals,
  ringForTruck,
  SOUND_EVENTS,
  tabTitle,
  unlockSound,
} from "@/lib/supervisor/alerts";
import { useToast } from "../ui/toast";

/**
 * The requests already announced. Kept outside the component, so that moving between
 * pages does not make old requests news again. A login or logout loads the page afresh.
 */
let known: Set<number> | null = null;

export function StoreWatcher() {
  const t = useT();
  const toast = useToast();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data } = useStorePending();

  const reload = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: STORE_KEY }),
    [queryClient],
  );
  useSocketEvent("approval:new", reload);
  useSocketEvent("ticket:updated", reload);
  useSocketEvent("approval:decided", (event: ApprovalDecidedEvent) => {
    // A truck blocked by a supervisor needs no decision, but the officer is told.
    if (event.kind === "SUPERVISOR" && event.status === "REJECTED") {
      ringForTruck();
      toast({ tone: "stop", title: t("store.toast.blocked") });
    }
    reload();
  });

  // The first tap anywhere turns the sound on.
  useEffect(() => {
    SOUND_EVENTS.forEach((name) => window.addEventListener(name, unlockSound));
    return () => SOUND_EVENTS.forEach((name) => window.removeEventListener(name, unlockSound));
  }, []);

  // Judged from the list, not the event: a request made while this device was offline is
  // announced too, when the list is loaded again.
  useEffect(() => {
    if (!data) return;
    // A help call that turns out to need a bill is news again.
    const key = (item: (typeof data.requests)[number]) =>
      item.needsBill ? -item.approval.id : item.approval.id;
    const ids = data.requests.map(key);
    const arrived = newArrivals(known, ids);
    known = new Set([...(known ?? []), ...ids]);
    if (arrived.length === 0) return;
    ringForTruck();
    for (const item of data.requests.filter((row) => arrived.includes(key(row)))) {
      const kind = t(kindPill(item.approval, item.needsBill).key);
      toast({
        tone: "info",
        title: item.ticket
          ? t("store.toast.new", { kind, plate: formatPlate(item.ticket.plate) })
          : t("store.toast.newNoTruck", { kind }),
      });
    }
  }, [data, toast, t]);

  const waiting = data?.requests.length ?? 0;
  useEffect(() => {
    const title = tabTitle(waiting);
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    // Next writes the page's own title after moving to another page.
    const watcher = new MutationObserver(apply);
    watcher.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => watcher.disconnect();
  }, [waiting, pathname]);

  return null;
}
