import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plug } from "lucide-react";

import { useCtx } from "../../../renderer/ctx.tsx";
import { cn } from "../../../lib/cn.ts";
import { usePluginsConfig } from "../../../core/plugins/config.ts";
import { invokePluginService } from "../../../core/plugins/service.ts";
import { MCP_SLUG, type McpServer, type McpSettings } from "../types.ts";

const btn = "shrink-0 rounded-md border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50";

// Right-rail card (shown when the MCP plugin is enabled): the configured servers with live connect /
// disconnect. Connecting a server registers its tools; disconnecting drops them. Live status is read via
// the service's status method and refreshed on its pushed connection events.
export function McpServersPanel() {
  const { t } = useTranslation();
  const ctx = useCtx();
  const cfg = usePluginsConfig();
  const servers = (cfg[MCP_SLUG]?.settings as McpSettings | undefined)?.servers ?? [];

  const [live, setLive] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const r = await invokePluginService<string[]>(ctx, MCP_SLUG, "status");
    if (r.ok) setLive(r.value);
  }, [ctx]);

  useEffect(() => {
    void refresh();
    return ctx.api.onPluginEvent?.((slug, type, payload) => {
      if (slug === MCP_SLUG && type === "connections") setLive(payload as string[]);
    });
  }, [ctx, refresh]);

  if (servers.length === 0) return null;

  async function connect(s: McpServer): Promise<void> {
    setBusy(s.name);
    setError("");
    const r = await invokePluginService(ctx, MCP_SLUG, "connect", s);
    setBusy(null);
    if (r.ok) await refresh();
    else setError(r.error);
  }
  async function disconnect(name: string): Promise<void> {
    setBusy(name);
    await invokePluginService(ctx, MCP_SLUG, "disconnect", name);
    setBusy(null);
    await refresh();
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
        <Plug size={14} /> {t("plugins.mcp.title")}
      </h3>
      {servers.map((s) => {
        const connected = live.includes(s.name);
        return (
          <div key={s.name} className="flex items-center gap-2 border-t border-neutral-100 py-2 first:border-t-0">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", connected ? "bg-green-500" : "bg-neutral-300")} />
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">{s.name}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">{s.transport}</span>
            {connected ? (
              <button type="button" className={btn} disabled={busy === s.name} onClick={() => void disconnect(s.name)}>
                {t("plugins.mcp.disconnect")}
              </button>
            ) : (
              <button type="button" className={btn} disabled={busy === s.name} onClick={() => void connect(s)}>
                {t("plugins.mcp.connect")}
              </button>
            )}
          </div>
        );
      })}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
