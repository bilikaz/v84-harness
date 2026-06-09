import { useSyncExternalStore } from "react";

import type { Session } from "../../lib/types.ts";
import {
  getActive,
  getActiveId,
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
// True once IndexedDB hydration finishes — gate UI on this to avoid the brief
// stale-localStorage flash on first paint if needed.
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getHydrated, getHydrated);
}
