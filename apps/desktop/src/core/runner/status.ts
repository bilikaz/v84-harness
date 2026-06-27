// Reactive view of which sessions are queued for a slot — fed by the runner's events, read
// by the UI (the sidebar "waiting" dot). A session maps to its pending slot/lease id while
// queued, and drops out the moment it's granted or released.

import { useSyncExternalStore } from "react";

import { createListeners } from "../storage/consumer.ts";
import type { RunnerEvent } from "./engine.ts";

let waiting: Record<string, string> = {};
const { subscribe, notify } = createListeners();

export function applyRunnerEvent(e: RunnerEvent): void {
  if (e.type === "waiting") {
    if (waiting[e.sessionId] === e.leaseId) return;
    waiting = { ...waiting, [e.sessionId]: e.leaseId };
    notify();
    return;
  }
  // granted (slot acquired) or released — no longer queued.
  if (waiting[e.sessionId] === undefined) return;
  const next = { ...waiting };
  delete next[e.sessionId];
  waiting = next;
  notify();
}

export function getWaiting(): Record<string, string> {
  return waiting;
}

export function useWaiting(): Record<string, string> {
  return useSyncExternalStore(subscribe, () => waiting, () => waiting);
}
