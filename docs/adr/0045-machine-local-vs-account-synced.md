# ADR-0045: Machine-local vs account-synced state

Status: Accepted
Date: 2026-06-16
Refines: [ADR-0037](0037-reactive-consumer-over-injected-storage.md) (the `Consumer` base — adds a `synced` flag), [ADR-0039](0039-account-local-store-and-connection-lifecycle.md) (account stays local — now one of several machine-local stores), [ADR-0042](0042-unified-settings-registry.md) (the settings registry — now an account-synced store). Builds on [ADR-0044](0044-storage-engine-provider-swap.md) (the two lanes it routes to).

## Context

ADR-0044 gives the engine two lanes — `repos()` (active, follows the connection)
and `localRepos()` (always local). Every store has to pick one, and the choice is
not obvious: some state is the *account's* and should follow the user to any
device; some is *this machine's* and must not. Get it wrong and either the data
strands offline or it blanks on connect. This ADR records the split and the
mechanism, so new stores have a rule instead of a guess.

## Decision

State is classified as **account-synced** (follows the connection) or
**machine-local** (pinned to the device), and routed accordingly.

**Mechanism.** `Consumer` ([ADR-0037](0037-reactive-consumer-over-injected-storage.md))
gains a `synced` flag (4th ctor arg, default `false`):

```ts
private repos() {
  return this.synced ? this.ctx.storage?.repos() : this.ctx.storage?.localRepos();
}
```

`hydrate`/`persist` use that lane; the settings row is written with `scope`
`"account"` when synced, `"local"` otherwise. Entity stores (not Consumers) make
the same choice directly: `agents` reads `repos().agents`, `ui`/`browser` stay on
`localRepos()`.

**The classification:**

| State | Store kind | Lane |
| --- | --- | --- |
| providers / models / API keys (`settings`) | Consumer `synced` | account |
| `agents` | entity store on `repos()` | account |
| app tunables (`config`) | Consumer `synced` | account |
| containers / sessions / messages / media | entity stores on `repos()` | account |
| UI panel state (`ui`) | Consumer (local) | machine |
| browser fleet (`browser`) | transient Consumer (`key=null`) | machine (nothing persisted) |
| language (`lang`), llm-debug (`debug`) | `localStorage`, read at module load | machine |
| `account` (tokens, connection mode) | `localStorage`, pre-backend | machine |

- **Synced** state is the account's: it follows you to any logged-in device.
  Settings is synced deliberately even though it carries API keys — connecting an
  account ships its credentials to the server (trusted backend; a conscious
  trade, not an oversight).
- **Machine-local** state is the device's. `ui`/`browser` are obviously per-machine.
  `lang` and `debug` stay on `localStorage` specifically because they're read
  **synchronously at module load**, before `ctx.storage` exists (i18next needs a
  language string at import time; the debug flag gates a logger) — they cannot be
  async-backed without a boot-time flash, so they are not synced. `account` is
  local because it's read before the backend is even chosen and must survive logout.
- **First connect is a swap, not a merge** ([ADR-0044](0044-storage-engine-provider-swap.md)):
  a fresh account shows empty content and defaults for synced settings/agents;
  local state is untouched and does not upload. Nothing migrates between realms.

**Store taxonomy** (two kinds, one reactivity primitive `createListeners`):

- **Consumer** — a single state object serialized to ONE `settings`-table row
  (`settings`, `config`, `ui`). Good for small singletons.
- **Entity store** — many rows in a dedicated table via `repos()` (`containers`,
  `sessions`, `agents`). `sessions` is deliberately NOT a Consumer: it's per-row,
  lazy-loaded, spans three tables, and has provider-aware delete — a single-blob
  Consumer would re-introduce the index-blob data-loss bug ([ADR-0043](0043-per-entity-repos.md)).

## Consequences

- A new store has a rule: **account's → synced (`repos()`); device's → local
  (`localRepos()`/`localStorage`).** The lane is the decision, not an afterthought.
- Settings/agents/config follow the user across devices; connecting on a second
  machine reconfigures nothing for content but does reconfigure providers only if
  the account hasn't synced them yet.
- A `Consumer` can't be remote-backed for *part* of its value — it's whole-row,
  one lane. State that needs finer placement uses repos directly, not a Consumer.
- The machine/account boundary is now explicit and testable; the previous "all
  consumers follow the connection" (ADR-0038) is retired.
