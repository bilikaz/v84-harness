import { useSyncExternalStore } from "react";

// Minimal hash router. The route is everything after "#" (e.g. "settings/provider").
// Navigating a route is what shows/runs a contribution — registry entries carry
// their own `route`.

function getRoute(): string {
  return window.location.hash.replace(/^#\/?/, "");
}

function subscribe(cb: () => void): () => void {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, getRoute, getRoute);
}

export function navigate(route: string): void {
  window.location.hash = route;
}
