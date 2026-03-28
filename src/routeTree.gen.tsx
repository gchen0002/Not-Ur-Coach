import { Outlet, createRootRouteWithContext, createRoute } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { ConvexReactClient } from "convex/react";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/routes/pages/dashboard-page";
import { AnalyzePage } from "@/routes/pages/analyze-page";
import { ExplorePage } from "@/routes/pages/explore-page";
import { HistoryPage } from "@/routes/pages/history-page";
import { DayZeroPage } from "@/routes/pages/day-zero-page";

type RouterContext = {
  queryClient: QueryClient;
  convexClient: ConvexReactClient | null;
};

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <AppShell />
      <TanStackRouterDevtools position="bottom-right" />
    </>
  ),
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  component: DashboardPage,
});

const analyzeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "analyze",
  component: AnalyzePage,
});

const exploreRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "explore",
  component: ExplorePage,
});

const historyRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "history",
  component: HistoryPage,
});

const dayZeroRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "day-zero",
  component: DayZeroPage,
});

export const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    indexRoute,
    analyzeRoute,
    exploreRoute,
    historyRoute,
    dayZeroRoute,
  ]),
]);
