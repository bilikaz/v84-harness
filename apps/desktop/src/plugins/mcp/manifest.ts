// MCP plugin manifest — declares the slug, metadata, and the config.plugins.mcp.settings shape (validated
// here, since persisted settings are untrusted). The boot scan (core/plugins/boot.ts) globs this and
// registers it; config derives config.plugins.mcp from it.

import type { PluginManifest } from "../../core/plugins/types.ts";
import { MCP_SLUG, type McpServer, type McpSettings, type ToolMode, type OAuthConfig, type HttpAuth } from "./types.ts";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === "string") out[k] = val;
  return Object.keys(out).length ? out : undefined;
}

function toolDefaults(v: unknown): Record<string, ToolMode> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, ToolMode> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val === 0 || val === 1 || val === 2) out[k] = val;
  return Object.keys(out).length ? out : undefined;
}

function validateOAuth(raw: unknown): OAuthConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const out: OAuthConfig = {};
  const clientId = str(o.clientId).trim();
  if (clientId) out.clientId = clientId;
  const secret = str(o.clientSecret).trim();
  if (secret) out.clientSecret = secret;
  const scopes = str(o.scopes).trim();
  if (scopes) out.scopes = scopes;
  return Object.keys(out).length ? out : undefined; // keep DCR scopes even with no clientId
}

function validateServer(raw: unknown): McpServer | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const name = str(s.name).trim();
  if (!name) return null; // a server without a name is meaningless — drop it
  const enabled = s.enabled === true;
  const defaults = toolDefaults(s.toolDefaults);
  if (s.transport === "http") {
    const url = str(s.url).trim();
    const oauth = validateOAuth(s.oauth);
    // auth is a choice; infer for legacy rows: a saved clientId ⇒ registered-app, oauth alone ⇒ DCR.
    let auth: HttpAuth = "headers";
    if (s.auth === "oauth" || s.auth === "oauthApp") auth = s.auth;
    else if (oauth?.clientId) auth = "oauthApp";
    else if (oauth) auth = "oauth";
    const server: McpServer = { name, enabled, transport: "http", url, auth };
    const headers = strRecord(s.headers);
    if (headers) server.headers = headers;
    if (oauth) server.oauth = oauth;
    if (defaults) server.toolDefaults = defaults;
    return server;
  }
  // default + fallback: stdio
  const command = str(s.command).trim();
  const server: McpServer = { name, enabled, transport: "stdio", command };
  if (Array.isArray(s.args)) server.args = s.args.filter((a): a is string => typeof a === "string");
  const env = strRecord(s.env);
  if (env) server.env = env;
  if (defaults) server.toolDefaults = defaults;
  return server;
}

export const manifest: PluginManifest<McpSettings> = {
  slug: MCP_SLUG,
  name: "MCP",
  version: "0.1.0",
  defaultEnabled: false,
  systemPrompt:
    "You have access to tools from connected MCP (Model Context Protocol) servers. They are named " +
    "MCP_<Server>_<Tool> — the prefix tells you which server provides each. These tools are external and " +
    "can act outside the app, so most require per-call approval. Use them as you would any other tool, " +
    "reading each tool's schema for its arguments. Only the tools of currently-connected servers are " +
    "available; if a capability you expect is missing, the relevant server may not be connected.",
  settingsDefaults: { servers: [] },
  validateSettings(raw: unknown): McpSettings {
    const list = (raw as { servers?: unknown })?.servers;
    const servers = Array.isArray(list) ? list.map(validateServer).filter((s): s is McpServer => s !== null) : [];
    return { servers };
  },
};
