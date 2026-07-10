// Settlement events, persisted WAITS, and the pending-message INBOX (implementation.md) — the data
// layer that makes "boot = resume" true. Pure stores over a pluggable persistence port: settled data
// is recorded (replayable), pending children re-arm listeners on load, and injection into a busy
// session is never refused — it queues and drains at the next cycle boundary. No engine imports.

// ── Settlement — ONE event, two forms; data travels, nobody holds a return address ────────────────

export interface Settlement {
  sessionId: string;
  ok: boolean;
  data: string; // the settled text/JSON (ok) or the fault reason (fail)
}

type SettleListener = (s: Settlement) => void;

const listeners = new Map<string, Set<SettleListener>>(); // sessionId → listeners

// Listen for a session's settlement. Multiple listeners per session are the point — a parent Call,
// the UI card, persistence can all consume one settlement. Returns the unsubscribe.
export function onSettle(sessionId: string, fn: SettleListener): () => void {
  const set = listeners.get(sessionId) ?? new Set();
  set.add(fn);
  listeners.set(sessionId, set);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(sessionId);
  };
}

// Emit a settlement — called by the loop when a contract settles (ok or fail). Listeners fire once;
// whoever needs durable knowledge records it as a wait arrival (below).
export function emitSettlement(s: Settlement): void {
  const set = listeners.get(s.sessionId);
  if (!set) return;
  listeners.delete(s.sessionId);
  for (const fn of [...set]) fn(s);
}

// ── Waits — the persisted "A settled (data stored), B and C still running" record ────────────────

// One wait = one waiter (a session's pending Call fan, a graph join) tracking its children. Arrivals
// store the settlement DATA so a restart replays it without re-running the child.
export interface WaitRecord {
  id: string; // the waiter's handle (e.g. the tool call id of the pending Call)
  sessionId: string; // the WAITING session (the record rides its persistence)
  children: Record<string, { settled: boolean; ok?: boolean; data?: string }>; // childSid → arrival
}

// The persistence port — wired by the host (session meta / a repo); in-memory default for tests.
export interface WaitStore {
  put(w: WaitRecord): void;
  get(id: string): WaitRecord | undefined;
  delete(id: string): void;
  forSession(sessionId: string): WaitRecord[];
}

export function memoryWaitStore(): WaitStore {
  const rows = new Map<string, WaitRecord>();
  return {
    put: (w) => rows.set(w.id, w),
    get: (id) => rows.get(id),
    delete: (id) => rows.delete(id),
    forSession: (sid) => [...rows.values()].filter((w) => w.sessionId === sid),
  };
}

// Open a wait over children and resolve when EVERY child has arrived. Settled children replay from
// the record (restart-safe); pending ones re-arm settlement listeners. `onArrival` fires per child
// (persist + progress); the returned promise resolves with all arrivals.
export function awaitChildren(
  store: WaitStore,
  record: WaitRecord,
  onArrival?: (record: WaitRecord) => void,
): Promise<WaitRecord> {
  store.put(record);
  return new Promise((resolve) => {
    const check = (): void => {
      if (Object.values(record.children).every((c) => c.settled)) {
        store.delete(record.id);
        resolve(record);
      }
    };
    for (const [childSid, arrival] of Object.entries(record.children)) {
      if (arrival.settled) continue; // replayed from the record — already durable
      onSettle(childSid, (s) => {
        record.children[childSid] = { settled: true, ok: s.ok, data: s.data };
        store.put(record);
        onArrival?.(record);
        check();
      });
    }
    check(); // all-replayed (or empty) resolves immediately
  });
}

// ── The pending inbox — injection into a busy session queues, never blocks, never interrupts ──────

export interface PendingMessage {
  id: string;
  sessionId: string;
  text: string;
  queuedAt: number; // stamped at injection; the DRAIN moment becomes the transcript date so order holds
  from?: string; // provenance (a child sid, "user", a graph nudge) — receivers may render it
}

export interface InboxStore {
  push(m: PendingMessage): void;
  drain(sessionId: string): PendingMessage[]; // returns AND removes, injection order preserved
  peek(sessionId: string): PendingMessage[];
}

export function memoryInbox(): InboxStore {
  const rows = new Map<string, PendingMessage[]>();
  return {
    push: (m) => rows.set(m.sessionId, [...(rows.get(m.sessionId) ?? []), m]),
    drain: (sid) => {
      const out = rows.get(sid) ?? [];
      rows.delete(sid);
      return out;
    },
    peek: (sid) => rows.get(sid) ?? [],
  };
}
