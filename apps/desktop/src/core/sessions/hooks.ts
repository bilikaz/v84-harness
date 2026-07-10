import { sessionBus as bus } from "./events.ts";
import { useEffect, useState, useSyncExternalStore } from "react";

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

// The loop's lifecycle on a session (healing round N / waiting) — so silence is never ambiguous.
// Only transient states surface; running/settled/failed clear the badge.
export function useRunnerState(sid: string): { state: "healing" | "waiting"; round?: number } | null {
  const [st, setSt] = useState<{ state: "healing" | "waiting"; round?: number } | null>(null);
  useEffect(() => {
    setSt(null);
    return bus.on("runner:state", (e) => {
      if (e.sessionId !== sid) return;
      setSt(e.state === "healing" || e.state === "waiting" ? { state: e.state, round: e.round } : null);
    });
  }, [sid]);
  return st;
}
