# ADR-0047: First-party, in-tree plugin system

Status: Accepted
Date: 2026-06-17
Supersedes the `plugins`-table clause of [ADR-0043](0043-per-entity-repos.md) (the installed-registration row is dropped; `plugin_data` stays). Builds on [ADR-0008](0008-ui-registry-routing.md) (the contribution registry), [ADR-0033](0033-tools-registry-folder-by-permission.md) (the tool registry), [ADR-0042](0042-unified-settings-registry.md) (config domains), and is enabled by [ADR-0048](0048-tool-ctx-config-carrier.md) (tools read config) and [ADR-0049](0049-plugin-service-bridge.md) (the service bridge).

## Context

The `plugins` / `plugin_data` tables were scaffolding ([ADR-0043](0043-per-entity-repos.md)) with no
reader. The standing goal was a real plugin system: a self-contained capability (a database client, an
integration) contributing tools, UI, config, and stateful runtime, addable without editing `App.tsx` or
core wiring. The first concrete need is a MySQL plugin.

The scaffolded `plugins` table modelled *installed registrations* — a minted id, stored
`version`/`config`/`permissions`/`placement`. That fits third-party/runtime-loaded plugins. We don't want
those: runtime code loading near the Electron main process is a security problem, and a sandbox is a large
build we have no use for. The plugins we want are **ours**, compiled in.

## Decision

A plugin is a **first-party, in-tree folder** (`apps/desktop/src/plugins/<slug>/`), bundled at build
time. No runtime loading, no sandbox, no trust boundary. The **slug** (folder name) is its identity
everywhere — `ownerPluginId` on tools, `pluginId` on UI contributions, `plugin_id` on `plugin_data` rows,
the key under `config.plugins.<slug>`. No minted id.

- **`config.plugins.<slug>` is the sole source of truth for enable + settings** — a synced settings row
  ([ADR-0042](0042-unified-settings-registry.md), [ADR-0045](0045-machine-local-vs-account-synced.md)),
  derived from the registered manifests, validated by each manifest. The scaffolded **`plugins` table is
  dropped** (table + repos + routers + `PluginRow`): config owns enable + settings, the manifest owns
  identity + version, so the row has no job. Two enable flags would be the dual-writer trap
  [ADR-0043](0043-per-entity-repos.md) exists to prevent. `plugin_data` stays, keyed by slug.
- **Registered at boot, gated at runtime.** Manifests, tools, UI contributions, and locales are globbed
  eagerly; every plugin is registered from boot. "Enabled" is a pure runtime filter — the tool registry
  drops a disabled plugin's tools (by `ownerPluginId`), `<Slot>`/`SettingsModal` drop its UI (by
  `pluginId`). Never a glob-time or registration-time decision.
- **The plugin folder feeds the existing registries**, by tier and region — tools into the per-process
  tool registries (reusing `general`/`local`/`account`/`remote`), UI into the contribution registry,
  config into the settings registry, locales into i18next. A plugin is just additional source folders;
  the slug on the glob path is the owner tag.
- **A plugin's settings get their own settings-menu section** (registered into the `settings` region,
  gated by enabled); the core "Plugins" section is the enable/disable master list.
- **Positioning: plugins target the Electron build.** Web is the default user app; plugins are a
  power/dev feature. Web parity is a non-goal — Node-backed services + `local`/`remote` tools are
  desktop-only; on web a plugin still gets config, UI, `general`/`account` tools, and `pluginData`.

The reference plugin is `plugins/database/` (since generalized from MySQL-only to MySQL + Postgres); the
full surface and author guide are in [architecture/plugins.md](../architecture/plugins.md).

## Consequences

- A feature can ship as one toggleable folder (tools + UI + service + config + i18n) with no edits to
  `App.tsx` or core registries; deleting the folder removes it everywhere.
- Runtime enable/disable cleanly removes a plugin's tools and UI without unloading code; the code is
  always present, only advertised when enabled.
- No installed-registration state to drift: identity is the folder, enable/config is one synced row.
- The `plugins` server table + its repos/routers are removed; nothing read them, so no migration.
- Third-party/runtime-loaded plugins remain explicitly out of scope; revisiting them would mean a real
  sandbox + capability manifest, a separate decision.
- Cross-cutting enabling decisions are split out: tools reading config ([ADR-0048](0048-tool-ctx-config-carrier.md))
  and the service bridge ([ADR-0049](0049-plugin-service-bridge.md)).
