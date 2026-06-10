import { createStore } from "./store.ts";

// Layout / UI state (not domain data). External stores so the shell (App) and
// widgets (the composer's panel toggle) share them without prop threading.

// Persisted so the panel stays where you left it.
const panel = createStore<{ rightPanel: boolean }>("v84-harness:ui", { rightPanel: true });

export function toggleRightPanel(): void {
  panel.patch({ rightPanel: !panel.get().rightPanel });
}

export function useRightPanel(): boolean {
  return panel.useSelect((s) => s.rightPanel);
}

// Lightbox — the image URL currently shown enlarged, or null. Transient (not
// persisted): clicking an image opens it; Escape / clicking the backdrop closes.
const lightbox = createStore<{ url: string | null }>(null, { url: null });

export function openLightbox(url: string): void {
  lightbox.set({ url });
}
export function closeLightbox(): void {
  if (lightbox.get().url !== null) lightbox.set({ url: null });
}
export function useLightbox(): string | null {
  return lightbox.useSelect((s) => s.url);
}
