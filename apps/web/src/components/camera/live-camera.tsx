"use client";

// A live photo taken inside the page: the back camera, a box to put the number plate in,
// and one big button. There is no way to choose a picture from the gallery. Only where the
// page cannot open a camera at all is the phone's own camera app used, and the photo says
// so ("fallback"). Shared by the supervisor's and (Phase 13) the store officer's pages.
import type { CaptureSource } from "@trinetra/shared";
import { Camera, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MessageKey } from "@/i18n/translate";
import { useT } from "@/i18n/use-t";
import { BACK_CAMERA, CAPTURE_MAX_SIDE, cameraProblem, hasLiveCamera } from "@/lib/camera";
import type { CameraProblem } from "@/lib/camera";
import { drawJpeg, toJpeg } from "@/lib/upload/prepare-file";
import { Banner } from "../ui/banner";
import { Button, buttonVariants } from "../ui/button";
import { Spinner } from "../ui/spinner";

export interface Shot {
  blob: Blob;
  source: CaptureSource;
}

/** What is photographed: it decides the box in the viewfinder and the words under it. */
export type CameraSubject = "plate" | "bill";

const SUBJECTS: Record<CameraSubject, { hint: MessageKey; box: string }> = {
  // A number plate's shape.
  plate: { hint: "camera.hint", box: "aspect-[3/1] w-4/5 max-w-md" },
  // A page held upright.
  bill: { hint: "camera.billHint", box: "aspect-[3/4] h-[92%]" },
};

const PROBLEMS: Record<CameraProblem, MessageKey> = {
  denied: "camera.denied",
  missing: "camera.missing",
  busy: "camera.busy",
  failed: "camera.failed",
};

const DENIED_STEPS: MessageKey[] = ["camera.stepAndroid", "camera.stepIphone", "camera.stepThen"];

function Problem({ problem, onRetry }: { problem: CameraProblem; onRetry: () => void }) {
  const t = useT();
  return (
    <div data-testid="camera-problem" className="flex flex-col gap-3">
      <Banner tone="stop">
        <span role="alert">{t(PROBLEMS[problem])}</span>
      </Banner>
      {problem === "denied" && (
        <ol className="flex list-decimal flex-col gap-2 pl-6">
          {DENIED_STEPS.map((step) => (
            <li key={step}>{t(step)}</li>
          ))}
        </ol>
      )}
      <Button size="lg" onClick={onRetry}>
        <RotateCcw aria-hidden />
        {t("camera.tryAgain")}
      </Button>
    </div>
  );
}

function Viewfinder({ onShot, subject }: { onShot: (shot: Shot) => void; subject: CameraSubject }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let left = false;
    const stop = () => stream?.getTracks().forEach((track) => track.stop());
    navigator.mediaDevices
      .getUserMedia(BACK_CAMERA)
      .then((opened) => {
        stream = opened;
        // The page moved on while the browser was asking.
        if (left || !video.current) return stop();
        video.current.srcObject = opened;
        // The phone may take the camera away, for example for a call.
        opened.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (!left) setProblem("busy");
        });
        return video.current.play();
      })
      .catch((error: unknown) => {
        if (!left) setProblem(cameraProblem(error));
      });
    return () => {
      left = true;
      stop();
    };
  }, [attempt]);

  async function take() {
    const frame = video.current;
    if (!frame || busy) return;
    setBusy(true);
    try {
      const blob = await drawJpeg(frame, frame.videoWidth, frame.videoHeight, CAPTURE_MAX_SIDE);
      onShot({ blob, source: "camera" });
    } catch {
      setProblem("failed");
    }
    setBusy(false);
  }

  if (problem) {
    return (
      <Problem
        problem={problem}
        onRetry={() => {
          setProblem(null);
          setReady(false);
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex min-h-56 items-center justify-center overflow-hidden rounded-xl bg-black">
        {/* The whole frame is shown, so the photo is what is seen. */}
        <video
          ref={video}
          data-testid="camera-video"
          playsInline
          muted
          autoPlay
          onLoadedData={() => setReady(true)}
          className="max-h-[55dvh] w-full object-contain md:max-h-[42dvh]"
        />
        {ready ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            {/* The dark ring around the box draws the eye inside. */}
            <div
              className={`${SUBJECTS[subject].box} rounded-lg border-4 border-white shadow-[0_0_0_100vmax_rgb(0_0_0/0.35)]`}
            />
          </div>
        ) : (
          <Spinner className="absolute inset-0 text-white" label={t("camera.starting")} />
        )}
      </div>
      <p className="text-center text-muted-foreground">{t(SUBJECTS[subject].hint)}</p>
      <Button size="lg" disabled={!ready || busy} onClick={() => void take()}>
        <Camera aria-hidden />
        {t("camera.take")}
      </Button>
    </div>
  );
}

/** For a page that cannot open a camera: the phone's own camera app. */
function CameraApp({ onShot }: { onShot: (shot: Shot) => void }) {
  const t = useT();
  const [failed, setFailed] = useState(false);

  async function chosen(file: File | undefined) {
    if (!file) return;
    setFailed(false);
    try {
      onShot({ blob: await toJpeg(file, CAPTURE_MAX_SIDE), source: "fallback" });
    } catch {
      setFailed(true);
    }
  }

  return (
    <div data-testid="camera-fallback" className="flex flex-col gap-3">
      <Banner tone="wait">{t("camera.noLive")}</Banner>
      {failed && (
        <Banner tone="stop">
          <span role="alert">{t("camera.badPhoto")}</span>
        </Banner>
      )}
      <label className={`${buttonVariants({ size: "lg" })} cursor-pointer`}>
        <Camera aria-hidden />
        {t("camera.take")}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          data-testid="camera-input"
          className="sr-only"
          onChange={(event) => {
            void chosen(event.target.files?.[0]);
            // So the same photo can be chosen again.
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

export function LiveCamera({
  onShot,
  subject = "plate",
}: {
  onShot: (shot: Shot) => void;
  subject?: CameraSubject;
}) {
  // Known only in the browser: the page the server sends cannot tell.
  const live = useSyncExternalStore<boolean | null>(
    () => () => {},
    hasLiveCamera,
    () => null,
  );
  if (live === null) return null;
  return live ? <Viewfinder onShot={onShot} subject={subject} /> : <CameraApp onShot={onShot} />;
}
