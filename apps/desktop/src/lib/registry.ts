import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// UI contribution registry.

export type Region = "left-top" | "right-panel" | "settings" | "main";

export interface Contribution {
  region: Region;
  id: string;
  // Set on plugin-contributed surfaces — the owning plugin's slug. A contribution whose plugin is
  // disabled is dropped: <Slot> for the side regions, SettingsModal for the settings menu. An enabled
  // plugin's settings contribution shows as its own settings-menu section. Core contributions leave this unset.
  pluginId?: string;
  title?: string;
  icon?: LucideIcon;
  route?: string;
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
