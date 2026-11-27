"use client";

// On every supervisor page: keeps the lists fresh from the live events, calls for
// attention when a truck arrives, and keeps the number waiting in the tab's title.
import { useQueryClient } from "@tanstack/react-query";
import { formatPlate } from "@trinetra/shared";
import { usePathname } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useT } from "@/i18n/use-t";
import { useSocketEvent } from "@/lib/socket-hooks";
import { newArrivals, ringForTruck, tabTitle, unlockSound } from "@/lib/supervisor/alerts";
import { SUPERVISOR_KEY, useSupervisorTrucks } from "@/lib/supervisor/queries";
import { useToast } from "../ui/toast";

/**
 * The trucks already announced. Kept outside the component, so that moving between pages
 * does not make old trucks news again. A login or logout loads the whole page afresh.
 */
let known: Set<number> | null = null;

export function TruckWatcher() {
  const t = useT();
  const toast = useToast();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data } = useSupervisorTrucks("pending");

  const reload = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: SUPERVISOR_KEY }),
    [queryClient],
  );
  useSocketEvent("approval:new", reload);
  useSocketEvent("ticket:updated", reload);
  useSocketEvent("approval:decided", reload);

  // The first tap anywhere turns the sound on.
  useEffect(() => {
    const events = ["pointerdown", "keydown"] as const;
    events.forEach((name) => window.addEventListener(name, unlockSound));
    return () => events.forEach((name) => window.removeEventListener(name, unlockSound));
  }, []);

  // Judged from the list, not the event: a truck that came while the phone was offline
  // is announced too, when the list is loaded again.
  useEffect(() => {
    if (!data) return;
    const arrived = newArrivals(
      known,
      data.tickets.map((truck) => truck.approvalId),
    );
    known = new Set([...(known ?? []), ...data.tickets.map((truck) => truck.approvalId)]);
    if (arrived.length === 0) return;
    ringForTruck();
    for (const truck of data.tickets.filter((item) => arrived.includes(item.approvalId))) {
      toast({ tone: "info", title: t("sup.newTruck", { plate: formatPlate(truck.plate) }) });
    }
  }, [data, toast, t]);

  const waiting = data?.tickets.length ?? 0;
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
