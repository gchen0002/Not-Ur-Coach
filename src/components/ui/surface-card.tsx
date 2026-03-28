import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SurfaceCardProps = {
  title?: string;
  eyebrow?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
};

export function SurfaceCard({
  title,
  eyebrow,
  description,
  children,
  className,
}: SurfaceCardProps) {
  return (
    <section
      className={cn(
        "rounded-[32px] border border-white/70 bg-[color:var(--surface-1)]/88 p-6 shadow-[var(--shadow-1)] backdrop-blur-xl",
        className,
      )}
    >
      {(eyebrow || title || description) && (
        <header className="mb-5">
          {eyebrow ? (
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent-strong)]">
              {eyebrow}
            </p>
          ) : null}
          {title ? (
            <h2 className="font-display text-2xl tracking-tight text-[var(--ink)]">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
              {description}
            </p>
          ) : null}
        </header>
      )}
      {children}
    </section>
  );
}
