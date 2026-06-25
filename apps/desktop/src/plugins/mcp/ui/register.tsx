// MCP plugin UI contributions — a settings-menu section (the server list + per-tool defaults) and a
// right-rail connect/disconnect card. Both tagged with the plugin slug, so they vanish when disabled.

import { Plug } from "lucide-react";

import { register } from "../../../lib/registry.ts";
import { MCP_SLUG } from "../types.ts";
import { McpSettingsBlock } from "./Settings.tsx";
import { McpServersPanel } from "./RightPanel.tsx";

register(
  {
    region: "settings",
    pluginId: MCP_SLUG,
    id: MCP_SLUG,
    title: "MCP",
    icon: Plug,
    route: `settings/${MCP_SLUG}`,
    order: 110, // plugin sections sort after the core ones
    render: () => <McpSettingsBlock />,
  },
  { region: "right-panel", pluginId: MCP_SLUG, id: "mcp-servers", order: 20, render: () => <McpServersPanel /> },
);
