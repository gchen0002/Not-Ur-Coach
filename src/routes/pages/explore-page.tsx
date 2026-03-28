import { BookOpenIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

const MUSCLE_GROUPS = ["All", "Quads", "Glutes", "Hamstrings", "Chest", "Back", "Shoulders", "Arms", "Core"];

const EXERCISES = [
  { name: "Squat", muscles: "Quads, Glutes", category: "Lower" },
  { name: "RDL", muscles: "Hamstrings, Glutes", category: "Lower" },
  { name: "SLDL", muscles: "Hamstrings, Glutes", category: "Lower" },
  { name: "Hip Thrust", muscles: "Glutes", category: "Lower" },
  { name: "Leg Press", muscles: "Quads, Glutes", category: "Lower" },
  { name: "Leg Curl", muscles: "Hamstrings", category: "Lower" },
  { name: "Bench Press", muscles: "Chest, Triceps", category: "Upper Push" },
  { name: "Incline Press", muscles: "Upper Chest, Shoulders", category: "Upper Push" },
  { name: "Pull-Up / Lat Pulldown", muscles: "Lats, Biceps", category: "Upper Pull" },
  { name: "Row", muscles: "Upper Back, Biceps", category: "Upper Pull" },
  { name: "Overhead Press", muscles: "Shoulders, Triceps", category: "Upper Push" },
  { name: "Bicep Curl", muscles: "Biceps", category: "Arms" },
  { name: "Tricep Overhead", muscles: "Triceps", category: "Arms" },
  { name: "Lateral Raise", muscles: "Side Delts", category: "Shoulders" },
  { name: "RFESS", muscles: "Quads, Glutes", category: "Lower" },
];

export function ExplorePage() {
  return (
    <div className="space-y-8 pb-12">
      {/* ─── Header ─── */}
      <div>
        <div className="flex items-center gap-2">
          <BookOpenIcon className="h-5 w-5 text-[var(--accent)]" />
          <h1 className="text-2xl font-normal text-[var(--ink)]">Exercise Library</h1>
        </div>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--ink-secondary)]">
          Browse the seeded exercise catalog. Each exercise has research-backed scoring thresholds for ROM, tempo, and tension.
        </p>
      </div>

      {/* ─── Search ─── */}
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--outline)] bg-white px-4 py-3 shadow-[var(--shadow-sm)] transition focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/10">
        <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-[var(--ink-muted)]" />
        <input
          type="text"
          placeholder="Search exercises..."
          className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
        />
      </div>

      {/* ─── Muscle group chips ─── */}
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

      {/* ─── Exercise grid ─── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {EXERCISES.map((ex) => (
          <button
            key={ex.name}
            className="group rounded-2xl bg-white p-5 text-left shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)] transition hover:shadow-[var(--shadow-md)] active:scale-[0.98]"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[15px] font-medium text-[var(--ink)]">{ex.name}</p>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">{ex.muscles}</p>
              </div>
              <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-medium text-[var(--ink-muted)]">
                {ex.category}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
