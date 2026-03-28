import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/clerk-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { env } from "@/lib/env";
import { queryClient } from "@/lib/query-client";

type AppProvidersProps = {
  children: ReactNode;
  convexClient: ConvexReactClient | null;
};

export function AppProviders({ children, convexClient }: AppProvidersProps) {
  const queryWrapped = (
    <QueryClientProvider client={queryClient}>
      {convexClient ? (
        <ConvexProvider client={convexClient}>{children}</ConvexProvider>
      ) : (
        children
      )}
    </QueryClientProvider>
  );

  if (!env.clerkPublishableKey || env.demoMode) {
    return queryWrapped;
  }

  return (
    <ClerkProvider publishableKey={env.clerkPublishableKey}>
      {queryWrapped}
    </ClerkProvider>
  );
}
