import { useTranslation } from "react-i18next";

import { pluginManifests } from "../../core/plugins/registry.ts";
import { usePluginsConfig, setPluginEnabled } from "../../core/plugins/config.ts";
import { cn } from "../../lib/cn.ts";

// The master list of in-tree plugins: an enable toggle per plugin. An enabled plugin's own settings get
// their own item in the settings menu (registered into the "settings" region, gated by SettingsModal).
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", on ? "bg-neutral-900" : "bg-neutral-300")}
    >
      <span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform", on ? "translate-x-4" : "translate-x-0")} />
    </button>
  );
}

export function PluginsSection() {
  const { t } = useTranslation();
  const plugins = usePluginsConfig();
  const manifests = pluginManifests();

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("plugins.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("plugins.subtitle")}</p>

      {manifests.length === 0 && <p className="mt-4 text-sm text-neutral-400">{t("plugins.none")}</p>}

      {manifests.map((m) => {
        const enabled = plugins[m.slug]?.enabled ?? false;
        return (
          <div key={m.slug} className="flex items-center justify-between border-b border-neutral-100 py-4">
            <div>
              <div className="text-sm font-medium text-neutral-800">{m.name}</div>
              <div className="text-xs text-neutral-400">v{m.version}</div>
            </div>
            <Toggle on={enabled} onClick={() => setPluginEnabled(m.slug, !enabled)} />
          </div>
        );
      })}
    </div>
  );
}
