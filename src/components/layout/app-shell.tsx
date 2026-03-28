import {
  BoltIcon,
  ChartBarIcon,
  CameraIcon,
  HomeIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { SparklesIcon } from "@heroicons/react/24/solid";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const navigation = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/analyze", label: "Analyze", icon: CameraIcon },
  { to: "/explore", label: "Explore", icon: MagnifyingGlassIcon },
  { to: "/history", label: "History", icon: ChartBarIcon },
  { to: "/day-zero", label: "Day 0", icon: BoltIcon },
];

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--ink)]">
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-20 border-b border-[var(--outline)] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]">
              <SparklesIcon className="h-4 w-4 text-white" />
            </div>
            <span className="text-[15px] font-medium text-[var(--ink)]">Not Ur Coach</span>
          </div>
          <div className="rounded-full border border-[var(--outline)] bg-[var(--surface-2)] px-3.5 py-1.5 text-xs font-medium text-[var(--ink-muted)]">
            Demo Mode
          </div>
        </div>
      </header>

      {/* ─── Layout ─── */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[72px_minmax(0,1fr)] lg:px-8">
        {/* ─── Nav rail ─── */}
        <nav className="lg:sticky lg:top-16 lg:h-[calc(100vh-5rem)]">
          <div className="flex gap-1 rounded-2xl border border-[var(--outline)] bg-white p-1.5 shadow-[var(--shadow-sm)] lg:flex-col lg:gap-0.5">
            {navigation.map(({ to, label, icon: Icon }) => {
              const active = pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  search={{}}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center text-[11px] font-medium transition lg:flex-none",
                    active
                      ? "bg-[var(--accent-light)] text-[var(--accent)]"
                      : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-secondary)]",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* ─── Main content ─── */}
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
