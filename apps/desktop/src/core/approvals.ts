import { useSyncExternalStore } from "react";

import type { ToolCall } from "../providers/types.ts";

// Tool-approval bridge between the (React-free) driver and the UI. The driver
// calls `requestApproval` and awaits the promise; the ApprovalModal renders the
// pending request and resolves it when the user allows/denies. A queue, so
// concurrent sessions can each have a request outstanding.

export interface PendingApproval {
  id: string;
  sessionId: string;
  call: ToolCall;
  resolve: (ok: boolean) => void;
}

let pending: PendingApproval[] = [];
const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}

export function requestApproval(sessionId: string, call: ToolCall): Promise<boolean> {
  return new Promise((resolve) => {
    pending = [...pending, { id: crypto.randomUUID(), sessionId, call, resolve }];
    emit();
  });
}

export function resolveApproval(id: string, ok: boolean): void {
  const a = pending.find((p) => p.id === id);
  if (!a) return;
  a.resolve(ok);
  pending = pending.filter((p) => p.id !== id);
  emit();
}

function get(): PendingApproval[] {
  return pending;
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function usePendingApprovals(): PendingApproval[] {
  return useSyncExternalStore(subscribe, get, get);
}
