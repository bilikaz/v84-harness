import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { useCtx } from "../../../renderer/ctx.tsx";
import { usePluginsConfig, setPluginSettings } from "../../../core/plugins/config.ts";
import { invokePluginService } from "../../../core/plugins/service.ts";
import { Row, DetectButton, fieldInputFull } from "../../../pages/settings/Field.tsx";
import { ToolModePicker } from "../../../components/ToolModePicker.tsx";
import { MCP_SLUG, OAUTH_REDIRECT_URI, type McpServer, type McpSettings, type McpTransport, type HttpAuth, type OAuthConfig } from "../types.ts";

const FIELD = "w-80";

// KEY=value lines ⇄ a string record — a light editor for env / headers without per-row UI.
function parseRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    if (k) out[k] = line.slice(i + 1).trim();
  }
  return out;
}
function formatRecord(rec?: Record<string, string>): string {
  return Object.entries(rec ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function ServerCard({ server, open, onToggle, onPatch, onRemove }: {
  server: McpServer;
  open: boolean;
  onToggle: () => void;
  onPatch: (next: McpServer) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const ctx = useCtx();
  const [connected, setConnected] = useState(false);
  const [tools, setTools] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const s = await invokePluginService<string[]>(ctx, MCP_SLUG, "status");
    const on = s.ok && s.value.includes(server.name);
    setConnected(on);
    if (on) {
      const r = await invokePluginService<string[]>(ctx, MCP_SLUG, "tools", server.name);
      if (r.ok) setTools(r.value);
    } else {
      setTools([]);
    }
  }, [ctx, server.name]);

  useEffect(() => {
    void refresh();
    return ctx.api.onPluginEvent?.((slug, type) => {
      if (slug === MCP_SLUG && type === "connections") void refresh();
    });
  }, [ctx, refresh]);

  async function connect(): Promise<void> {
    setBusy(true);
    setMsg("");
    setError("");
    const r = await invokePluginService(ctx, MCP_SLUG, "connect", server);
    setBusy(false);
    if (r.ok) {
      setMsg(t("plugins.mcp.connected"));
      await refresh();
    } else {
      setError(r.error);
    }
  }

  const summary = server.transport === "stdio" ? `stdio · ${server.command || "?"}` : `http · ${server.url || "?"}`;

  function setTransport(transport: McpTransport): void {
    if (transport === server.transport) return;
    onPatch(
      transport === "stdio"
        ? { name: server.name, enabled: server.enabled, transport: "stdio", command: "", toolDefaults: server.toolDefaults }
        : { name: server.name, enabled: server.enabled, transport: "http", url: "", toolDefaults: server.toolDefaults },
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-neutral-200">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? "bg-green-500" : "bg-neutral-300"}`} />
          {server.name || "—"}
        </span>
        <span className="truncate text-xs text-neutral-400">{summary}</span>
      </button>

      {open && (
        <div className="border-t border-neutral-100 px-4 pb-4">
          <Row label={t("plugins.mcp.name")}>
            <div className={FIELD}>
              <input value={server.name} onChange={(e) => onPatch({ ...server, name: e.target.value })} className={fieldInputFull} />
            </div>
          </Row>
          <Row label={t("plugins.mcp.transport")}>
            <div className={FIELD}>
              <select value={server.transport} onChange={(e) => setTransport(e.target.value as McpTransport)} className={fieldInputFull}>
                <option value="stdio">{t("plugins.mcp.stdio")}</option>
                <option value="http">{t("plugins.mcp.http")}</option>
              </select>
            </div>
          </Row>

          {server.transport === "stdio" ? (
            <>
              <Row label={t("plugins.mcp.command")}>
                <div className={FIELD}>
                  <input value={server.command} onChange={(e) => onPatch({ ...server, command: e.target.value })} placeholder="npx" className={fieldInputFull} />
                </div>
              </Row>
              <Row label={t("plugins.mcp.args")}>
                <div className={FIELD}>
                  <input
                    value={(server.args ?? []).join(" ")}
                    onChange={(e) => onPatch({ ...server, args: e.target.value.split(/\s+/).filter(Boolean) })}
                    placeholder="-y @modelcontextprotocol/server-filesystem /path"
                    className={fieldInputFull}
                  />
                </div>
              </Row>
              <Row label={t("plugins.mcp.env")}>
                <div className={FIELD}>
                  <textarea
                    rows={3}
                    value={formatRecord(server.env)}
                    onChange={(e) => onPatch({ ...server, env: parseRecord(e.target.value) })}
                    placeholder={"KEY=value"}
                    className={`${fieldInputFull} font-mono text-xs`}
                  />
                </div>
              </Row>
            </>
          ) : (
            <>
              <Row label={t("plugins.mcp.url")}>
                <div className={FIELD}>
                  <input value={server.url} onChange={(e) => onPatch({ ...server, url: e.target.value })} placeholder="https://example.com/mcp" className={fieldInputFull} />
                </div>
              </Row>
              {/* Auth is a choice: manual headers, OAuth (auto / DCR), or OAuth with a pre-registered app. */}
              <Row label={t("plugins.mcp.auth")}>
                <div className={FIELD}>
                  <select value={server.auth ?? "headers"} onChange={(e) => onPatch({ ...server, auth: e.target.value as HttpAuth })} className={fieldInputFull}>
                    <option value="headers">{t("plugins.mcp.authHeaders")}</option>
                    <option value="oauth">{t("plugins.mcp.authOauth")}</option>
                    <option value="oauthApp">{t("plugins.mcp.authOauthApp")}</option>
                  </select>
                </div>
              </Row>

              {(server.auth ?? "headers") === "headers" && (
                <Row label={t("plugins.mcp.headers")}>
                  <div className={FIELD}>
                    <textarea
                      rows={3}
                      value={formatRecord(server.headers)}
                      onChange={(e) => onPatch({ ...server, headers: parseRecord(e.target.value) })}
                      placeholder={"Authorization=Bearer …"}
                      className={`${fieldInputFull} font-mono text-xs`}
                    />
                  </div>
                </Row>
              )}

              {server.auth === "oauth" && <p className="py-2 text-xs text-neutral-500">{t("plugins.mcp.oauthHint")}</p>}

              {server.auth === "oauthApp" && (
                <>
                  <p className="py-2 text-xs text-neutral-500">{t("plugins.mcp.oauthAppHint", { uri: OAUTH_REDIRECT_URI })}</p>
                  <Row label={t("plugins.mcp.clientId")}>
                    <div className={FIELD}>
                      <input
                        value={server.oauth?.clientId ?? ""}
                        onChange={(e) => onPatch({ ...server, oauth: { ...server.oauth, clientId: e.target.value } satisfies OAuthConfig })}
                        placeholder="my-client-id"
                        className={fieldInputFull}
                      />
                    </div>
                  </Row>
                  <Row label={t("plugins.mcp.clientSecret")}>
                    <div className={FIELD}>
                      <input
                        type="password"
                        value={server.oauth?.clientSecret ?? ""}
                        onChange={(e) => onPatch({ ...server, oauth: { ...server.oauth, clientSecret: e.target.value } satisfies OAuthConfig })}
                        placeholder="s3cret"
                        className={fieldInputFull}
                      />
                    </div>
                  </Row>
                </>
              )}

              {(server.auth ?? "headers") !== "headers" && (
                <Row label={t("plugins.mcp.scopes")}>
                  <div className={FIELD}>
                    <input
                      value={server.oauth?.scopes ?? ""}
                      onChange={(e) => onPatch({ ...server, oauth: { ...server.oauth, scopes: e.target.value } satisfies OAuthConfig })}
                      placeholder="projects:read database:read"
                      className={fieldInputFull}
                    />
                  </div>
                </Row>
              )}
            </>
          )}

          {connected && tools.length > 0 && (
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <p className="mb-1 text-xs font-medium text-neutral-500">{t("plugins.mcp.tools")}</p>
              {tools.map((tool) => (
                <div key={tool} className="flex items-center justify-between gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-700">{tool}</span>
                  <ToolModePicker
                    value={server.toolDefaults?.[tool] ?? 1}
                    onChange={(m) => onPatch({ ...server, toolDefaults: { ...server.toolDefaults, [tool]: m } })}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
            <div className="flex items-center gap-2">
              <DetectButton label={connected ? t("plugins.mcp.refresh") : t("plugins.mcp.connect")} busy={busy} onClick={() => void connect()} />
              {msg && <span className="text-xs text-neutral-500">{msg}</span>}
              {error && <span className="text-xs text-red-600">{error}</span>}
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

export function McpSettingsBlock() {
  const { t } = useTranslation();
  const cfg = usePluginsConfig();
  const servers = (cfg[MCP_SLUG]?.settings as McpSettings | undefined)?.servers ?? [];
  const [open, setOpen] = useState<number | null>(null);

  const save = (next: McpServer[]): void => setPluginSettings(MCP_SLUG, { servers: next } satisfies McpSettings);

  function add(): void {
    save([...servers, { name: `server${servers.length + 1}`, enabled: true, transport: "stdio", command: "" }]);
    setOpen(servers.length);
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("plugins.mcp.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("plugins.mcp.serversHint")}</p>

      <div className="mt-4 flex items-center justify-end">
        <button onClick={add} className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50">
          <Plus className="h-4 w-4" /> {t("plugins.mcp.addServer")}
        </button>
      </div>

      {servers.length === 0 && <p className="mt-2 text-sm text-neutral-400">{t("plugins.mcp.empty")}</p>}

      {servers.map((s, i) => (
        <ServerCard
          key={i}
          server={s}
          open={open === i}
          onToggle={() => setOpen(open === i ? null : i)}
          onPatch={(next) => save(servers.map((x, idx) => (idx === i ? next : x)))}
          onRemove={() => {
            save(servers.filter((_, idx) => idx !== i));
            setOpen(null);
          }}
        />
      ))}
    </div>
  );
}
