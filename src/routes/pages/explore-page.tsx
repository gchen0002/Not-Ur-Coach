import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { BookOpenIcon, MagnifyingGlassIcon, PlusIcon, SparklesIcon, VideoCameraIcon } from "@heroicons/react/24/outline";
import { useRouter } from "@tanstack/react-router";
import { makeFunctionReference } from "convex/server";
import type { EquipmentDetectionRequest, EquipmentDetectionResult } from "@/lib/equipment-detection-contract";
import { SEEDED_EXERCISE_CATALOG } from "@/lib/exercise-catalog";
import type { ExerciseCatalogEntry, ExerciseIntakeRequest, ExerciseIntakeResult } from "@/lib/exercise-intake-contract";
import { resolveExerciseIntake } from "@/lib/exercise-intake-draft";
import { createReferenceClipRequestFromExercise } from "@/lib/reference-clip-draft";
import type { ReferenceClipRequest, ReferenceVideoGenerationResult } from "@/lib/reference-clip-contract";

const MUSCLE_GROUPS = ["All", "Quads", "Glutes", "Hamstrings", "Chest", "Back", "Shoulders", "Arms", "Core"];
const REFERENCE_NOTES =
  "Use the locked Not Ur Coach reference athlete style package with the same athlete, same background, same wardrobe, same lighting, and two ideal reps.";

type PersistedReference = {
  exercise: string;
  provider: string;
  status: string;
  model: string;
  storageUrl: string | null;
  sourceUri?: string | null;
  promptPackage: ReferenceVideoGenerationResult["promptPackage"];
  error?: string | null;
};

type ReferenceState = "idle" | "loading" | "done" | "error";

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function createRequestKey(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return `${Math.abs(hash)}`;
}

function dedupeExercises(exercises: ExerciseCatalogEntry[]) {
  const map = new Map<string, ExerciseCatalogEntry>();

  for (const exercise of exercises) {
    map.set(normalizeName(exercise.name), exercise);
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function toReferenceResult(reference: PersistedReference): ReferenceVideoGenerationResult {
  return {
    provider: reference.provider === "gemini" ? "gemini" : "heuristic",
    status: reference.status === "generated" ? "generated" : reference.status === "pending" ? "pending" : "failed",
    model: reference.model,
    operationName: null,
    videoUri: reference.storageUrl ?? reference.sourceUri ?? null,
    mimeType: null,
    promptPackage: reference.promptPackage,
    error: reference.error ?? null,
  };
}

function matchesMuscleGroup(exercise: ExerciseCatalogEntry, selectedGroup: string) {
  if (selectedGroup === "All") {
    return true;
  }

  const haystack = `${exercise.category} ${exercise.muscles.join(" ")}`.toLowerCase();
  return haystack.includes(selectedGroup.toLowerCase());
}

function buildReferenceRequest(exercise: ExerciseCatalogEntry) {
  return createReferenceClipRequestFromExercise(exercise, {
    variant: `${(exercise.equipment[0] ?? "Bodyweight").toLowerCase()} demo`,
    modelOverride: "veo-3.1",
    notes: REFERENCE_NOTES,
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read equipment photo."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read equipment photo."));
    reader.readAsDataURL(file);
  });
}

