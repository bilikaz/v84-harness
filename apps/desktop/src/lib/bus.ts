// Generic typed event bus for app-domain events — features declare theirs by augmenting BusEvents ("<domain>:<event>" keys).

import { errorMessage } from "./errors.ts";
import { rootLog } from "./logger/index.ts";

const log = rootLog.child("bus");

// Augmented per-domain (declaration merging). Empty here on purpose.
export interface BusEvents {}

export type BusEventType = keyof BusEvents;
type Handler<K extends BusEventType> = (payload: BusEvents[K]) => void;
type AnyHandler = (payload: unknown) => void;

const registry = new Map<BusEventType, Set<AnyHandler>>();

export function on<K extends BusEventType>(type: K, handler: Handler<K>): () => void {
  let set = registry.get(type);
  if (!set) registry.set(type, (set = new Set()));
  set.add(handler as AnyHandler);
  return () => set!.delete(handler as AnyHandler);
}

// Handlers are isolated: one throwing must not silence the handlers behind it.
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

type SubKey<P extends string> = {
  [K in keyof BusEvents]: K extends `${P}:${infer S}` ? S : never;
}[keyof BusEvents];

type SubPayload<P extends string, S extends string> = BusEvents[`${P}:${S}` & keyof BusEvents];

export interface ScopedBus<P extends string> {
  emit<S extends SubKey<P> & string>(sub: S, payload: SubPayload<P, S>): void;
  on<S extends SubKey<P> & string>(sub: S, handler: (payload: SubPayload<P, S>) => void): () => void;
}

export function scope<P extends string>(prefix: P): ScopedBus<P> {
  return {
    emit: (sub: string, payload: unknown) => emit(`${prefix}:${sub}` as BusEventType, payload as never),
    on: (sub: string, handler: unknown) => on(`${prefix}:${sub}` as BusEventType, handler as never),
  } as ScopedBus<P>;
}
