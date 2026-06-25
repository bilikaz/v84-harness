// The MCP plugin's stateful service — a module-level singleton in the MAIN process. Owns the live MCP
// clients keyed by RAW server name. On connect it discovers the server's tools (tools/list) and REGISTERS
// one McpTool per tool into the main registry (via the registrar the host bound at startup); on disconnect
// it unregisters them and closes the client. The agent's tool set is the union of connected servers' tools.
//
// Connections are opened on demand (the right-rail panel / a Refresh), never eagerly — install() is a no-op,
// matching the Database plugin. Secrets follow the DB pattern: saved env/headers ride config; a transient
// override may be supplied at connect and is never persisted.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { PluginToolRegistrar } from "../../core/plugins/types.ts";
import type { ToolResult, ToolSpec, Image } from "../../core/tools/types.ts";
import { cap } from "../../core/tools/base.ts";
import { errorMessage } from "../../lib/errors.ts";
import { McpTool, type McpToolDescriptor } from "./tool.ts";
import { MCP_SLUG, mcpToolName, type McpServer } from "./types.ts";
import { stdioTransport } from "./transports/stdio.ts";
import { httpTransport } from "./transports/http.ts";
import { McpOAuthProvider, authorizeInWindow } from "./oauth.ts";

export interface McpSecretOverride {
  env?: Record<string, string>;
  headers?: Record<string, string>;
  oauthClientSecret?: string;
}

interface Live {
  client: Client;
  tools: string[]; // ORIGINAL MCP tool names (the toolDefaults keys); prefixed names derive via mcpToolName
}

const live = new Map<string, Live>();

// The host binds this at startup (wirePluginTools), before any connect.
let registrar: PluginToolRegistrar | null = null;
export function bindRegistrar(r: PluginToolRegistrar): void {
  registrar = r;
}

// Connection-state subscribers — the host forwards to the renderer so the panel reflects every change.
type Emit = (type: string, payload: unknown) => void;
const sinks = new Set<Emit>();
export function subscribe(emit: Emit): void {
  sinks.add(emit);
}
function notify(): void {
  const names = [...live.keys()];
  for (const s of sinks) s("connections", names);
}

// Plain transport (no OAuth): manual headers for http, subprocess for stdio. The OAuth path is its own
// dance in openConnectedClient(), since it spans a browser round-trip.
function transportFor(server: McpServer, override?: McpSecretOverride): Transport {
  if (server.transport === "http") return httpTransport(server, { ...server.headers, ...override?.headers });
  return stdioTransport(server, override?.env);
}

async function newConnectedClient(transport: Transport): Promise<Client> {
  const client = new Client({ name: "v84-harness", version: "0.1.0" });
  try {
    await client.connect(transport);
    return client;
  } catch (e) {
    await client.close().catch(() => undefined);
    throw e;
  }
}

// Bring up a client for a server, handling the OAuth browser dance. We drive auth() PROACTIVELY rather than
// waiting for the transport to surface a 401 (some servers — GitHub — return it as a plain HTTP error before
// the transport's lazy auth fires). auth() runs discovery (+ dynamic registration when no clientId) and
// returns AUTHORIZED (cached/refreshed token) or REDIRECT (we open the in-app window, await the loopback
// code, exchange it). Self-heal: if a silently-authorized connect fails — a removed / revoked / stale token
// that still looked usable — we clear the stored credentials and fall through to a fresh interactive consent,
// so reconnecting after the token is gone re-authenticates instead of erroring. At most one window.
async function openConnectedClient(server: McpServer, override?: McpSecretOverride): Promise<Client> {
  if (server.transport !== "http" || (server.auth !== "oauth" && server.auth !== "oauthApp")) {
    return newConnectedClient(transportFor(server, override));
  }
  const isApp = server.auth === "oauthApp"; // registered-app → supply client id/secret; DCR → none
  const provider = new McpOAuthProvider(server.name, {
    clientId: isApp ? server.oauth?.clientId : undefined,
    clientSecret: isApp ? (override?.oauthClientSecret ?? server.oauth?.clientSecret) : undefined,
    scopes: server.oauth?.scopes,
  });
  const opts = { serverUrl: server.url, scope: server.oauth?.scopes };

  let result = await auth(provider, opts);
  if (result === "AUTHORIZED") {
    // Had (or refreshed) a token — try it. If the server rejects it (gone/revoked), drop creds and re-consent.
    try {
      return await newConnectedClient(httpTransport(server, undefined, provider));
    } catch {
      provider.invalidateCredentials("all");
      result = await auth(provider, opts); // no token now → REDIRECT
    }
  }
  if (result === "REDIRECT") {
    if (!provider.authorizeUrl) throw new Error("OAuth flow did not produce an authorization URL");
    for (const sink of sinks) sink("authorizing", server.name); // consent window open
    const code = await authorizeInWindow(provider.authorizeUrl, (s) => s === provider.expectedState());
    await auth(provider, { ...opts, authorizationCode: code });
  }
  return newConnectedClient(httpTransport(server, undefined, provider));
}

