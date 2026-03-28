import { SurfaceCard } from "@/components/ui/surface-card";

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <SurfaceCard
        eyebrow="Block 1"
        title="Core scaffold is in place"
        description="This shell is ready for Convex actions, Clerk auth wiring, and the MediaPipe pipeline. The app structure follows the hackathon build order instead of starting from a generic blank page."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Analyze clips", "Upload or record a training set and run the biomechanical pipeline."],
            ["Explore library", "Browse the seeded exercise catalog with equipment-aware filters."],
            ["Track progress", "Compare analyses, rep scoring, and similarity over time."],
          ].map(([title, body]) => (
            <div
              key={title}
              className="rounded-[28px] border border-[var(--outline)] bg-white/80 p-5"
            >
              <h3 className="font-display text-xl tracking-tight">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{body}</p>
            </div>
          ))}
        </div>
      </SurfaceCard>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SurfaceCard
          eyebrow="Current focus"
          title="Day 0 and Block 1"
          description="The critical path is proving MediaPipe works in a worker and keeping the application shell deployable from the start."
        >
          <div className="space-y-4">
            {[
              ["Day 0 spike", "Worker boot, WASM path, test frame, landmark roundtrip"],
              ["Shell", "Top app bar, nav rail, theme tokens, responsive foundation"],
              ["Backend prep", "Convex schema, auth boundary, environment wiring"],
            ].map(([label, detail]) => (
              <div key={label} className="flex items-center justify-between rounded-[24px] bg-[var(--surface-2)] px-4 py-3">
                <span className="font-medium text-[var(--ink)]">{label}</span>
                <span className="text-sm text-[var(--ink-soft)]">{detail}</span>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard
          eyebrow="Environment"
          title="Expected variables"
          description="Use demo mode by default during the hackathon. Real auth and Convex wiring can be layered in without changing route structure."
        >
          <div className="space-y-3 font-mono text-sm text-[var(--ink-soft)]">
            <p>VITE_DEMO_MODE=true</p>
            <p>VITE_CONVEX_URL=...</p>
            <p>VITE_CLERK_PUBLISHABLE_KEY=...</p>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
