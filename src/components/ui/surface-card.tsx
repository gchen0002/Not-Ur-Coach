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
        "rounded-2xl bg-white p-6 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]",
        className,
      )}
    >
      {(eyebrow || title || description) && (
        <header className="mb-5">
          {eyebrow ? (
            <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              {eyebrow}
            </p>
          ) : null}
          {title ? (
            <h2 className="text-lg font-medium text-[var(--ink)]">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--ink-secondary)]">
              {description}
            </p>
          ) : null}
        </header>
      )}
      {children}
    </section>
  );
}
