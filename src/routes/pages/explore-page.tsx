import { SurfaceCard } from "@/components/ui/surface-card";

export function ExplorePage() {
  return (
    <SurfaceCard
      eyebrow="Block 2"
      title="Explore exercise library"
      description="This will become the top-level library with muscle group and equipment filters, reference clips, and entry into the analysis flow."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {["Muscle group picker", "Equipment checklist", "Seed exercise cards", "Reference clip drawer"].map((item) => (
          <div key={item} className="rounded-[24px] bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--ink-soft)]">
            {item}
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}
