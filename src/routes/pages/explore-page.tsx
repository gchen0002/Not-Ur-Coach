import { useEffect, useState } from "react";
import { BookOpenIcon, MagnifyingGlassIcon, PlayCircleIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { useRouter } from "@tanstack/react-router";
import { makeFunctionReference } from "convex/server";
import type { ReferenceClipRequest, ReferenceVideoGenerationResult } from "@/lib/reference-clip-contract";

const MUSCLE_GROUPS = ["All", "Quads", "Glutes", "Hamstrings", "Chest", "Back", "Shoulders", "Arms", "Core"];

const EXERCISES = [
  { name: "Squat", muscles: ["Quads", "Glutes"], category: "Lower" },
  { name: "RDL", muscles: ["Hamstrings", "Glutes"], category: "Lower" },
  { name: "SLDL", muscles: ["Hamstrings", "Glutes"], category: "Lower" },
  { name: "Hip Thrust", muscles: ["Glutes"], category: "Lower" },
  { name: "Leg Press", muscles: ["Quads", "Glutes"], category: "Lower" },
  { name: "Leg Curl", muscles: ["Hamstrings"], category: "Lower" },
  { name: "Bench Press", muscles: ["Chest", "Triceps"], category: "Upper Push" },
  { name: "Incline Press", muscles: ["Upper Chest", "Shoulders"], category: "Upper Push" },
  { name: "Pull-Up / Lat Pulldown", muscles: ["Lats", "Biceps"], category: "Upper Pull" },
  { name: "Row", muscles: ["Upper Back", "Biceps"], category: "Upper Pull" },
  { name: "Overhead Press", muscles: ["Shoulders", "Triceps"], category: "Upper Push" },
  { name: "Bicep Curl", muscles: ["Biceps"], category: "Arms" },
  { name: "Tricep Overhead", muscles: ["Triceps"], category: "Arms" },
  { name: "Lateral Raise", muscles: ["Side Delts"], category: "Shoulders" },
  { name: "RFESS", muscles: ["Quads", "Glutes"], category: "Lower" },
];

export function ExplorePage() {
  const router = useRouter();
  const convexClient = router.options.context.convexClient;
  const [referenceState, setReferenceState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [referenceResult, setReferenceResult] = useState<ReferenceVideoGenerationResult | null>(null);

  useEffect(() => {
    async function loadSavedReference() {
      if (!convexClient) {
        return;
      }

      try {
        const referenceQuery = makeFunctionReference<"query", { exercise: string }, any>(
          "referenceVideos:getByExercise",
        );
        const existing = await convexClient.query(referenceQuery, { exercise: "Squat" });

        if (!existing) {
          return;
        }

        setReferenceResult({
          provider: existing.provider,
          status: existing.status,
          model: existing.model,
          operationName: null,
          videoUri: existing.storageUrl ?? existing.sourceUri ?? null,
          mimeType: null,
          promptPackage: existing.promptPackage,
          error: existing.error ?? null,
        });
        setReferenceState(existing.status === "failed" ? "error" : "done");
      } catch {
        // keep Explore usable even if the lookup fails
      }
    }

    void loadSavedReference();
  }, [convexClient]);

  async function generateSquatReference() {
    setReferenceState("loading");
    setReferenceError(null);

    const request: ReferenceClipRequest = {
      exercise: "Squat",
      muscles: ["Quads", "Glutes"],
      equipment: ["Bodyweight"],
      cameraAngle: "sagittal",
      variant: "bodyweight demo",
      notes:
        "Use the locked Not Ur Coach reference athlete style package with the same athlete, same background, same wardrobe, same lighting, and two ideal reps.",
    };

    try {
      if (!convexClient) {
        throw new Error("Convex is not configured, so reference video generation is unavailable.");
      }

      const generateRef = makeFunctionReference<"action", { request: ReferenceClipRequest }, ReferenceVideoGenerationResult>(
        "generateReferenceVideo:generateReferenceVideo",
      );
      const result = await convexClient.action(generateRef, { request });
      setReferenceResult(result);
      setReferenceState(result.status === "failed" ? "error" : "done");
      setReferenceError(result.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate reference clip.";
      setReferenceState("error");
      setReferenceError(message);
    }
  }

  return (
    <div className="space-y-8 pb-12">
      <div>
        <div className="flex items-center gap-2">
          <BookOpenIcon className="h-5 w-5 text-[var(--accent)]" />
          <h1 className="text-2xl font-normal text-[var(--ink)]">Exercise Library</h1>
        </div>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--ink-secondary)]">
          Browse the seeded exercise catalog. Each exercise has research-backed scoring thresholds for ROM, tempo, and tension.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-[var(--outline)] bg-white px-4 py-3 shadow-[var(--shadow-sm)] transition focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/10">
        <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-[var(--ink-muted)]" />
        <input
          type="text"
          placeholder="Search exercises..."
          className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {MUSCLE_GROUPS.map((group, i) => (
          <button
            key={group}
            className={i === 0
              ? "rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm"
              : "rounded-full border border-[var(--outline)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            }
          >
            {group}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {EXERCISES.map((exercise) => {
          const isSquat = exercise.name === "Squat";
          const videoReady = isSquat && referenceResult?.videoUri;

          return (
            <div
              key={exercise.name}
              className="group rounded-2xl bg-white p-5 text-left shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)] transition hover:shadow-[var(--shadow-md)]"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[15px] font-medium text-[var(--ink)]">{exercise.name}</p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{exercise.muscles.join(", ")}</p>
                </div>
                <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-medium text-[var(--ink-muted)]">
                  {exercise.category}
                </span>
              </div>

              {isSquat ? (
                <div className="mt-4 space-y-3 rounded-2xl bg-[var(--surface-2)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--ink)]">Reference clip</p>
                      <p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">
                        Generate or reopen the seeded squat demo clip under this card.
                      </p>
                    </div>
                    <SparklesIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      void generateSquatReference();
                    }}
                    disabled={referenceState === "loading"}
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PlayCircleIcon className="h-4 w-4" />
                    {referenceState === "loading" ? "Generating..." : "Generate squat reference"}
                  </button>

                  {referenceError ? (
                    <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-6 text-red-700">
                      {referenceError}
                    </div>
                  ) : null}

                  {videoReady ? (
                    <div className="space-y-3">
                      <video
                        src={referenceResult.videoUri ?? undefined}
                        controls
                        className="aspect-video w-full rounded-xl bg-slate-950 object-cover"
                      />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                        <span className="rounded-full bg-white px-3 py-1 shadow-sm">{referenceResult.model}</span>
                        <span className="rounded-full bg-white px-3 py-1 shadow-sm">{referenceResult.provider}</span>
                      </div>
                      <a
                        href={referenceResult.videoUri ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex text-sm font-medium text-[var(--accent)] underline-offset-4 hover:underline"
                      >
                        Open video in new tab
                      </a>
                    </div>
                  ) : referenceResult ? (
                    <div className="rounded-xl bg-white px-3 py-3 text-xs leading-6 text-[var(--ink-muted)] shadow-sm">
                      status: {referenceResult.status} {referenceResult.operationName ? `| op: ${referenceResult.operationName}` : ""}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
