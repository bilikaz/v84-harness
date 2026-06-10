# ADR-0005: Typed, domain-scoped event bus with declaration merging

Status: accepted
Date: 2026-06-10 (documented retroactively)

## Context

The sessions engine must drive the store, transcript, naming, and compaction
without hard-wiring them together. Direct callbacks would couple the driver to
every consumer; an untyped emitter would lose payload safety.

## Decision

`lib/bus.ts` implements a synchronous, typed pub/sub bus:

- Domains declare events by **declaration-merging** interfaces into `BusEvents`
  (see `core/sessions/events.ts`), so event names and payloads are type-checked
  at both emit and subscribe sites.
- Event names are `<domain>:<topic>[:<subtopic>]` (`session:turn:start`,
  `session:tool:calls`). Domains take a scoped view via `scope("session")`.
- Handlers run synchronously in registration order. Long-running reactions
  (naming, compaction) fire `void someAsyncFn()` and run in the background.
- Every module that subscribes registers `import.meta.hot.dispose` cleanup so HMR
  doesn't stack duplicate handlers.

## Consequences

- The driver emits domain facts; listeners/services decide what they mean. New
  reactions (telemetry, sounds, sync) plug in without touching the driver.
- Synchronous dispatch keeps ordering deterministic (store updates before the
  next stream chunk) but means a slow handler blocks the stream loop — handlers
  must stay cheap and push real work to background promises.
- Declaration merging means event contracts live next to the emitting domain,
  not in one central file.
