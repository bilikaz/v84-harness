# ADR-0046: Typed containers unify chat and workspace

Status: Accepted
Date: 2026-06-16
Supersedes the workspace model behind [ADR-0016](0016-workspace-isolation-field.md) and [ADR-0023](0023-agent-definition-binding-and-ceiling.md)/[ADR-0026](0026-agent-session-placement-vs-capability.md)'s workspace assumptions: "workspace" and the magic null-"Chat" group become one `Container` type. Builds with [ADR-0043](0043-per-entity-repos.md) (the `containers` table).

## Context

The old model had two kinds of thing a session could belong to: a *workspace*
(a folder with tools) or nothing — and "nothing" was the magic `workspaceId: null`
"Chat" group, special-cased throughout the sidebar, session creation, and tool
gating. As remote (VM-backed) workspaces came onto the roadmap, this forced a
third special case, and "chat vs workspace" was a boolean where it wanted to be a
type. A null sentinel that means "the chat bucket" is exactly the kind of implicit
state that breeds branches.

## Decision

One entity — `Container` — with a **type**, replaces both workspaces and the null
"Chat" group.

```ts
type ContainerType = "chat" | "local" | "remote";
interface Container {
  id: string;
  type: ContainerType;
  name: string;
  permissions: Record<string, unknown>; // JSON tool-ceiling sessions inherit
  config: Record<string, unknown>;      // type-specific: {root} local; {dockerName, root} remote
  createdAt; updatedAt;
}
```

- **Chat is just a container** (`type: "chat"`) — no folder, no tools ceiling that
  matters, but a real row with a real id. The `workspaceId: null` sentinel is
  gone; a session always has a `containerId`.
- **`type` carries the workspace kind**, and config is type-specific JSON: `local`
  holds `{root}` (a filesystem path), `remote` holds `{dockerName, root}` (a VM
  container — scaffolded now, VM execution deferred). New kinds add a `type` value
  and a config shape, not a new special case.
- **`permissions` is the JSON tool ceiling** a session inherits and an agent can
  only narrow ([ADR-0023](0023-agent-definition-binding-and-ceiling.md)). It's
  per-container, model-independent.
- **The sidebar is three blocks by type** (chat / local / remote), each listing
  its containers; there is no separate "Chat" pseudo-group.
- **`config`/`permissions` as JSON** keeps the table stable as kinds grow — a new
  workspace kind doesn't migrate the schema, it fills a different config shape.

## Consequences

- One code path for "what does this session belong to" — `getContainer(session.containerId)` —
  with no null branch. Tool gating, the sidebar, and session creation lost their
  chat special-case.
- Remote workspaces are a `type` + a config shape away, not a third model. The VM
  runtime is the remaining work; the data model already holds it.
- `chat` containers carry a permissions/config object they barely use — a small
  uniformity cost paid for one entity instead of two-plus-a-sentinel.
- The local `Container` has no `placement` field; the realm a container's rows
  live in is decided by the active provider ([ADR-0044](0044-storage-engine-provider-swap.md)),
  not stored per-row. (The server table has a vestigial `placement` column from an
  earlier design; it is not read.)
