// Generic typed event bus — domain-agnostic. The core knows NO events; each
// feature declares its own by augmenting `BusEvents` (TS declaration merging),
// see core/sessions/events.ts. Naming convention: keys are "<domain>:<event>",
// e.g. "session:text" now, "api:request" / "tools:call" later. emit/on are
// generic over the merged map, so the name is a checked key and the payload is
// checked against that event's type.
//
// This is for APP-DOMAIN events. The raw model stream (SSE) is a separate
// transport layer — see providers/ `StreamEvent` — which the session driver
// consumes and re-publishes as "session:*" events.

import { errorMessage } from "./errors.ts";
import { rootLog } from "./logger/index.ts";

const log = rootLog.child("bus");

// Augmented per-domain (declaration merging). Empty here on purpose.
export interface BusEvents {}

export type BusEventType = keyof BusEvents;
type Handler<K extends BusEventType> = (payload: BusEvents[K]) => void;
type AnyHandler = (payload: unknown) => void;

const registry = new Map<BusEventType, Set<AnyHandler>>();

// Subscribe to one event type. Returns an unsubscribe fn.
export function on<K extends BusEventType>(type: K, handler: Handler<K>): () => void {
  let set = registry.get(type);
  if (!set) registry.set(type, (set = new Set()));
  set.add(handler as AnyHandler);
  return () => set!.delete(handler as AnyHandler);
}

// Fire an event to that type's subscribers (synchronous, registration order).
// Each handler is isolated: one throwing must not silence the handlers behind
// it (the transcript listener still has to see the event a buggy service
// crashed on).
export function emit<K extends BusEventType>(type: K, payload: BusEvents[K]): void {
  const set = registry.get(type);
  if (!set) return;
  for (const h of set) {
    try {
      (h as Handler<K>)(payload);
    } catch (e) {
      log.error("handler_crashed", { event: String(type), error: errorMessage(e) });
    }
  }
}

// The sub-event names for a domain prefix P (the part after "<P>:"), derived
// from the merged BusEvents.
type SubKey<P extends string> = {
  [K in keyof BusEvents]: K extends `${P}:${infer S}` ? S : never;
}[keyof BusEvents];

// The payload of "<P>:<S>", indexing the concrete BusEvents by the joined key.
type SubPayload<P extends string, S extends string> = BusEvents[`${P}:${S}` & keyof BusEvents];

export interface ScopedBus<P extends string> {
  emit<S extends SubKey<P> & string>(sub: S, payload: SubPayload<P, S>): void;
  on<S extends SubKey<P> & string>(sub: S, handler: (payload: SubPayload<P, S>) => void): () => void;
}

// A domain-scoped view of the bus: emit/on with just the sub-event; the
// "<domain>:" prefix is applied (and type-checked) for you. A feature module
// makes one (`const sessionBus = scope("session")`) and talks in its own terms
// — sessionBus.emit("turn:start", …) — instead of repeating the prefix.
export function scope<P extends string>(prefix: P): ScopedBus<P> {
  return {
    emit: (sub: string, payload: unknown) => emit(`${prefix}:${sub}` as BusEventType, payload as never),
    on: (sub: string, handler: unknown) => on(`${prefix}:${sub}` as BusEventType, handler as never),
  } as ScopedBus<P>;
}
