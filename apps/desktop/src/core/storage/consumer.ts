// The reactivity + persistence layer for domain state.
//
//  - createListeners: the bare subscribe/notify primitive. The Consumer base is
//    built on it; transient stores that aren't Consumers (config/llm, approvals,
//    the lightbox) import it directly from here.
//  - Consumer: in-memory reactive state persisted through ctx.storage. Subclasses
//    give a key + their domain methods (and may override parse for
//    normalization/migration). key=null → transient (reactive, not persisted).
//    Every consumer registers so the host can re-hydrate them all when the
//    storage backend changes (login/logout) — no reload.

import { useSyncExternalStore } from "react";

import type { Ctx } from "../ctx.ts";

export function createListeners(): { subscribe: (l: () => void) => () => void; notify: () => void } {
  const listeners = new Set<() => void>();
  return {
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    notify(): void {
      for (const l of listeners) l();
    },
  };
}

const registry = new Set<Consumer<unknown>>();

// Re-read every consumer from the current backend. Called at init and on each
// connection change (ctx.storage.connect/disconnect).
export function hydrateConsumers(): Promise<unknown[]> {
  return Promise.all([...registry].map((c) => c.hydrate()));
}

export abstract class Consumer<T> {
  private readonly listeners = createListeners();
  protected state: T;

  protected constructor(
    protected readonly ctx: Ctx,
    protected readonly key: string | null,
    protected readonly defaults: T,
  ) {
    this.state = defaults;
    registry.add(this as Consumer<unknown>);
  }

  // Raw stored string → state. Override for normalization/migration.
  protected parse(raw: string): T {
    return { ...(this.defaults as object), ...(JSON.parse(raw) as object) } as T;
  }
  protected serialize(): string {
    return JSON.stringify(this.state);
  }

  async hydrate(): Promise<void> {
    if (this.key) {
      try {
        const raw = await this.ctx.storage.get(this.key);
        this.state = raw != null ? this.parse(raw) : this.defaults;
      } catch {
        this.state = this.defaults;
      }
    } else {
      this.state = this.defaults; // transient — reset on (re)hydrate
    }
    this.notify();
  }

  protected persist(): void {
    if (this.key) void this.ctx.storage.set(this.key, this.serialize()).catch(() => undefined);
  }

  // Replace state wholesale: persist + notify. Subclass commands call this.
  protected commit(next: T): void {
    this.state = next;
    this.persist();
    this.notify();
  }

  get(): T {
    return this.state;
  }

  protected notify(): void {
    this.listeners.notify();
  }

  // React bindings. useSelect's selector must return a stable reference.
  use(): T {
    return useSyncExternalStore(this.listeners.subscribe, () => this.state, () => this.state);
  }
  useSelect<S>(sel: (t: T) => S): S {
    return useSyncExternalStore(this.listeners.subscribe, () => sel(this.state), () => sel(this.state));
  }
}
