// Our logo. The image files have a solid navy background; "lighten" lets the navy of the
// rail or sidebar behind them show through, so use them on --nav only.
import { cn } from "cn";
import Image from "next/image";

export const BRAND_NAME = "Trinetra Systems";

/** The eye alone. Beside it, write the name. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/trinetra-logo-mark.png"
      alt=""
      width={135}
      height={87}
      priority
      className={cn("h-auto mix-blend-lighten", className)}
    />
  );
}

/** The eye, the name and the tag line, all in the picture. */
export function LogoFull({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/trinetra-logo-full.png"
      alt={BRAND_NAME}
      width={210}
      height={195}
      priority
      className={cn("h-auto mix-blend-lighten", className)}
    />
  );
}
