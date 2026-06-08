import { useSyncExternalStore } from "react";

// Layout / UI state (not domain data). External store so the shell (App) and
// widgets (the composer's panel toggle) share it without prop threading.
// Persisted so the panel stays where you left it.
const KEY = "v84-harness:ui";

interface UiState {
  rightPanel: boolean;
}

function load(): UiState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { rightPanel: true, ...(JSON.parse(raw) as Partial<UiState>) };
  } catch {
    /* ignore */
  }
  return { rightPanel: true };
}

let state: UiState = load();
const listeners = new Set<() => void>();

function set(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function toggleRightPanel(): void {
  set({ rightPanel: !state.rightPanel });
}

export function useRightPanel(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.rightPanel,
    () => state.rightPanel,
  );
}
