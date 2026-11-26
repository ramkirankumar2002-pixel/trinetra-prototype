"use client";

// The driver's phone: opened by the QR code, with no login. The one-time code in the
// address is the only permission, and all the phone is told is the number plate.
import { formatPlate, LANGUAGES, type UploadInfoResponse } from "@trinetra/shared";
import { Camera, Check, FileUp, Send, TriangleAlert, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { KioskShell } from "@/components/layout/kiosk-shell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { translate, type MessageKey } from "@/i18n/translate";
import { useLanguage, useT } from "@/i18n/use-t";
import { api, ApiError } from "@/lib/api";
import { prepareFile, PrepareError, type PrepareProblem } from "@/lib/upload/prepare-file";
import { sendFile } from "@/lib/upload/send-file";

/** The link can no longer be used: nothing the driver does here will change that. */
const LINK_GONE: Record<string, MessageKey> = {
  INVALID_CODE: "upload.invalid",
  CODE_EXPIRED: "upload.expired",
  CODE_USED: "upload.used",
  WRONG_STAGE: "upload.closed",
};

const FILE_PROBLEMS: Record<string, MessageKey> = {
  BAD_PHOTO: "upload.badPhoto",
  INVALID_IMAGE: "upload.badPhoto",
  BAD_TYPE: "upload.badType",
  UNSUPPORTED_FILE_TYPE: "upload.badType",
  NO_FILE: "upload.badType",
  TOO_BIG: "upload.tooBig" satisfies MessageKey,
  FILE_TOO_LARGE: "upload.tooBig",
} satisfies Partial<Record<PrepareProblem, MessageKey>> & Record<string, MessageKey>;

type State =
  | { name: "checking" }
  /** The link could not be checked: no network, or too many requests. */
  | { name: "offline"; message: MessageKey }
  | { name: "gone"; message: MessageKey }
  | { name: "ready"; problem: MessageKey | null }
  | { name: "preparing" }
  | { name: "sending"; percent: number }
  | { name: "sent" };

const BIG = "w-full kiosk:min-h-32";

export function UploadPage({ code }: { code: string }) {
  const t = useT();
  const { setLanguage } = useLanguage();
  const [state, setState] = useState<State>({ name: "checking" });
  const [plate, setPlate] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const path = `/api/upload/${encodeURIComponent(code)}`;

  const check = useCallback(() => {
    api
      .get<UploadInfoResponse>(path, { redirectOn401: false })
      .then((info) => {
        setLanguage(info.language);
        setPlate(info.plate);
        setState({ name: "ready", problem: null });
      })
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? LINK_GONE[error.code] : undefined;
        const busy = error instanceof ApiError && error.code === "RATE_LIMITED";
        setState(
          message
            ? { name: "gone", message }
            : { name: "offline", message: busy ? "error.tooMany" : "error.network" },
        );
      });
  }, [path, setLanguage]);
  useEffect(check, [check]);

  async function send(chosen: File | undefined) {
    if (!chosen) return;
    try {
      setState({ name: "preparing" });
      const file = await prepareFile(chosen);
      setState({ name: "sending", percent: 0 });
      await sendFile(path, file, (percent) => setState({ name: "sending", percent }));
      setState({ name: "sent" });
    } catch (error) {
      const reason =
        error instanceof PrepareError ? error.problem : error instanceof ApiError ? error.code : "";
      const gone = LINK_GONE[reason];
      setState(
        gone
          ? { name: "gone", message: gone }
          : { name: "ready", problem: FILE_PROBLEMS[reason] ?? "upload.failed" },
      );
    }
  }

  /** A hidden file picker; the big button opens it. */
  const picker = (ref: typeof camera, name: string, accept: string, capture?: "environment") => (
    <input
      ref={ref}
      type="file"
      accept={accept}
      {...(capture ? { capture } : {})}
      data-testid={`upload-${name}`}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        // So the same file can be chosen again after a failure.
        event.target.value = "";
        void send(file);
      }}
    />
  );

  return (
    <KioskShell
      variant="phone"
      header={{
        icon: Upload,
        title: t("upload.heading"),
        ...(plate ? { subtitle: t("upload.truck", { plate: formatPlate(plate) }) } : {}),
      }}
      actions={
        state.name === "ready" ? (
          <>
            <Button className={BIG} onClick={() => camera.current?.click()}>
              <Camera aria-hidden />
              {t("upload.take")}
            </Button>
            <Button variant="outline" className={BIG} onClick={() => files.current?.click()}>
              <FileUp aria-hidden />
              {t("upload.choose")}
            </Button>
          </>
        ) : state.name === "offline" ? (
          <Button
            className={BIG}
            onClick={() => {
              setState({ name: "checking" });
              check();
            }}
          >
            {t("kiosk.tryAgain")}
          </Button>
        ) : undefined
      }
    >
      {picker(camera, "camera", "image/*", "environment")}
      {picker(files, "file", "image/*,application/pdf,.pdf,.heic,.heif")}

      {state.name === "checking" && (
        <Spinner className="flex-1 flex-col" label={t("upload.checking")} />
      )}

      {state.name === "offline" && (
        <Banner tone="stop">
          {/* No plate yet, so no known language: English and Hindi. */}
          {LANGUAGES.map((language) => (
            <p key={language} role="alert">
              {translate(language, state.message)}
            </p>
          ))}
        </Banner>
      )}

      {state.name === "gone" && (
        <Card className="my-auto items-center text-center" data-testid="upload-gone">
          <TriangleAlert aria-hidden className="size-20 text-wait" />
          {/* Without a plate we do not know the driver's language: say it in both. */}
          {(plate ? [null] : LANGUAGES).map((language) => (
            <p key={language ?? "one"} role="alert" className="font-bold">
              {language ? translate(language, state.message) : t(state.message)}
            </p>
          ))}
        </Card>
      )}

      {state.name === "ready" && (
        <>
          {state.problem && (
            <Banner tone="stop">
              <span role="alert">{t(state.problem)}</span>
            </Banner>
          )}
          <p className="my-auto text-center text-2xl leading-snug">{t("upload.hint")}</p>
        </>
      )}

      {(state.name === "preparing" || state.name === "sending") && (
        <Card className="my-auto items-center text-center">
          <Send aria-hidden className="size-20 text-highlight" />
          <p role="status" className="text-2xl font-bold">
            {state.name === "preparing"
              ? t("upload.preparing")
              : t("upload.sending", { percent: state.percent })}
          </p>
          <progress
            aria-label={t("upload.progress")}
            max={100}
            {...(state.name === "sending" ? { value: state.percent } : {})}
            className="h-4 w-full overflow-hidden rounded-full accent-live"
          />
        </Card>
      )}

      {state.name === "sent" && (
        <Card className="my-auto items-center text-center" data-testid="upload-sent">
          <span
            aria-hidden
            className="inline-flex size-28 items-center justify-center rounded-full bg-go text-go-foreground shadow-go"
          >
            <Check className="size-16" strokeWidth={3.5} />
          </span>
          <p role="status" className="text-3xl leading-snug font-extrabold text-balance">
            {t("upload.sent")}
          </p>
        </Card>
      )}
    </KioskShell>
  );
}
