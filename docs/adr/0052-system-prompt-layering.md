# ADR-0052: System-prompt layering — overridable base + appended capability blocks

Status: Accepted
Date: 2026-06-17
Builds on [ADR-0015](0015-prompt-assets.md) (the `pt()` catalog), [ADR-0031](0031-config-sole-source-of-truth.md) (config ownership), [ADR-0046](0046-typed-containers.md) (containers), and [ADR-0047](0047-first-party-in-tree-plugins.md) (plugins).

## Context

The base system prompt was **baked into each session at creation** (`makeSession` set
`system: pt("defaultChat.system")`). Consequences: `session.system` always won, so a workspace's
`container.config.instructions` was **dead code** (never reached); there was no user-global prompt; and a
later change to any base couldn't take effect on existing sessions. Capability guidance (workspace fs,
memory) was appended ad-hoc in the turn loop, and a plugin had no way to teach the model its own tools.

## Decision

The assembled system prompt is **BASE + capability blocks**, resolved **live each turn**.

- **BASE** (overridable, first match wins): `session.system` (an agent's baked prompt) → the session's
  **container/workspace message** (`container.config.instructions`) → the **global** prompt
  (`config.app.systemPrompt`) → the built-in `defaultChat`. `makeSession` no longer bakes a default (it
  leaves `system` empty for plain chats; agents still carry their own), so the chain resolves live. The
  engine reads the session's **own** container (not the fs-masked `ws`), so a workspace message applies
  even when its file tools are masked.
- **Capability blocks** (always appended when the capability is live, to enforce correct tool usage):
  `workspace.system` (fs tools advertised), `browser.system` (browser tools live), `memory.system` (account
  connected), and **each enabled plugin's `manifest.systemPrompt`** (`enabledPluginPrompts()`). A plugin's
  guidance is in the prompt only while it is enabled — the same shape as the built-in blocks.
- **Variable substitution** (`{{language}}` and friends) now applies to the resolved BASE too (`fill()`),
  not only built-in `pt()` lookups — so user/workspace/agent prompts can target the user's language.
- **Editing surfaces.** Global → Settings → "System message" (`config.app.systemPrompt`, the first UI onto
  `config.app`). Per-workspace → the container modal's **Other** tab. Per-plugin → `manifest.systemPrompt`.

Why live over baked: a global/workspace setting must take effect, and baking dead-lettered
`container.instructions`. Why capability blocks always append: they enforce correct tool usage regardless
of the user's base message ("if a workspace has its own message we still append browser/memory guidance").
Why plugin guidance in the manifest: co-located with the plugin and gated on `enabled`, mirroring the
built-in capability blocks.

## Consequences

- One predictable assembly: a reader knows the base is `agent → workspace → global → default`, and that
  tool guidance always rides on top.
- `config.app` gains `systemPrompt` and its first editor; the full ConfigApp tunables editor was
  **deliberately not built** (overkill — only the prompt earned a UI).
- `PluginManifest` gains an optional `systemPrompt`; the MySQL plugin ships the worked example (teaches
  `MysqlConnections` first, `MysqlQuery` with `LIMIT`, the read/write-share-one-tool safety boundary).
- Existing sessions keep their already-baked `system` (harmless); only new plain chats resolve live.
- `defaultChat` ([ADR-0015](0015-prompt-assets.md)) is now strictly a fallback, no longer pre-baked into
  every session.