// MCP content blocks → ToolResult: join text, surface images as data URLs, isError → ok:false.
// Accepts the SDK's union return (new format with content/isError, or compat format with toolResult).
function mapResult(res: { content?: unknown; isError?: boolean; toolResult?: unknown }): ToolResult {
  const blocks = Array.isArray(res.content) ? (res.content as Array<Record<string, unknown>>) : [];
  const texts: string[] = [];
  const images: Image[] = [];
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
    else if (b.type === "image" && typeof b.data === "string") images.push({ url: `data:${typeof b.mimeType === "string" ? b.mimeType : "image/png"};base64,${b.data}`, mime: typeof b.mimeType === "string" ? b.mimeType : undefined });
    else texts.push(JSON.stringify(b));
  }
  const text = texts.join("\n").trim();
  const result: ToolResult = { ok: res.isError !== true, output: cap(text || (images.length ? "[image content]" : "(no content)")) };
  if (images.length) result.images = images;
  return result;
}

async function callTool(client: Client, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  try {
    const res = await client.callTool({ name: tool, arguments: args }, CallToolResultSchema, { signal });
    return mapResult(res);
  } catch (e) {
    return { ok: false, output: `MCP tool "${tool}" failed: ${errorMessage(e)}` };
  }
}

// Connect (or re-fire): drop any prior registration, open the client, discover tools, register each.
// Throws on failure (no client established / tools/list failed) — the panel surfaces the message verbatim.
async function connect(server: McpServer, override?: McpSecretOverride): Promise<void> {
  if (!registrar) throw new Error("MCP tool registrar not bound");
  await disconnect(server.name);
  const client = await openConnectedClient(server, override);
  const names: string[] = [];
  try {
    // Discovery + registration AFTER a live connection — if either throws, the client is connected but not
    // yet in `live`, so unwind here (unregister partial tools, close the client) or it leaks unreachable.
    const { tools } = await client.listTools();
    for (const t of tools) {
      const schema: ToolSpec = {
        type: "function",
        function: { name: mcpToolName(server.name, t.name), description: t.description ?? "", parameters: t.inputSchema ?? { type: "object" } },
      };
      const desc: McpToolDescriptor = { server: server.name, tool: t.name, schema, call: (args, signal) => callTool(client, t.name, args, signal) };
      registrar.register(new McpTool(registrar.config, desc), MCP_SLUG);
      names.push(t.name);
    }
  } catch (e) {
    for (const t of names) registrar.unregister(mcpToolName(server.name, t));
    await client.close().catch(() => undefined);
    throw e;
  }
  live.set(server.name, { client, tools: names });
  notify();
}

async function disconnect(name: string): Promise<void> {
  const l = live.get(name);
  if (!l) return;
  live.delete(name);
  for (const t of l.tools) registrar?.unregister(mcpToolName(name, t));
  notify();
  await l.client.close().catch(() => undefined);
}

// UI-invokable surface (not agent tools).
export const rpc = {
  connect: (server: McpServer, override?: McpSecretOverride) => connect(server, override),
  disconnect: (name: string) => disconnect(name),
  refresh: (server: McpServer, override?: McpSecretOverride) => connect(server, override),
  status: () => [...live.keys()],
  tools: (name: string) => live.get(name)?.tools ?? [], // ORIGINAL tool names of a connected server, for the card
};

// Lifecycle. install: nothing eager — servers connect on demand from the panel. uninstall: drop everything.
export function install(): void {}
export async function uninstall(): Promise<void> {
  await Promise.all([...live.keys()].map(disconnect));
}
