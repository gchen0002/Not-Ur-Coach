import {
  BoltIcon,
  ChartBarIcon,
  CameraIcon,
  HomeIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const navigation = [
  { to: "/", label: "Dashboard", icon: HomeIcon },
  { to: "/analyze", label: "Analyze", icon: CameraIcon },
  { to: "/explore", label: "Explore", icon: MagnifyingGlassIcon },
  { to: "/history", label: "History", icon: ChartBarIcon },
  { to: "/day-zero", label: "Day 0", icon: BoltIcon },
];

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--ink)]">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(123,162,255,0.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(42,209,158,0.12),transparent_24%),linear-gradient(180deg,#f8f9ff_0%,#eef2ff_60%,#edf4f0_100%)]" />
      <header className="sticky top-0 z-20 border-b border-white/60 bg-[color:var(--surface-1)]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--ink-soft)]">
              Not Ur Coach
            </p>
            <h1 className="font-display text-2xl tracking-tight text-[var(--ink)]">
              Hypertrophy Form Intelligence
            </h1>
          </div>
          <div className="rounded-full border border-[var(--outline)] bg-white/70 px-4 py-2 text-sm text-[var(--ink-soft)] shadow-[var(--shadow-1)]">
            Demo Mode active
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[110px_minmax(0,1fr)] lg:px-8">
        <nav className="lg:sticky lg:top-24 lg:h-[calc(100vh-7rem)]">
          <div className="grid grid-cols-5 gap-2 rounded-[28px] border border-white/60 bg-[color:var(--surface-1)]/80 p-2 shadow-[var(--shadow-1)] backdrop-blur-xl lg:grid-cols-1">
            {navigation.map(({ to, label, icon: Icon }) => {
              const active = pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  search={{}}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-[22px] px-2 py-3 text-center text-xs font-medium transition",
                    active
                      ? "bg-[var(--surface-accent)] text-[var(--accent-strong)] shadow-[var(--shadow-1)]"
                      : "text-[var(--ink-soft)] hover:bg-white/70 hover:text-[var(--ink)]",
                  )}
                >
                  <Icon className="h-6 w-6" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
