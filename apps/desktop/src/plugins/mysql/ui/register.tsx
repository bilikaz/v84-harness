// MySQL plugin UI contributions — registered at boot like any feature, each tagged with the plugin slug
// so they vanish when the plugin is disabled. The settings block is its own settings-menu section
// (region "settings", gated by SettingsModal); the connections card lives in the right rail.

import { Database } from "lucide-react";

import { register } from "../../../lib/registry.ts";
import { MYSQL_SLUG } from "../types.ts";
import { MysqlSettingsBlock } from "./Settings.tsx";
import { MysqlConnectionsPanel } from "./RightPanel.tsx";

register(
  {
    region: "settings",
    pluginId: MYSQL_SLUG,
    id: MYSQL_SLUG,
    title: "MySQL",
    icon: Database,
    route: `settings/${MYSQL_SLUG}`,
    order: 100, // plugin sections sort after the core ones
    render: () => <MysqlSettingsBlock />,
  },
  { region: "right-panel", pluginId: MYSQL_SLUG, id: "mysql-connections", order: 10, render: () => <MysqlConnectionsPanel /> },
);
