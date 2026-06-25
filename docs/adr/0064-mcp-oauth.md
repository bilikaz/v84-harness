# ADR-0064: MCP OAuth — authorization-code + PKCE, DCR or pre-registered, in-app loopback

Status: Accepted
Date: 2026-06-23
Refines [ADR-0063](0063-mcp-client-plugin.md). Present-tense map: [architecture/mcp.md](../architecture/mcp.md).

## Context

Remote MCP servers authenticate via the **MCP authorization spec** — OAuth 2.1 **authorization-code + PKCE**
with RFC 9728 / RFC 8414 discovery. Two real servers shaped the design: **Supabase** supports **dynamic
client registration** (DCR) — no app to create; **GitHub** requires a **pre-registered OAuth App's
`client_id`** (no anonymous DCR). A desktop app has no public redirect URL and cannot safely hold a client
secret, and a user must consent in a browser. An early implementation used `client_credentials` — wrong: that
is machine-to-machine, not user-delegated.

## Decision

The SDK's `OAuthClientProvider` drives discovery / PKCE / token exchange; we own the Electron glue
(`plugins/mcp/oauth.ts`, main-only).

- **Three auth modes per HTTP server, a choice never mixed** (the card shows only the chosen mode's fields):
  - `headers` — a manual `Authorization` header / PAT (CI-style, simplest).
  - `oauth` — OAuth via **DCR**: no app to create (Supabase).
  - `oauthApp` — OAuth with a **pre-registered app**: `clientId` (+ secret) required (GitHub).
  One provider serves both OAuth modes: `clientInformation()` returns the configured client when set
  (`oauthApp`), or `undefined` to trigger DCR (`oauth`).
- **Loopback redirect** (RFC 8252 native-app pattern): one fixed app-wide callback
  `http://127.0.0.1:33418/callback`. DCR registers it automatically; a pre-registered app registers it as its
  exact callback. The port is **fixed** (not ephemeral) so it always matches what providers like GitHub
  require to be registered.
- **Consent opens in an in-app Electron `BrowserWindow`** (persistent session partition), not the system
  browser. `shell.openExternal` proved unreliable in some environments (silently no-ops, hanging the flow);
  an in-app window is self-contained and lets us detect the user closing it (clean failure instead of a hang).
- **`auth()` driven proactively**, not on a lazy 401. Some servers (GitHub) surface the unauthorized response
  as a plain HTTP error before the transport's lazy 401 auth fires. We call `auth()` up front → `AUTHORIZED`
  (cached/refreshed token) or `REDIRECT` (open the window) → await the loopback `code` → exchange → connect.
  **Self-heal:** if a silently-`AUTHORIZED` connect is rejected (token removed/revoked/stale), the credentials
  are cleared and the flow re-runs interactively (one fresh consent) — reconnecting after a token is gone
  re-authenticates rather than erroring.
- **Tokens are machine-local**, `safeStorage`-encrypted in a file under `userData` — **never synced**.
  Refresh tokens are device-bound and sensitive, unlike the plugin's synced settings row ([ADR-0045](0045-machine-local-vs-account-synced.md)).
  DCR-minted client info is stored alongside (so reconnects don't re-register); the PKCE verifier is
  in-memory only; the `state` parameter is validated against CSRF.

### Alternatives considered

- **System browser** (`shell.openExternal`) — rejected: unreliable here, and the loopback hang has no clean
  recovery.
- **Custom-protocol redirect** (`app.setAsDefaultProtocolClient`) — rejected: OS-specific registration,
  flaky in dev; loopback needs none of it.
- **`client_credentials`** — rejected: machine-to-machine, not user consent; this was the early wrong attempt.
- **Synced tokens** — rejected: refresh tokens should not leave the device.

## Consequences

- One flow covers DCR and pre-registered servers; the user only creates an app when the server demands one
  (GitHub), and never for DCR servers (Supabase).
- The in-app-window + loopback + machine-local-token pattern is reusable for any future OAuth-authenticated
  remote integration, not just MCP.
- The fixed loopback port is a small constraint: if `33418` is taken the connect fails with a clear message
  (rare); making it configurable is a future option, not a v1 need.
