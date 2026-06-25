# ADR-0062: Runtime-registered tools — the registry as a dynamic tool source

Status: Accepted
Date: 2026-06-23
Amends [ADR-0033](0033-tools-registry-folder-by-permission.md) (the tool registry was construction-only)
and [ADR-0049](0049-plugin-service-bridge.md) (the service bridge gains a tool registrar). Present-tense
map: [architecture/tools.md](../architecture/tools.md), [architecture/plugins.md](../architecture/plugins.md).

## Context

The tool registry has been a **build-time** structure — "the folder layout IS the registry"
([ADR-0033](0033-tools-registry-folder-by-permission.md),
[conventions/module-registries.md](../conventions/module-registries.md)): a folder of eager-globbed
modules, pre-instantiated **once** in the constructor into `byName`, never mutated. That fits tools known at
build time (the core tiers + each plugin's `tools/<tier>/` folders).

MCP servers ([ADR-0063](0063-mcp-client-plugin.md)) break that assumption. A server exposes a **variable set
of tools discovered only at connect**, different per server, changing when the server updates — there is no
folder and no build-time module. They are the codebase's first tool source that isn't on disk.

## Decision

**The registry accepts runtime entries, as first-class `BaseTool` instances.**

- `ToolRegistry` gains `register(tool, ownerPluginId?)` / `unregister(name)`. `byName` stays
  `Map<string, BaseTool>` — a runtime entry is an ordinary `BaseTool`, so `filter()` / `run()` / `cancel()`
  treat it **identically** to a globbed tool. No parallel advertise or dispatch path.
- Runtime entries are **owner-tagged programmatically** (the owner can't come from a glob path), so the
  disabled-plugin gate drops them like any plugin tool, and per-tool permission policy keys on the name as usual.
- A plugin's main-side **service contributes them through an injected registrar**, never by importing the
  platform: `electron/tools.ts` exposes `toolRegistrar` (`register` / `unregister` + the wire-seeded `config`
  getter); `electron/pluginServices.ts` `wirePluginTools()` hands it to each service's optional
  `bindRegistrar()`; the host wires it once at startup (mirrors the existing `wirePluginEvents` injection).
  Because the registrar carries the **main process's wire-seeded config getter**, a runtime tool's `canRun()` /
  `defaultPermission()` read live config exactly like a globbed tool.

### Alternatives considered

- **Pull provider** — the service exposes `listTools()` / `callTool()` and the gateway calls `listTools()` on
  every `filter()`. Keeps the registry immutable, but adds a second advertise/dispatch path that the
  permissions catalog, cancellation, and the owner gate would each have to special-case — while the agent's
  advertised tool set is the same either way. Rejected: pushing entries reuses every path that already exists.
- **Plugin imports `electron/tools.ts` directly** — simplest, but couples a plugin to the Electron platform
  and violates the dual-target layering (a plugin's `service.ts` is main-only, but the dependency direction
  must stay electron→plugin). Rejected for the injected registrar.

## Consequences

- The registry is no longer build-time-only; [module-registries.md](../conventions/module-registries.md)'s
  "folder IS the registry" gains a runtime-entries clause (a registry may also accept first-class entries
  registered at runtime by a stateful provider, gated the same way).
- This is the **first dynamic tool source**; future plugins (an OpenAPI importer, another protocol client)
  reuse `register`/`unregister` via the same registrar with no new mechanism.
- Dispatch never parses display names — the contributing service keeps a `name → source` map (see
  [ADR-0063](0063-mcp-client-plugin.md) naming).
- Amends [ADR-0033](0033-tools-registry-folder-by-permission.md) (registry was construction-only) and
  [ADR-0049](0049-plugin-service-bridge.md) (a service may now also receive a `PluginToolRegistrar`).
