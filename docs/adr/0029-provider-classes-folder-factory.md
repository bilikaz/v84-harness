# ADR-0029: Provider classes resolved by a folder-layout factory; handlers are response-side only

Status: accepted
Date: 2026-06-12

## Context

After ADR-0028 fixed the entry, the inside still had two structures: chat
routed through a `streamModel` switch while media routed through handler-side
tables, and the "handler" drove requests over a capability wire (the video
handler owned a poll loop; the image handler picked endpoints). Routing was a
matrix solved across four files, and the handler name lied about what
handlers did.

## Decision

- **Every provider is a class** with one contract
  (`BaseProvider`): `constructor(target: CallTarget, ctx: CallContext)` —
  config and the call's context wired into the instance — one
  `call(handler)`, and a `defaultHandler()` naming the shape it naturally
  produces. Subclasses never override the constructor; `init()` is the hook.
  Shared plumbing is base members, not module helpers: `request()` (auth/base
  trim/status, cancellation from the wired ctx), `prompt()` (conversation →
  single prompt), `inlineUrl()` on the image base, the retry + inline-think
  demux pipeline on the text base, the submit→poll→download time loop on the
  video base. **Providers own the request side — wire AND time.**
- **The registry IS the folder layout.** One module per provider at
  `llm/providers/<modality>/<type>.ts` (`text/openai`, `text/anthropic`,
  `text/gemini`, `image/openai`, `image/generate`, `video/openai`), each
  exporting its class as `Provider`. The client's factory (eager
  `import.meta.glob`) parses service modality + target provider type straight
  to the path; a missing file is the refusal ("there is no text/generate
  provider" — also how *cannot chat* is expressed). Adding a provider is
  dropping a file; there is no table.
- **Response handlers are response-side only** (`llm/responseHandlers/`,
  `ResponseHandler<T>`): they consume the `Interaction` a provider hands them
  — `{kind:"chat", events}` (live stream) or `{kind:"media", payload}` —
  validate, may side-effect, return the caller's shape. Validators heal by
  throwing `HealError`.
- **Catalogs ride the provider class**: `static listModels()` on text
  providers (each owns its `/models` wire); the config side reaches them via
  `listProviderModels()` through the same factory. No catalog = lists nothing,
  by absence.
- One barrel (`llm/index.ts`) exporting exactly what external consumers use;
  modality folders have no barrels; provider classes are not exported —
  nothing outside the layer talks to a provider except through `client.call()`.

## Consequences

- The dispatch matrix, `toModelConfig`/`toMediaTarget` shape-shims, and the
  per-modality factory functions are gone; resolution is one path parse.
- ADR-0006's "the switch is the registry" clause is superseded; its transport
  rules (`sseRequest`/`withRetry`/SSE parsing, cross-adapter wire rules) and
  the `StreamEvent` grammar remain in force inside the text providers.
- `import.meta.glob` ties the factory to Vite-family bundlers (renderer, main
  via electron-vite, vitest) — acceptable, the whole build already is.
- A provider file is self-contained: wire mapping + class (instance = the
  call, static = its catalog). Per-call instances make per-call state (the
  wired ctx) safe.
