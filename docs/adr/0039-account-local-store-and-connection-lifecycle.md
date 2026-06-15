# ADR-0039: `account` — the lone local store, connection lifecycle, and renderer tool tier

Status: Accepted
Date: 2026-06-15
Resolves: the "Account Connected mode" needs-review item (ADR README). Extends [ADR-0033](0033-tools-registry-folder-by-permission.md) (per-platform tool execution) and works with [ADR-0038](0038-storage-backend-swappable-at-runtime.md).

## Context

With the backend swappable ([ADR-0038](0038-storage-backend-swappable-at-runtime.md)),
something has to decide WHEN it is remote, hold the identity + tokens, and drive
the re-hydrate. That state can't itself live in `ctx.storage`: it must be readable
*before* the backend is chosen (to pick the initial backend) and must survive a
logout that wipes the remote. The legacy "Connected mode" was a UI placeholder
with no design — this is the design.

A second constraint: the memory tools ([ADR-0041](0041-knowledgebase-plane.md))
call the knowledge API with the user's bearer token. Under electron, tools run in
MAIN ([ADR-0033](0033-tools-registry-folder-by-permission.md)) — but the token
must NOT cross the IPC bridge. So those specific tools need a different execution
tier.

## Decision

**`core/account.ts` is the one store that stays local + synchronous**
(`localStorage`, its own `createListeners` — deliberately NOT a `Consumer`).

```ts
interface Account { username; avatar; connection: "offline" | "connected"; endpoint?; accessToken?; refreshToken? }
isConnected(): boolean        // connected && endpoint && accessToken
login / register / logout / setConnection(mode)   // drive the backend switch
authedFetch(path, init)       // Bearer inject + refresh-once-on-401 + retry
attachAccount(ctx)            // hands the module the ctx whose storage it swaps
```

- **The account owns the switch sequence.** `applyConnection()` IS the whole
  switch: `isConnected() ? ctx.storage.connect(new RemoteStorage(authedFetch)) :
  ctx.storage.disconnect()`, then
  `await Promise.all([hydrateConsumers(), hydrateSessions()])`.
  `login`/`logout`/`setConnection` all funnel through it. `setConnection` keeps
  the tokens (toggle online/offline without re-login); `logout` clears them (and
  best-effort calls `/auth/logout`).
- **Auth is a short access token + a rotating refresh token.** `authedFetch`
  injects the access token and, on a 401, refreshes once (rotating the refresh
  token) and retries; a failed refresh drops to offline. Requests carry an
  `X-Device-Name` so the server keeps per-device sessions
  ([ADR-0040](0040-knowledge-remote-service.md)).
- **Memory tools run in the renderer tier.** Both `init()`s build the
  `core/tools/account/*` tools in an in-process `ToolRegistry`; electron MERGES
  that with the bridged main registry — `filter` spreads
  `{ ...(await mainFilter), ...accountReg.filter }` and `run` routes by
  `accountReg.byName.has(call.name)` (renderer) vs. the bridge (main). So
  `authedFetch` (token + refresh) never leaves the renderer, while workspace/fs
  tools still run in main. `BaseAccountTool.canRun()` gates the whole tier on
  `isConnected()`.

## Consequences

- There is exactly one local-only store, and its reason is structural (bootstrap
  + survives logout), not an exception to argue about.
- Login / logout / toggle are reload-free and centralized: one function
  (`applyConnection`) is the only place the backend and the hydration move
  together.
- The token has one home (the account, renderer-side) and one exit (`authedFetch`
  → knowledge API); it is never serialized into `ctx.storage` and never crosses
  IPC.
- The "Connected mode" needs-review item is resolved; its ADR README index row
  and the gap entry come out.
