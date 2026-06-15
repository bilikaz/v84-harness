import { useSyncExternalStore } from "react";

import { Consumer, createListeners } from "./storage/consumer.ts";
import type { Ctx } from "./ctx.ts";

// UI state. The persisted panel preference is a consumer (follows the connection
// like everything else); the lightbox is transient runtime state.
const KEY = "v84-harness:ui";

class UiPanel extends Consumer<{ rightPanel: boolean }> {
  constructor(ctx: Ctx) {
    super(ctx, KEY, { rightPanel: true });
  }
  toggle(): void {
    this.commit({ rightPanel: !this.state.rightPanel });
  }
  useRight = (): boolean => this.useSelect((s) => s.rightPanel);
}

let panel: UiPanel;
export function initUi(ctx: Ctx): UiPanel {
  panel = new UiPanel(ctx);
  return panel;
}

export const toggleRightPanel = (): void => panel.toggle();
export const useRightPanel = (): boolean => panel.useRight();

// Lightbox — transient (the currently-zoomed image url), never persisted.
let lightboxUrl: string | null = null;
const lb = createListeners();

export function openLightbox(url: string): void {
  lightboxUrl = url;
  lb.notify();
}
export function closeLightbox(): void {
  if (lightboxUrl !== null) {
    lightboxUrl = null;
    lb.notify();
  }
}
export function useLightbox(): string | null {
  return useSyncExternalStore(lb.subscribe, () => lightboxUrl, () => lightboxUrl);
}
