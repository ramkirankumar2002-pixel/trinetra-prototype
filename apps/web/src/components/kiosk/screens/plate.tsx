"use client";

// Screen 4, the number plate: the cameras read it, the driver always confirms it, and
// only when that fails does the driver type it.
import {
  formatPlate,
  isValidIndianPlate,
  type AnprResponse,
  type CreateTicketResponse,
} from "@trinetra/shared";
import { ArrowRight, Keyboard, RotateCcw, ScanLine } from "lucide-react";
import { useEffect, useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useLanguage, useT } from "@/i18n/use-t";
import { api, ApiError } from "@/lib/api";
import { kioskErrorKey } from "@/lib/kiosk/error-text";
import { afterNo, afterRead, sameDriver, useKiosk } from "@/lib/kiosk/flow";
import { usePutTicket } from "@/lib/kiosk/queries";
import { useAction } from "@/lib/kiosk/use-action";
import { useSocketEvent } from "@/lib/socket-hooks";
import { Banner } from "../../ui/banner";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { YesNo } from "../../ui/yes-no";
import { CameraPhotos, PlateSign } from "../camera-photos";
import { KioskFrame } from "../frame";
import { PlateKeypad } from "../keypads";

/** A moment between two automatic reads, so the driver sees what happened. */
const READ_AGAIN_MS = 1500;
/** Reading was refused because of the truck's place on the bridge: that passes. */
const PASSING = new Set(["POSITION_NOT_OK", "NO_TRUCK", "STALE_READING", "WEIGHBRIDGE_FAULT"]);
/** The plate was not read for this driver, or was forgotten: read it again. */
const READ_FIRST = new Set(["UNKNOWN_PHOTO_ID", "PLATE_NOT_READ", "PLATE_NOT_CONFIRMED"]);

/** The read that has been asked for, so it is asked once. */
let asked = "";

async function readPlate(driver: number, read: number): Promise<void> {
  const current = () => {
    const { driver: now, plate } = useKiosk.getState();
    return now === driver && plate.read === read;
  };
  try {
    const result = await api.post<AnprResponse>("/api/anpr");
    if (!current()) return;
    const next = afterRead(result);
    const again = next.phase === "reading";
    useKiosk.getState().setPlate({ ...next, result, ...(again ? { read: read + 1 } : {}) });
  } catch (error) {
    if (!current()) return;
    const code = error instanceof ApiError ? error.code : "UNKNOWN";
    // Another read is still running at the backend: ask again.
    useKiosk
      .getState()
      .setPlate(
        code === "ANPR_IN_PROGRESS" ? { read: read + 1 } : { phase: "failed", error: code },
      );
  }
}

function usePlateReading() {
  const driver = useKiosk((state) => state.driver);
  const { phase, read } = useKiosk((state) => state.plate);
  useEffect(() => {
    if (phase !== "reading") return;
    const key = `${driver}:${read}`;
    if (asked === key) return;
    const timer = setTimeout(
      () => {
        asked = key;
        void readPlate(driver, read);
      },
      read === 0 ? 0 : READ_AGAIN_MS,
    );
    return () => clearTimeout(timer);
  }, [driver, phase, read]);

  useSocketEvent("photo:arrived", ({ camera, url }) => {
    const { plate, setPlate } = useKiosk.getState();
    if (plate.phase === "reading") setPlate({ photos: { ...plate.photos, [camera]: url } });
  });
}

