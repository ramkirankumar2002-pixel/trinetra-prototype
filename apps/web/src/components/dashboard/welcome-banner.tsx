// The dark card at the top of a dashboard home. The picture is drawn here (no photos).
import { cn } from "cn";
import { MapPin } from "lucide-react";
import type { ReactNode } from "react";

/** A tipper truck, a gravel heap and an excavator, as one soft shape. */
function SiteSilhouette({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 520 150"
      className={className}
      fill="currentColor"
      preserveAspectRatio="xMaxYMax meet"
    >
      {/* ground */}
      <path d="M0 138h520v12H0z" opacity="0.35" />
      {/* gravel heaps */}
      <path d="M290 138l52-34 28 16 22-12 48 30z" opacity="0.45" />
      <path d="M0 138l46-22 30 12 26-8 40 18z" opacity="0.25" />
      {/* tipper truck */}
      <g opacity="0.7">
        <path d="M96 62h116l-8 50H108z" />
        <path d="M216 74h34l22 24v28h-56z" />
        <path d="M100 114h172v10H100z" />
        <circle cx="128" cy="126" r="13" />
        <circle cx="160" cy="126" r="13" />
        <circle cx="246" cy="126" r="13" />
      </g>
      {/* excavator */}
      <g opacity="0.55">
        <path d="M412 122h92a10 10 0 010 20h-92a10 10 0 010-20z" />
        <path d="M434 88h56v34h-56z" />
        <path d="M440 96L396 34l-12 6 30 74z" />
        <path d="M396 34l-44 46 9 8 43-40z" />
        <path d="M352 80l-18 24 30 4 6-18z" />
      </g>
    </svg>
  );
}

export function WelcomeBanner({
  greeting,
  name,
  detail,
  location,
  className,
}: {
  greeting: string;
  name: string;
  detail: string;
  location?: { label: string; value: string; tag?: ReactNode };
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative isolate overflow-hidden rounded-2xl bg-linear-to-r from-nav via-bar-to to-[#1d5190] p-5 text-nav-foreground shadow-card md:p-7",
        className,
      )}
    >
      <SiteSilhouette className="absolute right-0 bottom-0 -z-10 h-[88%] w-full text-[#7fb4f5] opacity-40 sm:right-60 sm:w-1/2 sm:opacity-50" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl leading-tight font-bold md:text-3xl">
            {greeting} <span className="text-[#a8d0ff]">{name}</span>
          </h2>
          <p className="mt-1 text-nav-muted">{detail}</p>
        </div>
        {location && (
          <div className="flex items-center gap-3 self-start rounded-xl border border-white/20 bg-nav/75 px-4 py-2.5 backdrop-blur-sm sm:self-auto">
            <MapPin aria-hidden className="size-6 text-[#7fc0ff]" />
            <p className="flex flex-col leading-tight">
              <span className="text-sm text-nav-muted">{location.label}</span>
              <span className="font-bold">{location.value}</span>
            </p>
            {location.tag}
          </div>
        )}
      </div>
    </section>
  );
}
