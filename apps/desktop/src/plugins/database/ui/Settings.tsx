import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { useCtx } from "../../../renderer/ctx.tsx";
import { useDetection } from "../../../lib/hooks.ts";
import { usePluginsConfig, setPluginSettings } from "../../../core/plugins/config.ts";
import { Row, DetectButton, Switch, fieldInputFull } from "../../../pages/settings/Field.tsx";
import { DATABASE_SLUG, ENGINE_DEFAULT_PORT, type DbConnection, type DbEngine, type DbSettings } from "../types.ts";

const FIELD = "w-80";

// One connection as a collapsible card (Media-models style): a header summarising the target, expanding
// to the editable fields + a Test probe (runs DatabaseTestConnection over ctx.tools) + remove. The engine
// select picks the driver + dialect; switching it resets the port to that engine's default.
function ConnectionCard({ conn, open, onToggle, onPatch, onRemove }: {
  conn: DbConnection;
  open: boolean;
  onToggle: () => void;
  onPatch: (p: Partial<DbConnection>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const ctx = useCtx();
  const { detecting, msg, detect } = useDetection(
    async () => {
      const r = await ctx.tools.run({ id: "database-test", name: "DatabaseTestConnection", arguments: JSON.stringify({ connection: conn.name }), cwd: "" });
      return r?.ok ? { ok: true, count: 1 } : { ok: false, count: 0, error: r?.output ?? t("plugins.database.testUnavailable") };
    },
    (r) => (r.ok ? t("plugins.database.connected") : (r.error ?? "")),
  );

  const summary = `${conn.engine} · ${conn.user || "?"}@${conn.host}:${conn.port}${conn.database ? ` · ${conn.database}` : ""}`;

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
          <Row label={t("plugins.database.name")}>
            <div className={FIELD}>
              <input value={conn.name} onChange={(e) => onPatch({ name: e.target.value })} className={fieldInputFull} />
            </div>
          </Row>
          <Row label={t("plugins.database.engine")}>
            <div className={FIELD}>
              <select
                value={conn.engine}
                onChange={(e) => {
                  const engine = e.target.value as DbEngine;
                  onPatch({ engine, port: ENGINE_DEFAULT_PORT[engine] });
                }}
                className={fieldInputFull}
              >
                <option value="mysql">{t("plugins.database.mysql")}</option>
                <option value="postgres">{t("plugins.database.postgres")}</option>
              </select>
            </div>
          </Row>
          <Row label={t("plugins.database.host")}>
            <div className={FIELD}>
              <input value={conn.host} onChange={(e) => onPatch({ host: e.target.value })} placeholder="localhost" className={fieldInputFull} />
            </div>
          </Row>
          <Row label={t("plugins.database.port")}>
            <div className={FIELD}>
              <input type="number" value={conn.port} onChange={(e) => onPatch({ port: Number(e.target.value) })} placeholder={String(ENGINE_DEFAULT_PORT[conn.engine])} className={fieldInputFull} />
            </div>
          </Row>
          <Row label={t("plugins.database.user")}>
            <div className={FIELD}>
              <input value={conn.user} onChange={(e) => onPatch({ user: e.target.value })} className={fieldInputFull} />
            </div>
          </Row>
          <Row label={t("plugins.database.password")}>
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
          <Row label={t("plugins.database.database")}>
            <div className={FIELD}>
              <input value={conn.database ?? ""} onChange={(e) => onPatch({ database: e.target.value })} className={fieldInputFull} />
            </div>
          </Row>
          <Row label={t("plugins.database.ssl")}>
            <div className={`${FIELD} flex items-center gap-2 text-sm text-neutral-600`}>
              <Switch on={conn.ssl ?? false} onToggle={() => onPatch({ ssl: !(conn.ssl ?? false) })} />
              {t("plugins.database.sslHint")}
            </div>
          </Row>

          <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
            <div className="flex items-center gap-2">
              <DetectButton label={t("plugins.database.test")} busy={detecting} onClick={detect} />
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

export function DatabaseSettingsBlock() {
  const { t } = useTranslation();
  const cfg = usePluginsConfig();
  const conns = (cfg[DATABASE_SLUG]?.settings as DbSettings | undefined)?.connections ?? [];
  const [open, setOpen] = useState<number | null>(null);

  const save = (next: DbConnection[]): void => setPluginSettings(DATABASE_SLUG, { connections: next } satisfies DbSettings);

  function add(): void {
    save([...conns, { name: `connection${conns.length + 1}`, engine: "mysql", host: "localhost", port: ENGINE_DEFAULT_PORT.mysql, user: "root" }]);
    setOpen(conns.length);
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("plugins.database.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("plugins.database.connectionsHint")}</p>

      <div className="mt-4 flex items-center justify-end">
        <button onClick={add} className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50">
          <Plus className="h-4 w-4" /> {t("plugins.database.addConnection")}
        </button>
      </div>

      {conns.length === 0 && <p className="mt-2 text-sm text-neutral-400">{t("plugins.database.empty")}</p>}

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
