import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// UI contribution registry — the frontend mirror of the backend's register.ts
// pattern. Each pages/<feature>/register.ts calls `register(...)` to contribute
// to one or more REGIONS the shell exposes. main.tsx runs an import.meta.glob
// over those files at boot, so the filesystem IS the registry.

export type Region = "left-top" | "right-panel" | "settings" | "main";

export interface Contribution {
  region: Region;
  id: string;
  title?: string; // shown for nav-style regions (menu, settings)
  icon?: LucideIcon;
  route?: string; // hash route that activates this (e.g. "settings/provider")
  order?: number;
  render: () => ReactNode;
}

const contributions: Contribution[] = [];

export function register(...entries: Contribution[]): void {
  contributions.push(...entries);
}

export function contributionsFor(region: Region): Contribution[] {
  return contributions
    .filter((c) => c.region === region)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
