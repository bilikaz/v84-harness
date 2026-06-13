import { useSyncExternalStore } from "react";

import type { Session } from "./types.ts";
import {
  getActive,
  getActiveId,
  getChildRuns,
  getCompacting,
  getHydrated,
  getSessions,
  getStreaming,
  getStreamingIds,
  subscribe,
} from "./store.ts";

// React bindings over the external store. Components use these; everything else
// in core stays React-free.
export function useSessions(): Session[] {
  return useSyncExternalStore(subscribe, getSessions, getSessions);
}
export function useActiveId(): string {
  return useSyncExternalStore(subscribe, getActiveId, getActiveId);
}
export function useActiveSession(): Session {
  return useSyncExternalStore(subscribe, getActive, getActive);
}
export function useStreaming(): boolean {
  return useSyncExternalStore(subscribe, getStreaming, getStreaming);
}
export function useCompacting(): boolean {
  return useSyncExternalStore(subscribe, getCompacting, getCompacting);
}
export function useStreamingIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getStreamingIds, getStreamingIds);
}
export function useChildRuns(): Record<string, string[]> {
  return useSyncExternalStore(subscribe, getChildRuns, getChildRuns);
}
// True once IndexedDB hydration finishes — gate UI on this to avoid the stale-localStorage flash on first paint.
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getHydrated, getHydrated);
}
