import { Fragment } from "react";

import { contributionsFor, type Region } from "../lib/registry.ts";
import { usePluginsConfig } from "../core/plugins/config.ts";

// Renders every contribution registered for a region, in order. A plugin-owned contribution (pluginId
// set) renders only while its plugin is enabled — disabling a plugin removes its side blocks live.
export function Slot({ region }: { region: Region }) {
  const plugins = usePluginsConfig();
  return (
    <>
      {contributionsFor(region)
        .filter((c) => !c.pluginId || plugins[c.pluginId]?.enabled)
        .map((c) => (
          <Fragment key={c.id}>{c.render()}</Fragment>
        ))}
    </>
  );
}
