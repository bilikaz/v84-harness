// The Select user-resolution bridge — the React-free graph engine raises a pending selection, the UI
// (SelectModal) renders it and settles the Promise. Same shape as the approval bridge (core/approvals.ts):
// transient runtime state, never persisted. Pattern/ai resolution don't come through here (the engine
// fills those itself); this is only the `source: "user"` path.

import { useSyncExternalStore } from "react";

import { createListeners } from "../storage/consumer.ts";
import type { SelectAnswer, SelectSpec } from "./types.ts";

export interface PendingSelect {
  id: string; // unique per pending request
  sessionId: string;
  spec: SelectSpec;
  resolve: (answer: SelectAnswer | null) => void; // null = cancelled (turn stopped / session gone)
}

let state: PendingSelect[] = [];
const { subscribe, notify } = createListeners();

function set(next: PendingSelect[]): void {
  state = next;
  notify();
}

// Raise a selection for the user to answer; resolves with their picks (or null if cancelled).
export function requestSelect(sessionId: string, spec: SelectSpec): Promise<SelectAnswer | null> {
  return new Promise((resolve) => set([...state, { id: crypto.randomUUID(), sessionId, spec, resolve }]));
}

export function resolveSelect(pendingId: string, selected: string[]): void {
  const p = state.find((x) => x.id === pendingId);
  if (!p) return;
  p.resolve({ id: p.spec.id, selected });
  set(state.filter((x) => x.id !== pendingId));
}

// A queued Promise nobody can answer anymore must settle, or the engine's await hangs forever (mirrors
// denyApprovalsForSession). Called on Stop / session delete.
export function cancelSelectsForSession(sessionId: string): void {
  const mine = state.filter((p) => p.sessionId === sessionId);
  if (!mine.length) return;
  mine.forEach((p) => p.resolve(null));
  set(state.filter((p) => p.sessionId !== sessionId));
}

export function getPendingSelects(): PendingSelect[] {
  return state;
}

export function usePendingSelects(): PendingSelect[] {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    state.forEach((p) => p.resolve(null));
    state = [];
  });
}
