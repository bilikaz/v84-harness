import { useSyncExternalStore } from "react";

import type { Session } from "../../lib/types.ts";
import {
  getActive,
  getActiveId,
  getCompacting,
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
