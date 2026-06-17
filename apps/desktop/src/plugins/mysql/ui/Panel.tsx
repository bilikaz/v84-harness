import { useTranslation } from "react-i18next";
import { Database } from "lucide-react";

import { cn } from "../../../lib/cn.ts";
import { usePluginsConfig } from "../../../core/plugins/config.ts";
import { MYSQL_SLUG, type MysqlSettings } from "../types.ts";

// Left-rail block (below the container list): the configured connections at a glance. A green dot means
// a password is saved (ready); grey means it needs a manual connect. Hidden until a connection exists.
export function MysqlPanel() {
  const { t } = useTranslation();
  const cfg = usePluginsConfig();
  const conns = (cfg[MYSQL_SLUG]?.settings as MysqlSettings | undefined)?.connections ?? [];
  if (conns.length === 0) return null;

  return (
    <div className="px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400">
        <Database size={12} /> {t("plugins.mysql.title")}
      </div>
      <ul className="space-y-0.5">
        {conns.map((c) => (
          <li key={c.name} className="flex items-center gap-2 text-sm text-neutral-700">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.password ? "bg-green-500" : "bg-neutral-300")} />
            <span className="truncate">{c.name}</span>
            <span className="ml-auto truncate text-xs text-neutral-400">{c.database ?? c.host}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