export function PlateScreen() {
  const t = useT();
  const { language } = useLanguage();
  const plate = useKiosk((state) => state.plate);
  const setPlate = useKiosk((state) => state.setPlate);
  const readAgain = useKiosk((state) => state.readAgain);
  const startTicket = useKiosk((state) => state.startTicket);
  const putTicket = usePutTicket();
  const { busy, run } = useAction();
  const [problem, setProblem] = useState<MessageKey | null>(null);
  usePlateReading();

  const { phase, result, picked, typed } = plate;
  // "Continues by itself": once the truck stands right again, the plate is read again.
  const passing = phase === "failed" && PASSING.has(plate.error ?? "");
  useEffect(() => {
    if (passing) readAgain();
  }, [passing, readAgain]);

  async function confirm(number: string, manual: boolean) {
    setProblem(null);
    // A truck on its second visit starts no new ticket.
    const open = result?.openTicket;
    if (open && open.plate === number && open.status !== "STARTED") {
      startTicket(open.id, 2);
      return;
    }
    const stillHere = sameDriver();
    const answer = await run(`ticket:${number}:${manual}:${plate.read}`, (key) =>
      api.post<CreateTicketResponse>("/api/tickets", {
        idempotencyKey: key,
        body: { plate: number, language, photoIds: result?.photoIds ?? [], manual },
      }),
    );
    if (!answer || !stillHere()) return;
    if (answer.ok) {
      await putTicket(answer.data.ticket);
      startTicket(answer.data.ticket.id, 1);
      return;
    }
    const { code, details } = answer.error;
    if (code === "OPEN_TICKET") {
      startTicket((details as { ticketId: number }).ticketId, 2);
    } else if (READ_FIRST.has(code)) {
      readAgain();
    } else {
      setProblem(kioskErrorKey(answer.error));
    }
  }

  const banner = problem && (
    <Banner tone="stop">
      <span role="alert">{t(problem)}</span>
    </Banner>
  );
  const photos = {
    front: plate.photos.front ?? result?.front.photoUrl ?? null,
    back: plate.photos.back ?? result?.back.photoUrl ?? null,
  };
  const header = (subtitle: MessageKey) => ({
    icon: ScanLine,
    title: t("kiosk.plate.heading"),
    subtitle: t(subtitle),
  });

  if (phase === "keypad") {
    return (
      <KioskFrame
        header={header("kiosk.plate.type")}
        actions={
          <>
            <Button variant="dark" disabled={busy} onClick={readAgain}>
              <RotateCcw aria-hidden />
              {t("kiosk.plate.readAgain")}
            </Button>
            <Button
              disabled={busy || !isValidIndianPlate(typed)}
              onClick={() => void confirm(typed, true)}
            >
              {t("kiosk.next")}
              <ArrowRight aria-hidden />
            </Button>
          </>
        }
      >
        {banner}
        <PlateKeypad
          value={typed}
          disabled={busy}
          onChange={(value) => setPlate({ typed: value })}
          labels={{
            pad: t("kiosk.plate.keypad"),
            typed: t("kiosk.plate.heading"),
            backspace: t("numberPad.delete"),
          }}
        />
      </KioskFrame>
    );
  }

  if (phase === "failed") {
    return (
      <KioskFrame
        header={header("kiosk.plate.failed")}
        actions={
          <>
            <Button variant="dark" onClick={() => setPlate({ phase: "keypad" })}>
              <Keyboard aria-hidden />
              {t("kiosk.plate.typeIt")}
            </Button>
            <Button onClick={readAgain}>
              <RotateCcw aria-hidden />
              {t("kiosk.tryAgain")}
            </Button>
          </>
        }
      >
        <Banner tone="stop">
          <span role="alert">{t(kioskErrorKey({ code: plate.error ?? "" }))}</span>
        </Banner>
        <CameraPhotos className="flex-1" photos={photos} waiting={false} />
      </KioskFrame>
    );
  }

  if (phase === "confirm" && picked) {
    return (
      <KioskFrame
        header={header("kiosk.plate.isYours")}
        actions={
          <YesNo
            className="col-span-full"
            yesLabel={t("common.yes")}
            noLabel={t("common.no")}
            disabled={busy}
            onYes={() => void confirm(picked, false)}
            onNo={() => {
              setProblem(null);
              if (afterNo(result) === "reading") readAgain();
              else setPlate({ phase: "keypad" });
            }}
          />
        }
      >
        {banner}
        <div className="flex justify-center">
          <PlateSign plate={formatPlate(picked)} />
        </div>
        <CameraPhotos className="flex-1" photos={photos} waiting={false} />
      </KioskFrame>
    );
  }

  if (phase === "choose" && result) {
    const choices = [result.front.plate!, result.back.plate!];
    return (
      <KioskFrame
        header={header("kiosk.plate.choose")}
        actions={
          <Button variant="dark" disabled={busy} onClick={() => setPlate({ phase: "keypad" })}>
            <Keyboard aria-hidden />
            {t("kiosk.plate.neither")}
          </Button>
        }
      >
        {banner ?? (
          <Banner tone="wait">
            <span role="alert">{t("kiosk.plate.differ")}</span>
          </Banner>
        )}
        <CameraPhotos className="flex-1" photos={photos} waiting={false} />
        <div className="grid shrink-0 grid-cols-2 gap-4">
          {choices.map((number, index) => (
            <Button
              key={index === 0 ? "front" : "back"}
              variant="outline"
              className="font-extrabold kiosk:text-[3rem]"
              disabled={busy}
              onClick={() => void confirm(number, false)}
            >
              {formatPlate(number)}
            </Button>
          ))}
        </div>
      </KioskFrame>
    );
  }

  return (
    <KioskFrame header={header("kiosk.plate.stay")}>
      <Spinner label={t(plate.read === 0 ? "kiosk.plate.reading" : "kiosk.plate.readingAgain")} />
      <CameraPhotos className="flex-1" photos={photos} waiting />
    </KioskFrame>
  );
}
