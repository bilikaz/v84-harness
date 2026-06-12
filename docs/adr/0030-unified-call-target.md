# ADR-0030: One model-data format — CallTarget {provider, model} held end to end

Status: accepted
Date: 2026-06-12

## Context

Model data existed in two shapes with two dialect fields: the settings card's
flat `ModelConfig` (`provider: "openai"` meaning wire kind) and the media
registry's flattened `MediaModelConfig` (`api: "openai" | "generate"`).
Every boundary translated (`toModelConfig` faked chat configs out of media
targets via `"provider" in target` shape-sniffing; seams re-merged fields),
and the word "provider" meant three things. The hacks kept moving instead of
dying.

## Decision

One shape, mirroring how the data is **entered** (a provider hosting models):

```ts
CallTarget {
  provider: { name, type: ProviderType, baseUrl, apiKey? }  // the configured block
  model:    { id?, maxTokens?, reasoningEffort?, thinkingBudget?, contextLength? }
}
ProviderType = "openai" | "anthropic" | "gemini" | "generate"   // ONE axis
```

and the **stores hold it** — translation layers don't exist:

- Settings: `MainSettings extends CallTarget` (+ app extras: `input`,
  `imageMaxDim`, `contextReserve`, picker caches). Writers are explicit about
  the half they touch (`saveProviderBlock` / `saveModelBlock`).
- Media registry resolution: `resolveMediaProvider()` returns
  `MediaSlotConfig extends CallTarget`, tool-side settings (`promptStyle`,
  size caps) riding on the model half.
- The `ToolConfig` IPC snapshot carries these targets as-is; the main-process
  client's resolve is a pass-through pick.
- "Dialect" as a concept is dead: `provider.type` is the provider's type, the
  single routing key (ADR-0029). Display labels derive (`targetLabel`), never
  stored.
- The flat `ModelConfig` type is deleted. Old persisted flat stores are
  **discarded on load, not migrated** — reconfiguring beats carrying
  translation code forever (explicitly accepted).

## Consequences

- The same object flows unbroken: Settings UI edit → store → `resolve(service)`
  → factory → provider reads `target.provider.baseUrl` / `target.model.id`.
- Per-call tuning overlays the model half only — connection fields are
  unreachable by construction.
- UI consumers read nested paths (`cfg.model.contextLength`); context-math
  helpers (`contextLimit`, `isFull`) take `MainSettings`.
- The media registry's stored rows (`MediaProvider`/`MediaModel`) were already
  this shape; only its resolution output changed.
- Existing user settings reset once (accepted data loss; the media registry
  store was already nested and kept its migrations).
