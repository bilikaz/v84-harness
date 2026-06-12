import { createStore } from "./store.ts";

// Layout/UI state stores (not domain data), shared between the shell and widgets.

const panel = createStore<{ rightPanel: boolean }>("v84-harness:ui", { rightPanel: true });

export function toggleRightPanel(): void {
  panel.patch({ rightPanel: !panel.get().rightPanel });
}

export function useRightPanel(): boolean {
  return panel.useSelect((s) => s.rightPanel);
}

// Lightbox — the image URL currently shown enlarged, or null; transient.
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
