export const env = {
  demoMode: import.meta.env.VITE_DEMO_MODE !== "false",
  clerkPublishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined,
  convexUrl: import.meta.env.VITE_CONVEX_URL as string | undefined,
};
