import type { ToolCall } from "../providers/types.ts";
import { createStore } from "../lib/store.ts";

// Tool-approval bridge between the (React-free) driver and the UI. The driver
// calls `requestApproval` and awaits the promise; the ApprovalModal renders the
// pending request and resolves it when the user allows/denies. A queue, so
// concurrent sessions (and parallel calls within a step) can each have a
// request outstanding.

export interface PendingApproval {
  id: string;
  sessionId: string;
  call: ToolCall;
  resolve: (ok: boolean) => void;
}

const store = createStore<PendingApproval[]>(null, []);

export function requestApproval(sessionId: string, call: ToolCall): Promise<boolean> {
  return new Promise((resolve) => {
    store.set([...store.get(), { id: crypto.randomUUID(), sessionId, call, resolve }]);
  });
}

export function resolveApproval(id: string, ok: boolean): void {
  const a = store.get().find((p) => p.id === id);
  if (!a) return;
  a.resolve(ok);
  store.set(store.get().filter((p) => p.id !== id));
}

// Deny everything a session still has queued. Called on stop/delete — a Promise
// nobody can answer anymore must settle, or the driver's await hangs forever.
export function denyApprovalsForSession(sessionId: string): void {
  const pending = store.get();
  const mine = pending.filter((p) => p.sessionId === sessionId);
  if (!mine.length) return;
  mine.forEach((p) => p.resolve(false));
  store.set(pending.filter((p) => p.sessionId !== sessionId));
}

export function getPendingApprovals(): PendingApproval[] {
  return store.get();
}

export function usePendingApprovals(): PendingApproval[] {
  return store.use();
}

// HMR: settle (deny) anything pending — the resolvers belong to the old module
// instance and would otherwise leak as forever-pending Promises.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    store.get().forEach((p) => p.resolve(false));
    store.set([]);
  });
}
