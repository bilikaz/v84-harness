import { useSyncExternalStore } from "react";

import type { ToolCallRequest } from "../llm/types.ts";
import { createListeners } from "./storage/consumer.ts";

// Tool-approval bridge between the (React-free) driver and the UI. Transient
// runtime state (never persisted), so it's a plain reactive module.
// (Folds into the session engine next — it's per-session-turn runtime.)

export interface PendingApproval {
  id: string;
  sessionId: string;
  call: ToolCallRequest;
  resolve: (ok: boolean) => void;
}

let state: PendingApproval[] = [];
const { subscribe, notify } = createListeners();

function set(next: PendingApproval[]): void {
  state = next;
  notify();
}

export function requestApproval(sessionId: string, call: ToolCallRequest): Promise<boolean> {
  return new Promise((resolve) => {
    set([...state, { id: crypto.randomUUID(), sessionId, call, resolve }]);
  });
}

export function resolveApproval(id: string, ok: boolean): void {
  const a = state.find((p) => p.id === id);
  if (!a) return;
  a.resolve(ok);
  set(state.filter((p) => p.id !== id));
}

// A queued Promise nobody can answer anymore must settle, or the driver's await hangs forever.
export function denyApprovalsForSession(sessionId: string): void {
  const mine = state.filter((p) => p.sessionId === sessionId);
  if (!mine.length) return;
  mine.forEach((p) => p.resolve(false));
  set(state.filter((p) => p.sessionId !== sessionId));
}

export function getPendingApprovals(): PendingApproval[] {
  return state;
}

export function usePendingApprovals(): PendingApproval[] {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// HMR: resolvers belong to the old module instance and would otherwise leak as forever-pending Promises.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    state.forEach((p) => p.resolve(false));
    state = [];
  });
}
