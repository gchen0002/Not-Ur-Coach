import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  CameraIcon,
  ArrowUpTrayIcon,
  ChatBubbleBottomCenterTextIcon,
  ChartBarSquareIcon,
  BookOpenIcon,
  ShieldCheckIcon,
  SparklesIcon,
  ArrowTrendingUpIcon,
} from "@heroicons/react/24/outline";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: CameraIcon,
    title: "Record or upload",
    desc: "Film your set with the in-app camera or upload an existing clip. Our pose pipeline extracts 33 landmarks per frame.",
    color: "bg-blue-50 text-blue-600",
  },
  {
    icon: SparklesIcon,
    title: "AI analysis",
    desc: "Gemini evaluates your ROM, tension profile, tempo, symmetry, and fatigue across every rep with research citations.",
    color: "bg-violet-50 text-violet-600",
  },
  {
    icon: ChatBubbleBottomCenterTextIcon,
    title: "Coach chat",
    desc: "Ask follow-up questions. \"Why was my symmetry low?\" \"What cue helps knee cave?\" Grounded in your actual analysis.",
    color: "bg-emerald-50 text-emerald-600",
  },
  {
    icon: ArrowTrendingUpIcon,
    title: "Track progress",
    desc: "See how your scores change over time. Compare sessions, find your best clips, and spot fatigue patterns.",
    color: "bg-amber-50 text-amber-600",
  },
];

const EXERCISES_PREVIEW = [
  "Squat", "RDL", "SLDL", "Hip Thrust", "Bench Press", "Incline Press",
  "Pull-Up", "Row", "OHP", "Bicep Curl", "Tricep OH", "Lateral Raise",
];

export function DashboardPage() {
  return (
    <div className="space-y-12 pb-12">
      {/* ─── Hero ─── */}
      <div className="relative overflow-hidden rounded-[32px] bg-[#f0f4ff] px-8 pb-10 pt-12 md:px-12 md:pt-16">
        <div className="absolute -right-16 top-8 h-64 w-64 rounded-full bg-[#c7d2fe]/60 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-[#ddd6fe]/50 blur-2xl" />

        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-1.5 text-xs font-medium text-[#4f46e5] shadow-sm backdrop-blur">
            <SparklesIcon className="h-3.5 w-3.5" />
            Powered by Gemini
          </div>
          <h1 className="mt-6 text-4xl font-normal leading-[1.15] tracking-tight text-[#0f172a] md:text-[56px]">
            Know your form.<br />
            <span className="text-[#4f46e5]">Train smarter.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-[#475569]">
            Upload a training clip and get instant, research-backed biomechanical feedback on every rep.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/analyze"
              search={{}}
              className="inline-flex items-center gap-2 rounded-full bg-[#4f46e5] px-7 py-4 text-[15px] font-medium text-white shadow-lg shadow-[#4f46e5]/20 transition hover:shadow-xl active:scale-[0.98]"
            >
              Get started
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link
              to="/analyze"
              search={{}}
              className="inline-flex items-center gap-2 rounded-full border border-[#e2e8f0] bg-white px-7 py-4 text-[15px] font-medium text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc]"
            >
              <ArrowUpTrayIcon className="h-4 w-4" />
              Upload clip
            </Link>
          </div>
        </div>
      </div>

      {/* ─── How it works ─── */}
      <div>
        <h2 className="text-center text-sm font-medium uppercase tracking-[0.25em] text-[#94a3b8]">How it works</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="rounded-[24px] bg-white p-6 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)] transition hover:shadow-[var(--shadow-md)]">
              <div className="flex items-start gap-4">
                <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", f.color)}>
                  <f.icon className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-2)] text-[10px] font-semibold text-[var(--ink-secondary)]">{i + 1}</span>
                    <h3 className="text-base font-medium text-[var(--ink)]">{f.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--ink-secondary)]">{f.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Exercise library preview ─── */}
      <div className="rounded-[28px] bg-[var(--surface-tint)] p-6 ring-1 ring-[var(--outline)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpenIcon className="h-5 w-5 text-[var(--accent)]" />
            <h2 className="text-base font-medium text-[var(--ink)]">Exercise Library</h2>
          </div>
          <Link
            to="/explore"
            search={{}}
            className="rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium text-[var(--accent)]"
          >
            15 exercises
          </Link>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {EXERCISES_PREVIEW.map((ex) => (
            <span
              key={ex}
              className="rounded-full border border-[var(--outline)] bg-white px-4 py-2 text-sm font-medium text-[var(--ink-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {ex}
            </span>
          ))}
        </div>
      </div>

      {/* ─── Trust blocks ─── */}
      <div className="grid gap-5 md:grid-cols-3">
        {[
          {
            icon: ShieldCheckIcon,
            title: "Privacy first",
            desc: "Raw video stays on your device. Only pose data and key frames are processed.",
            bg: "bg-emerald-50",
            iconColor: "text-emerald-600",
          },
          {
            icon: SparklesIcon,
            title: "Research-backed",
            desc: "Scoring thresholds sourced from EMG studies and length-tension research.",
            bg: "bg-violet-50",
            iconColor: "text-violet-600",
          },
          {
            icon: ChartBarSquareIcon,
            title: "Dual mode",
            desc: "Switch between basic coaching cues and nerd-mode with full citations and angle breakdowns.",
            bg: "bg-blue-50",
            iconColor: "text-blue-600",
          },
        ].map((item) => (
          <div key={item.title} className={cn("rounded-[24px] p-6", item.bg)}>
            <item.icon className={cn("h-7 w-7", item.iconColor)} />
            <h3 className="mt-4 text-base font-medium text-[var(--ink)]">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-secondary)]">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* ─── Bottom CTA ─── */}
      <div className="text-center">
        <h2 className="text-2xl font-normal text-[var(--ink)] md:text-3xl">
          Ready to analyze your form?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-base text-[var(--ink-secondary)]">
          Start with a single clip. No account needed during the hackathon demo.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/analyze"
            search={{}}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-7 py-4 text-[15px] font-medium text-white shadow-lg shadow-[#4f46e5]/20 transition hover:shadow-xl"
          >
            <CameraIcon className="h-5 w-5" />
            Open camera
          </Link>
          <Link
            to="/analyze"
            search={{}}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--outline)] bg-white px-7 py-4 text-[15px] font-medium text-[var(--ink)] shadow-sm transition hover:bg-[var(--surface-2)]"
          >
            <ArrowUpTrayIcon className="h-5 w-5" />
            Upload clip
          </Link>
        </div>
      </div>
    </div>
  );
}
