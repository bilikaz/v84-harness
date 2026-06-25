// streamable-HTTP transport — reaches a remote MCP server over HTTP/SSE. Pure fetch, so this module is
// web-capable (subject to CORS) — kept apart from stdio.ts (which pulls node:child_process).

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpServer } from "../types.ts";

type HttpServer = Extract<McpServer, { transport: "http" }>;

// Auth is a choice the service resolves: it passes either manual headers (and no authProvider) or an
// OAuthClientProvider (and no headers). The SDK + provider drive the OAuth 2.1 auth-code/PKCE flow
// (discovery, optional dynamic client registration, token fetch + refresh). Returns the concrete type so
// the service can call finishAuth() to complete the browser leg.
export function httpTransport(server: HttpServer, headers?: Record<string, string>, authProvider?: OAuthClientProvider): StreamableHTTPClientTransport {
  const opts: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] = { requestInit: { headers: headers ?? {} } };
  if (authProvider) opts.authProvider = authProvider;
  return new StreamableHTTPClientTransport(new URL(server.url), opts);
}