export function ExplorePage() {
  const router = useRouter();
  const equipmentPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const exerciseIntakeCacheRef = useRef(new Map<string, ExerciseIntakeResult>());
  const equipmentDetectionCacheRef = useRef(new Map<string, EquipmentDetectionResult>());
  const convexClient = router.options.context.convexClient;
  const [searchValue, setSearchValue] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("All");
  const [showExerciseIntake, setShowExerciseIntake] = useState(false);
  const [exerciseDescription, setExerciseDescription] = useState("");
  const [exerciseIntakeState, setExerciseIntakeState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [exerciseIntakeResult, setExerciseIntakeResult] = useState<ExerciseIntakeResult | null>(null);
  const [catalogExercises, setCatalogExercises] = useState<ExerciseCatalogEntry[]>([]);
  const [referenceResults, setReferenceResults] = useState<Record<string, ReferenceVideoGenerationResult>>({});
  const [referenceStates, setReferenceStates] = useState<Record<string, ReferenceState>>({});
  const [referenceErrors, setReferenceErrors] = useState<Record<string, string | null>>({});
  const [equipmentPhotoDataUrl, setEquipmentPhotoDataUrl] = useState<string | null>(null);
  const [equipmentPhotoName, setEquipmentPhotoName] = useState<string | null>(null);
  const [equipmentPhotoNotes, setEquipmentPhotoNotes] = useState("");
  const [equipmentDetectionState, setEquipmentDetectionState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [equipmentDetectionResult, setEquipmentDetectionResult] = useState<EquipmentDetectionResult | null>(null);
  const [savedEquipment, setSavedEquipment] = useState<string[]>([]);

  const allExercises = useMemo(
    () => dedupeExercises([...SEEDED_EXERCISE_CATALOG, ...catalogExercises]),
    [catalogExercises],
  );

  const filteredExercises = useMemo(() => {
    const query = searchValue.trim().toLowerCase();

    return allExercises.filter((exercise) => {
      const matchesSearch = query.length === 0 || `${exercise.name} ${exercise.muscles.join(" ")} ${exercise.category} ${exercise.equipment.join(" ")}`
        .toLowerCase()
        .includes(query);

      return matchesSearch && matchesMuscleGroup(exercise, selectedGroup);
    });
  }, [allExercises, searchValue, selectedGroup]);

  useEffect(() => {
    async function loadExploreData() {
      if (!convexClient) {
        return;
      }

      try {
        const catalogRef = makeFunctionReference<"query", Record<string, never>, ExerciseCatalogEntry[]>(
          "exercises:listCatalog",
        );
        const referenceRef = makeFunctionReference<"query", Record<string, never>, PersistedReference[]>(
          "referenceVideos:listAll",
        );
        const savedEquipmentRef = makeFunctionReference<"query", Record<string, never>, string[]>(
          "users:getSavedEquipment",
        );
        const [catalog, references, saved] = await Promise.all([
          convexClient.query(catalogRef, {}),
          convexClient.query(referenceRef, {}),
          convexClient.query(savedEquipmentRef, {}),
        ]);

        setCatalogExercises(catalog);
        setSavedEquipment(saved);
        setReferenceResults(
          references.reduce<Record<string, ReferenceVideoGenerationResult>>((accumulator, reference) => {
            accumulator[normalizeName(reference.exercise)] = toReferenceResult(reference);
            return accumulator;
          }, {}),
        );
        setReferenceStates(
          references.reduce<Record<string, ReferenceState>>((accumulator, reference) => {
            accumulator[normalizeName(reference.exercise)] = reference.status === "failed" ? "error" : "done";
            return accumulator;
          }, {}),
        );
      } catch {
        // ignore boot-time hydrate failures for demo mode
      }
    }

    void loadExploreData();
  }, [convexClient]);

  async function generateReferenceForRequest(exerciseName: string, request: ReferenceClipRequest) {
    const key = normalizeName(exerciseName);
    const currentResult = referenceResults[key];

    if (currentResult?.status === "generated" && currentResult.videoUri) {
      return currentResult;
    }

    setReferenceStates((current) => ({ ...current, [key]: "loading" }));
    setReferenceErrors((current) => ({ ...current, [key]: null }));

    try {
      if (!convexClient) {
        throw new Error("Convex is not configured, so reference video generation is unavailable.");
      }

      const generateRef = makeFunctionReference<"action", { request: ReferenceClipRequest }, ReferenceVideoGenerationResult>(
        "generateReferenceVideo:generateReferenceVideo",
      );
      const result = await convexClient.action(generateRef, { request });

      setReferenceResults((current) => ({ ...current, [key]: result }));
      setReferenceStates((current) => ({ ...current, [key]: result.status === "failed" ? "error" : "done" }));
      setReferenceErrors((current) => ({ ...current, [key]: result.error }));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate reference clip.";
      setReferenceStates((current) => ({ ...current, [key]: "error" }));
      setReferenceErrors((current) => ({ ...current, [key]: message }));
      return null;
    }
  }

  async function generateReferenceForExercise(exercise: ExerciseCatalogEntry) {
    await generateReferenceForRequest(exercise.name, buildReferenceRequest(exercise));
  }

  async function handleExerciseIntake() {
    const description = exerciseDescription.trim();
    const cacheKey = createRequestKey(description.toLowerCase());

    if (!description) {
      return;
    }

    const cached = exerciseIntakeCacheRef.current.get(cacheKey);
    if (cached) {
      setExerciseIntakeResult(cached);
      setExerciseIntakeState(cached.status === "unclear" ? "error" : "done");

      if (cached.generatedExercise) {
        setCatalogExercises((current) => dedupeExercises([...current, cached.generatedExercise!]));
      }

      return;
    }

    setExerciseIntakeState("loading");
    setExerciseIntakeResult(null);

    const localResult = resolveExerciseIntake({ description }, allExercises);

    try {
      const result = !convexClient
        ? localResult
        : await convexClient.action(
          makeFunctionReference<"action", { request: ExerciseIntakeRequest }, ExerciseIntakeResult>(
            "generateExercise:generateExercise",
          ),
          { request: { description } },
        );

      exerciseIntakeCacheRef.current.set(cacheKey, result);
      setExerciseIntakeResult(result);
      setExerciseIntakeState(result.status === "unclear" ? "error" : "done");

      if (result.generatedExercise) {
        setCatalogExercises((current) => dedupeExercises([...current, result.generatedExercise!]));
      }
    } catch {
      exerciseIntakeCacheRef.current.set(cacheKey, localResult);
      setExerciseIntakeResult(localResult);
      setExerciseIntakeState(localResult.status === "unclear" ? "error" : "done");

      if (localResult.generatedExercise) {
        setCatalogExercises((current) => dedupeExercises([...current, localResult.generatedExercise!]));
      }
    }
  }

  async function handleEquipmentPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setEquipmentPhotoDataUrl(await readFileAsDataUrl(file));
      setEquipmentPhotoName(file.name);
      setEquipmentDetectionResult(null);
      setEquipmentDetectionState("idle");
    } catch (error) {
      setEquipmentDetectionState("error");
      setEquipmentDetectionResult({
        provider: "heuristic",
        detectedEquipment: [],
        summary: "",
        error: error instanceof Error ? error.message : "Failed to load equipment photo.",
      });
    }
  }

  async function detectEquipmentFromPhoto() {
    if (!equipmentPhotoDataUrl) {
      return;
    }

    const cacheKey = createRequestKey(`${equipmentPhotoDataUrl}:${equipmentPhotoNotes.trim().toLowerCase()}`);
    const cached = equipmentDetectionCacheRef.current.get(cacheKey);

    if (cached) {
      setEquipmentDetectionResult(cached);
      setEquipmentDetectionState(cached.error ? "error" : "done");
      return;
    }

    setEquipmentDetectionState("loading");
    setEquipmentDetectionResult(null);

    try {
      if (!convexClient) {
        throw new Error("Convex is not configured, so equipment photo recognition is unavailable.");
      }

      const identifyRef = makeFunctionReference<"action", { request: EquipmentDetectionRequest }, EquipmentDetectionResult>(
        "identifyEquipment:identifyEquipment",
      );
      const result = await convexClient.action(identifyRef, {
        request: {
          imageDataUrl: equipmentPhotoDataUrl,
          notes: equipmentPhotoNotes.trim() || undefined,
        },
      });

      equipmentDetectionCacheRef.current.set(cacheKey, result);
      setEquipmentDetectionResult(result);
      setEquipmentDetectionState(result.error ? "error" : "done");
    } catch (error) {
      setEquipmentDetectionState("error");
      setEquipmentDetectionResult({
        provider: "heuristic",
        detectedEquipment: [],
        summary: "",
        error: error instanceof Error ? error.message : "Equipment identification failed.",
      });
    }
  }

  async function saveDetectedEquipment() {
    const names = equipmentDetectionResult?.detectedEquipment.map((item) => item.matchedCatalogName) ?? [];

    if (names.length === 0) {
      return;
    }

    if (!convexClient) {
      setSavedEquipment(names);
      return;
    }

    const saveRef = makeFunctionReference<"mutation", { names: string[] }, string[]>("users:saveSavedEquipment");
    const saved = await convexClient.mutation(saveRef, { names });
    setSavedEquipment(saved);
  }

  return (
    <div className="space-y-8 pb-12">
      <div>
        <div className="flex items-center gap-2">
          <BookOpenIcon className="h-5 w-5 text-[var(--accent)]" />
          <h1 className="text-2xl font-normal text-[var(--ink)]">Exercise Library</h1>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--ink-secondary)]">
          Browse the seeded catalog, generate reference videos only when you ask for them, and turn unknown movements into saved AI-generated exercises that are ready for a manual reference pass.
        </p>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">Equipment photo recognition</p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
              Snap the booth setup, let Gemini match the visible equipment, then save the detected gear to the demo profile for Explore filtering.
            </p>
          </div>
          <SparklesIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3">
            <input
              ref={equipmentPhotoInputRef}
              type="file"
              accept="image/*"
              onChange={(event) => {
                void handleEquipmentPhotoChange(event);
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => equipmentPhotoInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--outline)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <PlusIcon className="h-4 w-4" />
              {equipmentPhotoName ? `Change photo (${equipmentPhotoName})` : "Upload equipment photo"}
            </button>

            <textarea
              value={equipmentPhotoNotes}
              onChange={(event) => setEquipmentPhotoNotes(event.target.value)}
              rows={2}
              placeholder="Optional note: barbell, squat rack, flat bench, and plates"
              className="w-full rounded-2xl border border-[var(--outline)] bg-[var(--surface-1)] px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
            />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  void detectEquipmentFromPhoto();
                }}
                disabled={!equipmentPhotoDataUrl || equipmentDetectionState === "loading"}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {equipmentDetectionState === "loading" ? "Checking photo..." : "Detect equipment"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveDetectedEquipment();
                }}
                disabled={!equipmentDetectionResult || equipmentDetectionResult.detectedEquipment.length === 0}
                className="rounded-full border border-[var(--outline)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save detected gear
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {equipmentPhotoDataUrl ? (
              <img
                src={equipmentPhotoDataUrl}
                alt="Uploaded equipment"
                className="h-48 w-full rounded-2xl object-cover ring-1 ring-[var(--outline)]"
              />
            ) : (
              <div className="flex h-48 items-center justify-center rounded-2xl bg-[var(--surface-2)] text-sm text-[var(--ink-muted)] ring-1 ring-[var(--outline)]">
                Upload a gym setup photo to detect equipment.
              </div>
            )}

            <div className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-secondary)]">
              <p className="font-medium text-[var(--ink)]">Saved equipment</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {savedEquipment.length > 0 ? savedEquipment.map((item) => (
                  <span key={item} className="rounded-full bg-white px-3 py-1 text-xs shadow-sm">
                    {item}
                  </span>
                )) : (
                  <span className="text-[var(--ink-muted)]">No saved equipment yet.</span>
                )}
              </div>
              {equipmentDetectionResult ? (
                <div className="mt-4">
                  <p className="font-medium text-[var(--ink)]">Latest detection</p>
                  <p className="mt-2 leading-6">{equipmentDetectionResult.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {equipmentDetectionResult.detectedEquipment.map((item) => (
                      <span key={`${item.matchedCatalogName}-${item.confidence}`} className="rounded-full bg-white px-3 py-1 text-xs shadow-sm">
                        {item.matchedCatalogName} {Math.round(item.confidence * 100)}%
                      </span>
                    ))}
                  </div>
                  {equipmentDetectionResult.error ? (
                    <p className="mt-3 text-red-700">{equipmentDetectionResult.error}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--outline)] bg-white px-4 py-3 shadow-[var(--shadow-sm)] transition focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/10 lg:flex-1">
          <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-[var(--ink-muted)]" />
          <input
            type="text"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search exercises or equipment..."
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowExerciseIntake((value) => !value)}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--outline)] bg-white px-4 py-3 text-sm font-medium text-[var(--ink)] shadow-[var(--shadow-sm)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <PlusIcon className="h-4 w-4" />
          Add exercise
        </button>
      </div>

      {showExerciseIntake ? (
        <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[var(--ink)]">Describe an exercise</p>
              <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                The app checks the seeded catalog first. If the movement is new, it saves an AI-generated exercise draft. Reference video generation stays manual from the exercise card.
              </p>
            </div>
            <SparklesIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" />
          </div>

          <div className="mt-4 space-y-3">
            <textarea
              value={exerciseDescription}
              onChange={(event) => setExerciseDescription(event.target.value)}
              rows={3}
              placeholder="Example: front-foot-elevated Bulgarian split squat with dumbbells"
              className="w-full rounded-2xl border border-[var(--outline)] bg-[var(--surface-1)] px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleExerciseIntake();
                }}
                disabled={exerciseIntakeState === "loading" || exerciseDescription.trim().length === 0}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exerciseIntakeState === "loading" ? "Checking..." : "Check or generate"}
              </button>
            </div>

            {exerciseIntakeResult ? (
              <div className="rounded-2xl bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-secondary)]">
                {exerciseIntakeResult.status === "matched" && exerciseIntakeResult.matchedExercise ? (
                  <div className="space-y-2">
                    <p className="font-medium text-[var(--ink)]">This already looks like an existing exercise.</p>
                    <p>
                      Match: <span className="font-medium text-[var(--accent)]">{exerciseIntakeResult.matchedExercise.name}</span>
                    </p>
                  </div>
                ) : null}

                {exerciseIntakeResult.status === "generated" && exerciseIntakeResult.generatedExercise ? (
                  <div className="space-y-2">
                    <p className="font-medium text-[var(--ink)]">Saved as an AI-generated exercise draft.</p>
                    <p>
                      Draft: <span className="font-medium text-[var(--accent)]">{exerciseIntakeResult.generatedExercise.name}</span>
                    </p>
                    <p>{exerciseIntakeResult.generatedExercise.summary}</p>
                    <p className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">
                      {exerciseIntakeResult.generatedExercise.equipment.join(" • ")} | {exerciseIntakeResult.generatedExercise.defaultCameraAngle}
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">Generate the reference clip manually from the new exercise card if you want one.</p>
                  </div>
                ) : null}

                {exerciseIntakeResult.suggestions.length > 0 ? (
                  <div className="pt-2">
                    <p className="text-xs uppercase tracking-wider text-[var(--ink-muted)]">Closest matches</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {exerciseIntakeResult.suggestions.map((suggestion) => (
                        <span key={suggestion.name} className="rounded-full bg-white px-3 py-1 text-xs shadow-sm">
                          {suggestion.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {exerciseIntakeResult.error ? <p className="pt-2 text-red-700">{exerciseIntakeResult.error}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {MUSCLE_GROUPS.map((group) => {
          const active = selectedGroup === group;
          return (
            <button
              key={group}
              type="button"
              onClick={() => setSelectedGroup(group)}
              className={active
                ? "rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm"
                : "rounded-full border border-[var(--outline)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              }
            >
              {group}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredExercises.map((exercise) => {
          const key = normalizeName(exercise.name);
          const referenceResult = referenceResults[key];
          const referenceState = referenceStates[key] ?? "idle";
          const referenceError = referenceErrors[key] ?? null;
          const videoReady = Boolean(referenceResult?.videoUri);

          return (
            <div
              key={exercise.name}
              className="group rounded-2xl bg-white p-5 text-left shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)] transition hover:shadow-[var(--shadow-md)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-medium text-[var(--ink)]">{exercise.name}</p>
                    {exercise.isAiGenerated ? (
                      <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                        AI generated
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{exercise.muscles.join(", ")}</p>
                </div>
                <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-medium text-[var(--ink-muted)]">
                  {exercise.category}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {exercise.equipment.map((item) => (
                  <span key={`${exercise.name}-${item}`} className="rounded-full border border-[var(--outline)] bg-[var(--surface-1)] px-3 py-1 text-xs text-[var(--ink-secondary)]">
                    {item}
                  </span>
                ))}
              </div>

              {exercise.summary ? (
                <p className="mt-4 text-sm leading-6 text-[var(--ink-secondary)]">{exercise.summary}</p>
              ) : null}

              {videoReady && referenceResult ? (
                <div className="mt-4 space-y-3">
                  <video
                    src={referenceResult.videoUri ?? undefined}
                    controls
                    className="aspect-video w-full rounded-xl bg-slate-950 object-cover"
                  />
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    {referenceResult.status} | {referenceResult.model}
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl bg-[var(--surface-2)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--ink)]">Reference clip</p>
                      <p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">
                        Generate an ideal-form demo clip for this exercise card.
                      </p>
                    </div>
                    <VideoCameraIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void generateReferenceForExercise(exercise);
                    }}
                    disabled={referenceState === "loading"}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {referenceState === "loading" ? "Generating..." : "Generate reference"}
                  </button>
                  {referenceError ? (
                    <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-6 text-red-700">
                      {referenceError}
                    </div>
                  ) : null}
                  {referenceResult ? (
                    <div className="mt-3 rounded-xl bg-white px-3 py-3 text-xs leading-6 text-[var(--ink-muted)] shadow-sm">
                      status: {referenceResult.status} {referenceResult.model ? `| ${referenceResult.model}` : ""}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
