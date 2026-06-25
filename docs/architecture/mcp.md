# MCP plugin

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md). Decisions behind the shape:
[ADR-0063](../adr/0063-mcp-client-plugin.md) (MCP as a plugin), [ADR-0062](../adr/0062-runtime-registered-tools.md)
(runtime tool registration — the mechanism), [ADR-0064](../adr/0064-mcp-oauth.md) (OAuth). The plugin system
it lives in: [plugins.md](plugins.md); the tool registry it feeds: [tools.md](tools.md).

The **MCP** plugin (`plugins/mcp/`) connects the harness, as a **client**, to external Model Context Protocol
servers and exposes **their tools** to the agent alongside the built-in tiers. It is the client plane:
connections live on the user's machine (the main-process service), not in the cloud. Tools only — MCP
resources and prompts are out of scope for now.

## Folder layout

```
plugins/mcp/
  manifest.ts        # slug "mcp"; settings = server list; validateSettings; systemPrompt capability block
  types.ts           # McpServer (transport + auth discriminants), OAuthConfig, MCP_<Server>_<Tool> naming, redirect URI
  tool.ts            # McpTool — a BaseTool registered at connect (NOT globbed; lives outside tools/)
  service.ts         # main singleton: live clients by server name; connect/disconnect/refresh; register/unregister tools
  oauth.ts           # main-only: OAuthClientProvider + in-app auth window + loopback + safeStorage token store
  transports/        # stdio.ts (subprocess — main only) + http.ts (streamable HTTP, web-capable)
  ui/                # Settings.tsx (server cards + per-tool defaults), RightPanel.tsx (connect/status), register.tsx
  locales/           # en.json, lt.json
```

## How a server becomes tools

Connections are opened **on demand** (the right-rail panel / a card's Connect), never eagerly — `install()`
is a no-op, like the Database plugin. On connect the service:

1. builds the transport for the server (stdio subprocess or streamable-HTTP; OAuth runs first — see below),
2. calls `tools/list`,
3. for each tool **registers an `McpTool`** into the main registry via the injected registrar
   ([ADR-0062](../adr/0062-runtime-registered-tools.md)), named `MCP_<Server>_<Tool>`.

`McpTool` is an ordinary `BaseTool`, so it flows through `ctx.tools.filter/run/cancel` like any tool — it
appears **individually** in the model's tool list and the permissions catalog. It reads `config.plugins.mcp`
for gating: `canRun()` = the server is enabled; `defaultPermission()` = the card's per-tool `toolDefaults`
(**ask** if unset); `isPermissioned()` is always true (external — always governed). The service holds a
`registeredName → { raw server, raw tool }` map, so `run()` dispatches to the live client by the **original**
tool name — the PascalCase display name is never parsed. Disconnect / **Refresh** unregisters the server's
tools (Refresh = re-list + re-register, the v1 stand-in for `tools/list_changed`). Per-tool permission choices
survive re-registration because the policy keys on the stable name.

The service reaches the registry without importing the platform: the host injects a `PluginToolRegistrar`
(`register` / `unregister` + the wire-seeded `config` getter) via `electron/pluginServices.ts wirePluginTools()`
→ the service's `bindRegistrar()`, wired once at startup ([ADR-0062](../adr/0062-runtime-registered-tools.md)).

## Transports

| Transport | Module | Runs in | Notes |
| --- | --- | --- | --- |
| stdio | `transports/stdio.ts` | main only | spawns the server as a subprocess (`node:child_process`); local servers acting on the user's machine. Command + args + env; on Windows bare `npx` may need `cmd /c npx …`. |
| streamable HTTP | `transports/http.ts` | main (v1); renderer-capable | `fetch`-based; remote/hosted servers. Web bundle could load only this (subject to CORS) — a fast-follow. |

Split so the web bundle can pull HTTP without dragging `node:child_process` in. v1 ships the Electron path
(both in main).

## Authentication (HTTP servers)

Auth is a **choice, never mixed** — the card shows only the selected mode's fields ([ADR-0064](../adr/0064-mcp-oauth.md)):

- **Headers** — a manual `Authorization` header / PAT.
- **OAuth (automatic)** — OAuth 2.1 auth-code + PKCE with **dynamic client registration**; no app to create (e.g. Supabase).
- **OAuth (registered app)** — same flow with a **pre-registered** `client_id` (+ secret) (e.g. GitHub).

`oauth.ts` implements the SDK's `OAuthClientProvider`; the SDK drives discovery / PKCE / token exchange. The
flow (`service.ts establish()`): call `auth()` **proactively** (some servers return the 401 as a plain HTTP
error before lazy auth fires) → `AUTHORIZED` (cached/refreshed token, silent) or `REDIRECT` → open the
**in-app Electron `BrowserWindow`** at the authorize URL → the user consents → it redirects to the fixed
loopback `http://127.0.0.1:33418/callback` → capture the code → exchange → `client.connect()`. **Self-heal:**
if a silently-authorized connect is rejected (token removed / revoked / stale), the stored credentials are
cleared and the flow falls through to a fresh interactive consent — so reconnecting after the token is gone
re-authenticates instead of erroring (at most one window). Tokens are
`safeStorage`-encrypted **machine-local** (never synced); DCR client info stored alongside; PKCE verifier
in-memory; `state` validated against CSRF. The one fixed loopback URI is the app's callback for every server
— DCR registers it automatically; a pre-registered app must list it as its exact callback.

## State model

| Thing | Home | Realm |
| --- | --- | --- |
| Server list (name, transport, auth, headers/oauth config, per-tool `toolDefaults`) | `config.plugins.mcp` (settings row) | synced ([ADR-0045](../adr/0045-machine-local-vs-account-synced.md)) |
| Live clients (connections) | the `service.ts` singleton | ephemeral main-process state, gone on quit |
| OAuth tokens + DCR client info | `safeStorage`-encrypted file under `userData` | machine-local, never synced |

## Out of scope / revisit

- **Resources & prompts** — tools only for now.
- **Server plane** — hosting connections in `apps/knowledge` as account-tier tools (parked, [ADR-0063](../adr/0063-mcp-client-plugin.md)).
- **`tools/list_changed`** — manual Refresh today.
- **Web HTTP** — additive once the SDK's HTTP transport is confirmed to bundle into the renderer.
