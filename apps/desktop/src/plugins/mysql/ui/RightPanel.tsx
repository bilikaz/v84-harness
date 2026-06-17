import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Database } from "lucide-react";

import { useCtx } from "../../../renderer/ctx.tsx";
import { cn } from "../../../lib/cn.ts";
import { usePluginsConfig } from "../../../core/plugins/config.ts";
import { invokePluginService } from "../../../core/plugins/service.ts";
import { MYSQL_SLUG, type MysqlConnection, type MysqlSettings } from "../types.ts";

const btn = "shrink-0 rounded-md border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50";

// Right-rail card (shown when the MySQL plugin is enabled): the configured connections with live
// connect / disconnect. A connection with no saved password prompts for one inline — used to open the
// session pool (never persisted). Connection management is the plugin's SERVICE (not agent tools): all
// calls go over ctx.api.invokePlugin. Live status is read via the service's status method, refreshed after
// each action.
export function MysqlConnectionsPanel() {
  const { t } = useTranslation();
  const ctx = useCtx();
  const cfg = usePluginsConfig();
  const conns = (cfg[MYSQL_SLUG]?.settings as MysqlSettings | undefined)?.connections ?? [];

  const [live, setLive] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompting, setPrompting] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const r = await invokePluginService<string[]>(ctx, MYSQL_SLUG, "status");
    if (r.ok) setLive(r.value);
  }, [ctx]);

  // Initial state, then react to pushed connection events — so a pool opened by an agent query's
  // auto-connect (not just a panel action) updates the dots live.
  useEffect(() => {
    void refresh();
    return ctx.api.onPluginEvent?.((slug, type, payload) => {
      if (slug === MYSQL_SLUG && type === "connections") setLive(payload as string[]);
    });
  }, [ctx, refresh]);

  if (conns.length === 0) return null;

  async function connect(c: MysqlConnection, pw?: string): Promise<void> {
    setBusy(c.name);
    setError("");
    const r = await invokePluginService(ctx, MYSQL_SLUG, "connect", c, pw);
    setBusy(null);
    if (r.ok) {
      setPrompting(null);
      setPassword("");
      await refresh();
    } else {
      setError(r.error);
    }
  }
  async function disconnect(name: string): Promise<void> {
    setBusy(name);
    await invokePluginService(ctx, MYSQL_SLUG, "disconnect", name);
    setBusy(null);
    await refresh();
  }
  function onConnect(c: MysqlConnection): void {
    setError("");
    if (c.password) void connect(c);
    else {
      setPassword("");
      setPrompting(c.name);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
        <Database size={14} /> {t("plugins.mysql.title")}
      </h3>
      {conns.map((c) => {
        const connected = live.includes(c.name);
        return (
          <div key={c.name} className="border-t border-neutral-100 py-2 first:border-t-0">
            <div className="flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", connected ? "bg-green-500" : "bg-neutral-300")} />
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">{c.name}</span>
              {connected ? (
                <button type="button" className={btn} disabled={busy === c.name} onClick={() => void disconnect(c.name)}>
                  {t("plugins.mysql.disconnect")}
                </button>
              ) : (
                <button type="button" className={btn} disabled={busy === c.name} onClick={() => onConnect(c)}>
                  {t("plugins.mysql.connect")}
                </button>
              )}
            </div>
            {prompting === c.name && (
              <div className="mt-2 flex items-center gap-1">
                <input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void connect(c, password);
                  }}
                  placeholder={t("plugins.mysql.password")}
                  className="min-w-0 flex-1 rounded-md border border-neutral-200 px-2 py-1 text-sm outline-none placeholder:text-neutral-400"
                />
                <button type="button" className={btn} disabled={busy === c.name} onClick={() => void connect(c, password)}>
                  {t("plugins.mysql.connect")}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
