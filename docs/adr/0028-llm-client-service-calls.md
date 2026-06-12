# ADR-0028: One llm client — service-named calls over an injected ConfigSource

Status: accepted
Date: 2026-06-12

## Context

Model interactions were scattered: the driver, naming, compaction, the
upsampler, and four media tools each resolved their own config (settings
store, `ctx.media` threading, cloned `ModelConfig`s for per-call tuning) and
chose their own wire path. Callers knew where configs live and how the LLM
acts; the entry (`ask()`) took a resolved target, so every caller carried
resolution logic. The structure was judged unmaintainable ("no standard — all
parts had their own structure").

## Decision

Everything that talks to a model goes through **one client with one method**:

```ts
client.call({ service, messages, system?, tools?, params?, signal?, handler?, maxHeals? })
```

- **Callers name a service**, never hold a config: `main` (the chat provider)
  or a media slot (`imageGen` … `audioRec`). `SERVICE_MODALITY` maps services
  to modalities — recognition is a text interaction over a vision model.
- **`createClient(config: ConfigSource)`** is the only seam to configuration.
  Config homes implement `resolve(service): CallTarget | null`:
  the renderer's store-backed singleton (`core/client.ts`); a client minted in
  the Electron main process from the plain-JSON `ToolConfig` snapshot the
  renderer resolves at turn start and ships over the bridge
  (`core/tools/client.ts`; `ToolCtx.client` is process-local like `signal`);
  test fixtures inline.
- **One per-call knob bag** (`params`): the chat subset (`maxTokens`,
  `reasoningEffort`, `thinkingBudget`) is overlaid on the resolved model's
  configured values at load (naming/compaction tune without holding configs);
  the media subset feeds generation wires. Each provider reads the fields its
  wire knows.
- **The heal cycle lives in the client**: a `ResponseHandler` throws
  `HealError(correction, raw?)`; the cycle appends the bad answer + correction
  to its live messages copy and re-runs the provider until valid or the budget
  is spent (per-call → config `llm.maxHealAttempts` → 3). Everything else
  propagates as-is.
- **Tool calls are not special to this layer**: the driver's handler returns
  them in its result; advertising, capability gating, approvals, execution,
  and media feedback all stay in the session driver.
- The `Client` interface is `call` only. Config questions ("is the slot
  assigned?") are asked config-side (stores / `ctx.config`), not through the
  client.

## Consequences

- Callers shrank to domain logic: tools say
  `ctx.client.call({service: "imageGen", params})`; the driver's send path
  lost its `cfg` parameter (UI sends text, period).
- The driver keeps its own heal (corrections as SESSION turns via the bus)
  because the bad text already streamed to the UI/store; the client's heal is
  for ephemeral calls. Two heals by design.
- Renaming or adding a service touches the `ModelService` union and the
  assignment stores; the localStorage assignment keys make slot renames a
  migration.
- Supersedes the never-accepted `ask()` draft design (wire/handler inversion,
  caller-resolved targets).
