# ADR-0049: Plugin service bridge — RPC, event push, and lifecycle

Status: Accepted
Date: 2026-06-17
Builds on [ADR-0002](0002-typed-ipc-bridge.md) (the typed IPC bridge), [ADR-0036](0036-host-capability-surface.md) (`ctx.api`), and [ADR-0047](0047-first-party-in-tree-plugins.md) (the plugin model). Adds the bridge's first main→renderer push channel.

## Context

A plugin's stateful, long-lived resources (a DB connection pool, a socket) must live in the **main
process** — they need Node, and the local-tier tools that use them run there. But the plugin's UI lives in
the renderer and needs to: invoke service operations that are **not** agent tools (a connect/disconnect
button), reflect service state **live** (a connection opened by an agent query's auto-connect, not just a
UI action), and run setup/teardown when the plugin is enabled/disabled.

The existing bridge was entirely request/response (`ctx.api`, `ctx.tools`, `ctx.storage`) and had no
plugin-extensible path and no main→renderer push. Exposing service operations as agent tools was wrong:
the agent neither needs nor should see connection management.

## Decision

A plugin's `service.ts` is a **main-process singleton** (the same instance its local-tier tools import).
It is reached three ways, all generic across plugins:

- **RPC (UI → service)** — the service exports an `rpc` record. The UI calls
  `ctx.api.invokePlugin(slug, method, args)` → `IPC.pluginInvoke` → `electron/pluginServices.ts` (globs
  `plugins/*/service.ts`) dispatches to `rpc[method]`. A thrown error crosses the bridge as the caller's
  rejection, so the UI surfaces the message.
- **Events (service → UI)** — the service exports `subscribe(emit)`. The host (`electron/index.ts`)
  subscribes once and forwards each `emit(type, payload)` to the renderer over `IPC.pluginEvent`
  (`webContents.send`), surfaced as `ctx.api.onPluginEvent(cb)` returning an unsubscribe. Because the
  service is the singleton, it emits on **every** state change, so the UI reflects agent-driven changes,
  not just its own actions. This is the bridge's first push channel.
- **Lifecycle** — the service may export `install()` / `uninstall()`. `install` runs when the plugin is
  enabled and at boot for already-enabled plugins (`installEnabledPlugins`); `uninstall` on disable.
  Dispatched over the **same** `invokePlugin` channel as reserved phase names (`"install"`/`"uninstall"`)
  — no extra channel; rpc methods may not use those names.

So the bridge gains exactly two channels: `pluginInvoke` (request/response, also carries lifecycle) and
`pluginEvent` (push). Both are part of `ctx.api` ([ADR-0036](0036-host-capability-surface.md)) and are
**absent on web** — the renderer helper (`core/plugins/service.ts`) returns a clean "desktop only" result
and the UI still renders.

## Consequences

- Connection management (connect/disconnect/status) is the UI's, not the agent's — those are service RPC,
  never tools; the agent's surface stays the actual capabilities (query/test).
- The UI is live: a status dot driven by `subscribe` flips when an agent query auto-connects, with no
  polling.
- Plugins get setup/teardown: disabling a plugin tears its live resources down (the MySQL service closes
  all pools), not just hides its UI.
- One generic mechanism serves every plugin; a new plugin's service drops in with `rpc`/`subscribe`/
  `install`/`uninstall` and is wired automatically by the glob.
- A second main→renderer push consumer is now cheap (the channel exists); the bridge's "revisit when it
  grows" handshake gap ([ADR-0002](0002-typed-ipc-bridge.md)) grows by two more channels — noted in the
  ADR index's needs-review list.
- The service trusts its renderer caller (first-party UI); the agent cannot reach `invokePlugin` (only
  tools), so there's no agent path around tool approval into raw service methods.
