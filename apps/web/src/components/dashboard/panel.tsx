// A white card with a heading, and optionally a "View all" button.
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { Button } from "../ui/button";
import { SURFACE } from "../ui/card";

export function Panel({
  id,
  icon: Icon,
  title,
  tag,
  viewAll,
  className,
  children,
}: {
  id?: string;
  icon?: LucideIcon;
  title: string;
  /** Beside the title, such as the "Sample" mark. */
  tag?: ReactNode;
  viewAll?: { href: string; label: string };
  className?: string;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <section
      id={id}
      aria-labelledby={heading}
      // The top bar stays in view, so a jump to this card stops below it.
      className={cn(SURFACE, "min-w-0 scroll-mt-24 p-3 md:p-4", className)}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        {Icon && <Icon aria-hidden className="size-6 text-accent-foreground" />}
        <h2 id={heading} className="text-lg font-bold">
          {title}
        </h2>
        {tag}
        {viewAll && (
          <Button asChild variant="outline" size="sm" className="ml-auto min-h-12">
            <Link href={viewAll.href}>{viewAll.label}</Link>
          </Button>
        )}
      </header>
      {children}
    </section>
  );
}
