import { useSyncExternalStore } from "react";

// Shared store kernel (listeners + localStorage persistence + React binding) — persistence backend swaps happen here only.

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

export interface Store<T> {
  get(): T;
  /** Replace the state wholesale; persist + notify. */
  set(next: T): void;
  /** Shallow-merge a patch into object state; persist + notify. */
  patch(p: Partial<T>): void;
  subscribe(l: () => void): () => void;
  notify(): void;
  use(): T;
  /** React binding to a slice — the selector must return a stable reference. */
  useSelect<S>(sel: (t: T) => S): S;
}

// `key` null = transient; `load` overrides the initial read (null → defaults); without it, persisted state shallow-merges over defaults.
export function createStore<T extends object>(key: string | null, defaults: T, load?: () => T | null): Store<T> {
  const { subscribe, notify } = createListeners();

  function read(): T {
    if (load) return load() ?? defaults;
    if (key) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
      } catch {
        /* ignore */
      }
    }
    return defaults;
  }

  let state = read();

  function persist(): void {
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }

  function get(): T {
    return state;
  }
  function set(next: T): void {
    state = next;
    persist();
    notify();
  }

  return {
    get,
    set,
    patch: (p) => set({ ...state, ...p }),
    subscribe,
    notify,
    use: () => useSyncExternalStore(subscribe, get, get),
    useSelect: (sel) => useSyncExternalStore(subscribe, () => sel(state), () => sel(state)),
  };
}
