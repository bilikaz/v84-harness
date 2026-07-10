// Comics plugin — mascot + comic generation graphs over the core gallery composer (implementation.md).
// This slice ships the manifest + a temporary dialog-demo graph exercising the core `dialog` node action;
// the mascot/comic graphs replace the demo as they land.

import type { PluginManifest } from "../../core/plugins/types.ts";

export const COMICS_SLUG = "comics";

// SHORT job-folder ids — models read (and sometimes retype) these paths, and 26-char ULIDs under
// speculative decoding were a typo farm. A folder name is a 6-char window of the sid's tail
// (already random): window 0 = last 6 chars; on a collision with a FOREIGN session's folder the
// window slides one char toward the front. `.owner-<full sid>` inside the folder marks whose it is.
export const sidWindow = (sid: string, offset: number): string => sid.slice(-(offset + 6), offset ? -offset : undefined).toLowerCase();
export const ownerMarker = (sid: string): string => `.owner-${sid}`;
export const MAX_SID_WINDOWS = 20;

export interface ComicsSettings {
  avatarsDir: string; // workspace-relative folder mascots (and their bibles) land in
  comicsDir: string; // workspace-relative folder finished comics land in
  maxAvatarAttempts: number; // MascotGenerate budget per mascot job — at the cap the agent must choose the best
  maxPanelAttempts: number; // PanelGenerate budget per panel job
}

export const COMICS_DEFAULTS: ComicsSettings = {
  avatarsDir: "avatars",
  comicsDir: "comics",
  maxAvatarAttempts: 10,
  maxPanelAttempts: 10,
};

export const manifest: PluginManifest<ComicsSettings> = {
  slug: COMICS_SLUG,
  name: "Comics",
  version: "0.1.0",
  defaultEnabled: false,
  settingsDefaults: COMICS_DEFAULTS,
  validateSettings(raw: unknown): ComicsSettings {
    const r = (raw ?? {}) as Partial<ComicsSettings>;
    const dir = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);
    const cap = (v: unknown, fallback: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 1 && n <= 30 ? Math.floor(n) : fallback;
    };
    return {
      avatarsDir: dir(r.avatarsDir, COMICS_DEFAULTS.avatarsDir),
      comicsDir: dir(r.comicsDir, COMICS_DEFAULTS.comicsDir),
      maxAvatarAttempts: cap(r.maxAvatarAttempts, COMICS_DEFAULTS.maxAvatarAttempts),
      maxPanelAttempts: cap(r.maxPanelAttempts, COMICS_DEFAULTS.maxPanelAttempts),
    };
  },
};
