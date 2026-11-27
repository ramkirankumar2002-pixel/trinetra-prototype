"use client";

// "No phone?": the store officer sends the driver's bill from their own device, as a photo
// taken here or as a file. The backend reads it as it reads the driver's own upload, and
// the weighbridge goes on by itself.
import { useQueryClient } from "@tanstack/react-query";
import type { TicketView, UploadResponse } from "@trinetra/shared";
import { Camera, FileUp, RotateCcw, Send, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { api, type ApiError } from "@/lib/api";
import { useAction } from "@/lib/kiosk/use-action";
import { STORE_KEY, storeTicketKey } from "@/lib/store/queries";
import { PrepareError, prepareFile, type PrepareProblem } from "@/lib/upload/prepare-file";
import { LiveCamera } from "../camera/live-camera";
import { Banner } from "../ui/banner";
import { Button, buttonVariants } from "../ui/button";
import { Card, CardTitle } from "../ui/card";
import { Spinner } from "../ui/spinner";

const FILE_PROBLEMS: Record<PrepareProblem, MessageKey> = {
  BAD_PHOTO: "upload.badPhoto",
  BAD_TYPE: "upload.badType",
  TOO_BIG: "upload.tooBig",
};

const SEND_PROBLEMS: Partial<Record<string, MessageKey>> = {
  NETWORK_ERROR: "error.network",
  SERVER_UNREACHABLE: "error.network",
  RATE_LIMITED: "error.tooMany",
  UNSUPPORTED_FILE_TYPE: "upload.badType",
  INVALID_IMAGE: "upload.badPhoto",
  FILE_TOO_LARGE: "upload.tooBig",
};

export function UploadBill({
  approvalId,
  ticket,
  onSent,
  onRefused,
}: {
  approvalId: number;
  ticket: TicketView;
  /** The backend has the file. */
  onSent: () => void;
  /** Someone else has answered, or the truck has moved on. */
  onRefused: (error: ApiError) => boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { busy, run } = useAction();
  const [camera, setCamera] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  /** The same file sent again after a lost answer keeps its key. */
  const fileNumber = useRef(0);

  function chosen(next: File | null) {
    fileNumber.current += 1;
    setProblem(null);
    setCamera(false);
    setFile(next);
  }

  async function pick(original: File | undefined) {
    if (!original) return;
    setPreparing(true);
    setProblem(null);
    try {
      chosen(await prepareFile(original));
    } catch (error) {
      setProblem(FILE_PROBLEMS[error instanceof PrepareError ? error.problem : "BAD_PHOTO"]);
    }
    setPreparing(false);
  }

  async function send(ready: File) {
    setProblem(null);
    const answer = await run(`bill:${approvalId}:${fileNumber.current}`, async (key) => {
      const form = new FormData();
      form.append("file", ready, ready.name);
      const result = await api.post<UploadResponse>(`/api/store/requests/${approvalId}/invoice`, {
        body: form,
        idempotencyKey: key,
      });
      onSent();
      await queryClient.refetchQueries({ queryKey: storeTicketKey(ticket.id) });
      return result;
    });
    if (!answer) return;
    if (answer.ok) {
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: STORE_KEY });
    } else if (!onRefused(answer.error)) {
      setProblem(SEND_PROBLEMS[answer.error.code] ?? "error.generic");
    }
  }

  // The temporary address of the chosen photo, made with the element and freed with it.
  const showPhoto = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image || !file) return;
      const url = URL.createObjectURL(file);
      image.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [file],
  );

  const { state } = ticket.invoice;
  return (
    <Card data-testid="upload-bill">
      <CardTitle>{t("store.upload.title")}</CardTitle>
      <p className="text-muted-foreground">{t("store.upload.text")}</p>
      {problem && (
        <Banner tone="stop">
          <span role="alert">{t(problem)}</span>
        </Banner>
      )}
      {state === "failed" && !file && !camera && (
        <Banner tone="stop">
          <span role="alert">{t("store.upload.failed")}</span>
        </Banner>
      )}
      {busy ? (
        <Spinner label={t("store.upload.sending")} className="min-h-14" />
      ) : state === "reading" ? (
        <Spinner label={t("kiosk.invoice.reading")} className="min-h-14" />
      ) : preparing ? (
        <Spinner label={t("upload.preparing")} className="min-h-14" />
      ) : file ? (
        <>
          {file.type === "application/pdf" ? (
            <p className="font-semibold">{t("store.upload.pdfReady")}</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- the photo just chosen
            <img
              ref={showPhoto}
              alt={t("store.bill")}
              data-testid="bill-preview"
              className="max-h-[50dvh] w-full rounded-xl bg-muted object-contain"
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Button size="lg" variant="outline" onClick={() => chosen(null)}>
              <RotateCcw aria-hidden />
              {t("store.upload.another")}
            </Button>
            <Button size="lg" onClick={() => void send(file)}>
              <Send aria-hidden />
              {t("store.upload.send")}
            </Button>
          </div>
        </>
      ) : camera ? (
        <>
          <LiveCamera
            subject="bill"
            onShot={(shot) => chosen(new File([shot.blob], "invoice.jpg", { type: "image/jpeg" }))}
          />
          <Button size="lg" variant="outline" onClick={() => setCamera(false)}>
            <X aria-hidden />
            {t("store.upload.closeCamera")}
          </Button>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" onClick={() => setCamera(true)}>
            <Camera aria-hidden />
            {t("upload.take")}
          </Button>
          <label className={`${buttonVariants({ size: "lg", variant: "outline" })} cursor-pointer`}>
            <FileUp aria-hidden />
            {t("upload.choose")}
            <input
              type="file"
              accept="image/*,application/pdf"
              data-testid="bill-file"
              className="sr-only"
              onChange={(event) => {
                void pick(event.target.files?.[0]);
                // So the same file can be chosen again.
                event.target.value = "";
              }}
            />
          </label>
        </div>
      )}
    </Card>
  );
}
