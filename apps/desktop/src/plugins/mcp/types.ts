// Shared shapes for the MCP plugin — imported by the manifest (renderer), the main-side service + tool,
// and the UI. Kept separate from manifest.ts so the main-process service imports only types.
//
// One plugin, two transports: the transport sits on each server (stdio = a local subprocess, http = a
// remote streamable endpoint), so the service knows how to reach a given server. Adding a transport is a
// new union member + a transport factory.

export const MCP_SLUG = "mcp";

export type McpTransport = "stdio" | "http";

// Per-tool default permission MODE (0 off / 1 ask / 2 allow), set in the server card after connect.
export type ToolMode = 0 | 1 | 2;

// OAuth config for HTTP-transport servers. All optional: the registered-app mode uses clientId/secret;
// the DCR mode uses only scopes (no app). scopes are space-separated.
export interface OAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
}

interface McpServerBase {
  name: string;
  enabled: boolean;
  toolDefaults?: Record<string, ToolMode>;
}

// HTTP auth is a CHOICE (default headers):
//  - "headers"  : manual Authorization header / PAT
//  - "oauth"    : OAuth, dynamic client registration — no app to create (e.g. Supabase)
//  - "oauthApp" : OAuth with a pre-registered app — Client ID/secret required (e.g. GitHub)
export type HttpAuth = "headers" | "oauth" | "oauthApp";

// The app's single OAuth loopback callback (RFC 8252 native-app pattern). One fixed URI reused for every
// server: DCR servers register it automatically; servers needing a pre-registered app (GitHub) want this
// EXACT value as the OAuth App's callback URL. Fixed port so it always matches what was registered.
export const OAUTH_REDIRECT_PORT = 33418;
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${OAUTH_REDIRECT_PORT}/callback`;

export type McpServer =
  | (McpServerBase & { transport: "stdio"; command: string; args?: string[]; env?: Record<string, string> })
  | (McpServerBase & { transport: "http"; url: string; auth?: HttpAuth; headers?: Record<string, string>; oauth?: OAuthConfig });

export interface McpSettings {
  servers: McpServer[];
}

// PascalCase a free-form name (snake_case / kebab / spaces / dots) — splits on any non-alphanumeric and
// capitalises each part, preserving internal caps (so an already-camelCase word keeps them).
function pascal(s: string): string {
  return s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

// The model-facing name for an MCP tool: MCP_<Server>_<Tool>, both segments PascalCased to match the
// platform's tool-naming convention (DatabaseQuery, ImageGenerate, …). Dispatch never parses this — the
// service maps it back to the raw { server, tool } — so the cosmetic form is free to be friendly.
export function mcpToolName(server: string, tool: string): string {
  return `MCP_${pascal(server)}_${pascal(tool)}`;
}
