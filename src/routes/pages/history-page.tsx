import { SurfaceCard } from "@/components/ui/surface-card";

export function HistoryPage() {
  return (
    <SurfaceCard
      eyebrow="Block 7"
      title="History and similarity"
      description="Past analyses, progress charts, and nearest-neighbor clip comparisons will land here after the first end-to-end pipeline works."
    >
      <div className="rounded-[28px] bg-[var(--surface-2)] p-8 text-sm text-[var(--ink-soft)]">
        History feed and similarity modules are intentionally deferred until the analysis path is stable.
      </div>
    </SurfaceCard>
  );
}
