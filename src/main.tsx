import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { ConvexReactClient } from "convex/react";
import { AppProviders } from "@/app/providers";
import { queryClient } from "@/lib/query-client";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

const router = createRouter({
  routeTree,
  context: {
    queryClient,
    convexClient,
  },
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const app = (
  <React.StrictMode>
    <AppProviders convexClient={convexClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root")!).render(app);
