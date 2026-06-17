# ADR-0048: Tools are constructed with a config getter; the LLM client is derived from it

Status: Accepted
Date: 2026-06-17
Amends [ADR-0033](0033-tools-registry-folder-by-permission.md) (a tool was constructed with just the LLM client). Enables [ADR-0047](0047-first-party-in-tree-plugins.md) (plugin tools read their config slice).

## Context

A tool was constructed with one dependency: the LLM client (`new Ctor(llm)`,
[ADR-0033](0033-tools-registry-folder-by-permission.md)). Plugin tools need to read config —
`config.plugins.<slug>` (e.g. MySQL connection definitions) — and more generally **config is the
dependency common to every tool**, while the model client is not: many tools never call a model.

Two facts make the clean shape obvious:
- **The client is derivable from config.** `createClient` returns a stateless `{ call, resolve }` closure
  over a resolver that reads `config.llm` ([ADR-0028](0028-llm-client-service-calls.md)); it holds no
  cross-call state, so it can be built on demand rather than injected and shared.
- **`config.llm` is data, the client is behaviour.** `config.llm` is the model-settings data; the client
  is the object that calls models, *built from* that data. They are not the same thing — but the client
  needs nothing beyond config.

So injecting both a client and config is redundant: the client is just `config.llm` made callable.

## Decision

Construct every tool with a single dependency — **a getter onto the live config**:

```ts
abstract class BaseTool {
  constructor(protected readonly config: () => Config) {}   // { app, llm, plugins }
  protected get llm(): LLMClient { /* createClient over config().llm — derived on use */ }
}
type ToolCtor = new (config: () => Config) => BaseTool;
```

- **`config` is a getter, not a snapshot** — config is reactive; tools read the current value per call.
  On the Electron main process the getter points at the config re-seeded from each call's wire
  (`WireConfig`), so main-side tools see live config too.
- **`this.llm` is derived from `config.llm`** via `createClient`, on access. It's a stateless wrapper, so
  building it per use is cheap and always current — and a tool that never calls a model never builds one.
  Existing tools keep using `this.llm` unchanged.
- **No client crosses the wire and none is shared into the registry.** `Config` is plain serializable
  data (it *is* `WireConfig`); the live client object stays in-process, derived where used. The
  session engine keeps its own `ctx.llm`; tools derive their own — both are functions of the same config.

## Consequences

- One dependency, common to all tools: config. `llm` and `plugins` are slices derived/read on use, not
  separate constructor args — and there's no client built for the many tools that never call a model.
- `Config` stays plain data, so it crosses IPC as `WireConfig` unchanged; the non-serializable client is
  never on it.
- Contained change: `BaseTool`, `ToolRegistry`, and the three construction sites (which now pass a config
  getter, not a client). The Electron main tool host no longer builds a client at all.
- A tool can reach far more app state than before (all of config); the discipline — tools stay thin,
  hold no state, don't persist ([ADR-0047](0047-first-party-in-tree-plugins.md)) — keeps that in check.
