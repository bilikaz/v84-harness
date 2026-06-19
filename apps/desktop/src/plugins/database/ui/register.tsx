// Database plugin UI contributions — registered at boot like any feature, each tagged with the plugin slug
// so they vanish when the plugin is disabled. The settings block is its own settings-menu section
// (region "settings", gated by SettingsModal); the connections card lives in the right rail.

import { Database } from "lucide-react";

import { register } from "../../../lib/registry.ts";
import { DATABASE_SLUG } from "../types.ts";
import { DatabaseSettingsBlock } from "./Settings.tsx";
import { DatabaseConnectionsPanel } from "./RightPanel.tsx";

register(
  {
    region: "settings",
    pluginId: DATABASE_SLUG,
    id: DATABASE_SLUG,
    title: "Database",
    icon: Database,
    route: `settings/${DATABASE_SLUG}`,
    order: 100, // plugin sections sort after the core ones
    render: () => <DatabaseSettingsBlock />,
  },
  { region: "right-panel", pluginId: DATABASE_SLUG, id: "database-connections", order: 10, render: () => <DatabaseConnectionsPanel /> },
);
