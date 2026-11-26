"use client";

// The front and back ESP32-CAM photos, each shown the moment it arrives, with whether its
// camera is online. There is no live video.
import { CAMERA_IDS, type CameraId } from "@trinetra/shared";
import { cn } from "cn";
import { Camera, CameraOff, LoaderCircle } from "lucide-react";
import { useT } from "@/i18n/use-t";
import { useBridge } from "@/lib/kiosk/bridge";
import { SURFACE } from "../ui/card";
import { StatusLight } from "../ui/status-light";

export function CameraPhotos({
  photos,
  waiting,
  className,
}: {
  photos: Record<CameraId, string | null>;
  /** A read is running: a missing photo may still come. */
  waiting: boolean;
  className?: string;
}) {
  const t = useT();
  const devices = useBridge((state) => state.devices);
  return (
    <div className={cn("grid min-h-0 grid-cols-2 gap-4", className)}>
      {CAMERA_IDS.map((camera) => {
        const online = devices?.[camera] ?? false;
        const url = photos[camera];
        const Icon = waiting && online ? LoaderCircle : online ? Camera : CameraOff;
        return (
          <figure
            key={camera}
            data-testid={`camera-${camera}`}
            className={cn(SURFACE, "flex min-h-0 flex-col gap-2 p-3")}
          >
            <figcaption className="flex items-center justify-between gap-3">
              <span className="font-bold">{t(`kiosk.camera.${camera}`)}</span>
              <StatusLight
                tone={online ? "go" : "stop"}
                label={t(online ? "kiosk.camera.online" : "kiosk.camera.offline")}
              />
            </figcaption>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-field">
              {url ? (
                // A short-lived link from the backend: nothing for Next to optimise.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={t(`kiosk.camera.${camera}`)}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="flex flex-col items-center gap-2 text-center text-muted-foreground">
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-16",
                      Icon === LoaderCircle && "animate-spin motion-reduce:animate-none",
                    )}
                  />
                  {t(waiting && online ? "kiosk.camera.waiting" : "kiosk.camera.noPhoto")}
                </span>
              )}
            </div>
          </figure>
        );
      })}
    </div>
  );
}

/** A number plate, large, as it looks on a truck. */
export function PlateSign({ plate, className }: { plate: string; className?: string }) {
  return (
    <p
      data-testid="plate"
      className={cn(
        "rounded-2xl border-4 border-foreground bg-field px-8 py-2 text-center text-[4.5rem] leading-tight font-extrabold tracking-wider whitespace-nowrap",
        className,
      )}
    >
      {plate}
    </p>
  );
}
