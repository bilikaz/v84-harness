import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { useCtx } from "../../../renderer/ctx.tsx";
import { useDetection } from "../../../lib/hooks.ts";
import { usePluginsConfig, setPluginSettings } from "../../../core/plugins/config.ts";
import { Row, DetectButton, fieldInputFull } from "../../../pages/settings/Field.tsx";
import { MYSQL_SLUG, type MysqlConnection, type MysqlSettings } from "../types.ts";

const FIELD = "w-80";

// One connection as a collapsible card (Media-models style): a header summarising the target, expanding
// to the editable fields + a Test probe (runs MysqlTestConnection over ctx.tools) + remove.
function ConnectionCard({ conn, open, onToggle, onPatch, onRemove }: {
  conn: MysqlConnection;
  open: boolean;
  onToggle: () => void;
  onPatch: (p: Partial<MysqlConnection>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const ctx = useCtx();
  const { detecting, msg, detect } = useDetection(
    async () => {
      const r = await ctx.tools.run({ id: "mysql-test", name: "MysqlTestConnection", arguments: JSON.stringify({ connection: conn.name }), cwd: "" });
      return r?.ok ? { ok: true, count: 1 } : { ok: false, count: 0, error: r?.output ?? t("plugins.mysql.testUnavailable") };
    },
    (r) => (r.ok ? t("plugins.mysql.connected") : (r.error ?? "")),
  );

  const summary = `${conn.user || "?"}@${conn.host}:${conn.port}${conn.database ? ` · ${conn.database}` : ""}`;

  return (
    <div className="mt-3 rounded-lg border border-neutral-200">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
          {conn.name || "—"}
        </span>
        <span className="truncate text-xs text-neutral-400">{summary}</span>
      </button>

      {open && (
        <div className="border-t border-neutral-100 px-4 pb-4">
          <Row label={t("plugins.mysql.name")}>
            <div className={FIELD}>
              <input value={conn.name} onChange={(e) => onPatch({ name: e.target.value })} className={fieldInputFull} />
            </div>
          </Row>
          <Row label={t("plugins.mysql.host")}>
            <div className={FIELD}>
              <input value={conn.host} onChange={(e) => onPatch({ host: e.target.value })} placeholder="localhost" className={fieldInputFull} />
            </div>
          </Row>
          <Row label={t("plugins.mysql.port")}>
            <div className={FIELD}>
              <input type="number" value={conn.port} onChange={(e) => onPatch({ port: Number(e.target.value) })} placeholder="3306" className={fieldInputFull} />
            </div>
          </Row>
          <Row label={t("plugins.mysql.user")}>
            <div className={FIELD}>
              <input value={conn.user} onChange={(e) => onPatch({ user: e.target.value })} className={fieldInputFull} />
            </div>
          </Row>
          <Row label={t("plugins.mysql.password")}>
            <div className={FIELD}>
              <input
                type="password"
                autoComplete="off"
                data-1p-ignore="true"
                data-lpignore="true"
                value={conn.password ?? ""}
                onChange={(e) => onPatch({ password: e.target.value })}
                className={fieldInputFull}
              />
            </div>
          </Row>
          <Row label={t("plugins.mysql.database")}>
            <div className={FIELD}>
              <input value={conn.database ?? ""} onChange={(e) => onPatch({ database: e.target.value })} className={fieldInputFull} />
            </div>
          </Row>

          <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
            <div className="flex items-center gap-2">
              <DetectButton label={t("plugins.mysql.test")} busy={detecting} onClick={detect} />
              {msg && <span className="text-xs text-neutral-500">{msg}</span>}
            </div>
            <button onClick={onRemove} className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-red-50 hover:text-red-600">
              <Trash2 className="h-4 w-4" /> {t("common.remove")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MysqlSettingsBlock() {
  const { t } = useTranslation();
  const cfg = usePluginsConfig();
  const conns = (cfg[MYSQL_SLUG]?.settings as MysqlSettings | undefined)?.connections ?? [];
  const [open, setOpen] = useState<number | null>(null);

  const save = (next: MysqlConnection[]): void => setPluginSettings(MYSQL_SLUG, { connections: next } satisfies MysqlSettings);

  function add(): void {
    save([...conns, { name: `connection${conns.length + 1}`, host: "localhost", port: 3306, user: "root" }]);
    setOpen(conns.length);
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("plugins.mysql.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("plugins.mysql.connectionsHint")}</p>

      <div className="mt-4 flex items-center justify-end">
        <button onClick={add} className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50">
          <Plus className="h-4 w-4" /> {t("plugins.mysql.addConnection")}
        </button>
      </div>

      {conns.length === 0 && <p className="mt-2 text-sm text-neutral-400">{t("plugins.mysql.empty")}</p>}

      {conns.map((c, i) => (
        <ConnectionCard
          key={i}
          conn={c}
          open={open === i}
          onToggle={() => setOpen(open === i ? null : i)}
          onPatch={(p) => save(conns.map((x, idx) => (idx === i ? { ...x, ...p } : x)))}
          onRemove={() => {
            save(conns.filter((_, idx) => idx !== i));
            setOpen(null);
          }}
        />
      ))}
    </div>
  );
}
