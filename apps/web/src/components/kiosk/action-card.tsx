// A very big choice with a picture, such as "Choose language" or "Find my truck".
import { cn } from "cn";
import { ArrowRight, type LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";

const TONES = {
  blue: {
    card: "border-primary-edge/70 from-[rgb(20_80_190/45%)] to-[rgb(6_26_66/70%)] shadow-[0_0_2rem_rgb(30_110_255/22%)]",
    icon: "text-[#4aa3ff] drop-shadow-[0_0_1rem_rgb(60_150_255/75%)]",
    arrow: "border-primary-edge/70",
  },
  teal: {
    card: "border-highlight/60 from-[rgb(8_104_108/45%)] to-[rgb(4_34_46/72%)] shadow-[0_0_2rem_rgb(30_210_200/18%)]",
    icon: "text-[#2ee6b8] drop-shadow-[0_0_1rem_rgb(40_230_180/70%)]",
    arrow: "border-highlight/60",
  },
} as const;

export function ActionCard({
  icon: Icon,
  title,
  description,
  tone = "blue",
  className,
  ...props
}: Omit<ComponentProps<"button">, "title" | "children"> & {
  icon: LucideIcon;
  title: string;
  description?: string;
  tone?: keyof typeof TONES;
}) {
  const style = TONES[tone];
  return (
    <button
      type="button"
      data-tone={tone}
      className={cn(
        "flex min-h-72 flex-col items-center justify-center gap-3 rounded-3xl border-2 bg-linear-to-b p-6 text-center text-foreground backdrop-blur-md outline-none",
        "transition-[filter] hover:brightness-110 focus-visible:ring-4 focus-visible:ring-ring disabled:opacity-45",
        style.card,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className={cn("size-24", style.icon)} strokeWidth={1.5} />
      <span className="text-[2.5rem] leading-tight font-bold">{title}</span>
      {description && (
        <span className="text-[2rem] leading-tight text-muted-foreground">{description}</span>
      )}
      <span
        aria-hidden
        className={cn(
          "inline-flex size-16 items-center justify-center rounded-full border-2",
          style.arrow,
        )}
      >
        <ArrowRight className="size-9" />
      </span>
    </button>
  );
}
