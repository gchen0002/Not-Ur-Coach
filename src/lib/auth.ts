import { env } from "./env";

export function isDemoMode() {
  return env.demoMode;
}

export function requireAuth() {
  return !isDemoMode();
}
