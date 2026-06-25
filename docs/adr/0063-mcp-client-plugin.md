# ADR-0063: MCP client as a first-party plugin

Status: Accepted
Date: 2026-06-23
Builds on [ADR-0047](0047-first-party-in-tree-plugins.md) (the plugin model),
[ADR-0062](0062-runtime-registered-tools.md) (runtime tools), and
[ADR-0052](0052-system-prompt-layering.md) (capability blocks). Present-tense map:
[architecture/mcp.md](../architecture/mcp.md), [architecture/plugins.md](../architecture/plugins.md).

## Context

We want the agent to use tools from external **MCP (Model Context Protocol)** servers. MCP servers come in
two shapes that pull in opposite directions: **local** servers (stdio — a subprocess that acts on the user's
own files/machine) and **remote** servers (streamable HTTP — a hosted endpoint). The harness is dual-target
(Electron + web), and its tool system is build-time static.

## Decision

**MCP ships as a first-party in-tree plugin `plugins/mcp/`, client plane, tools-only for v1.**

- **Plugin, not `core/mcp`.** MCP is configuration-driven and **inert until the user adds a server** — the
  Database-plugin shape, not the always-on browser/memory/agents shape. It reuses the whole plugin machinery
  (config-as-truth, service-owned connections, status events, settings UI, capability block, web degradation);
  the one thing the plugin model lacked — dynamic tools — is [ADR-0062](0062-runtime-registered-tools.md), now
  a reusable primitive rather than MCP-special core wiring.
- **Client plane.** Live connections live in the plugin's **main-side service singleton** (on the user's
  machine), reached over the existing plugin bridge. The **server-plane** option (the `apps/knowledge` API
  hosting connections, surfaced as account-tier tools like memory) is **parked**: it suits hosted/shared
  servers and the agent pipeline later, but local stdio servers must run next to the user's data, so the
  client plane is correct for v1.
- **Transport-gated, not platform-gated.** stdio (subprocess, `node:child_process`, main-only) +
  streamable-HTTP (fetch, web-capable subject to CORS), split into `transports/{stdio,http}.ts` so the web
  bundle can pull only HTTP. v1 ships the **Electron path** (both transports in main); web-HTTP is a
  fast-follow if the SDK's HTTP transport bundles into the renderer. stdio is desktop-only by nature.
- **Connect → discover → register.** On connect the service calls `tools/list` and **registers one
  `McpTool` (a regular `BaseTool`) per tool** via the [ADR-0062](0062-runtime-registered-tools.md) registrar;
  disconnect / a manual **Refresh** unregisters. The tool list isn't in config (only server *definitions*
  are), so registration must happen at connect; the manual Refresh is how v1 covers `tools/list_changed`.
- **Naming: `MCP_<Server>_<Tool>`**, both segments PascalCased (consistent with `DatabaseQuery`,
  `ImageGenerate`). The service keeps a `registeredName → { raw server, raw tool }` map, so dispatch never
  parses the display name and the cosmetic form is free.
- **Gating.** Every MCP tool is `isPermissioned() = true` (external — always governed); its default **mode**
  comes from the server card's per-tool `toolDefaults` (**ask** if unset); per-server enable is a config read
  in `canRun()`; plugin-level enable is the registry owner gate. Tools appear **individually** in the
  permissions catalog — there is no generic "call any MCP tool" proxy.
- **Capability block.** `manifest.systemPrompt` teaches the model the `MCP_<Server>_<Tool>` shape and the
  approval boundary, appended while the plugin is enabled ([ADR-0052](0052-system-prompt-layering.md)).
- `@modelcontextprotocol/sdk` owns the protocol (transports, handshake, `tools/list` + `tools/call`).

### Scope (v1)

Tools only. MCP **resources** and **prompts** are deferred. The **server plane** is parked.
`tools/list_changed` is covered by the manual Refresh. OAuth is [ADR-0064](0064-mcp-oauth.md).

## Consequences

- A self-contained, deletable folder adds a whole external-tool capability without touching core wiring — and
  proves [ADR-0062](0062-runtime-registered-tools.md)'s registrar with a real second consumer beyond core tools.
- MCP and plugins are **complementary**: standard servers connect via MCP; bespoke/local integrations stay
  cheaper as hand-written plugins (the reason this is a plugin, not a core replacement for them).
- The parked server plane and deferred resources/prompts are explicit revisit points, not omissions.
- Web is Electron-only in practice for v1 (the service is main-only-globbed); the architecture stays
  transport-gated so web-HTTP is an additive follow-up, not a redesign.
