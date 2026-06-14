# Naming: by role, not implementation

**Rule.** A name must answer the question a reader has at the *use site* — what role
does this thing play — not record how it happens to be implemented.

**The bells test.** If a name makes the reader ask a question it should have answered
("what's git-backed?", "is this the client or the transport?"), rename it before
merging. Both directions count: a name must not raise false expectations either
(`listen` implies subscription semantics; an awaited one-shot consumer is `receive`).

## Rules

1. **Ports are bare domain nouns** — `Provider`, `Logger`. No qualifier that names the
   technology behind them (a port named after its implementation can't absorb a second
   implementation).
2. **Shared base classes are `Base<Port>` in `base.ts`** — `BaseProvider`. The base is
   named for its role (the thing adapters extend), not for what it shares (e.g. not
   `GitBackedProvider` — implementation rationale belongs in the class comment).
3. **Adapters are `<Impl><Port>`** — `GitHubProvider`, `MockProvider`, `ConsoleLogger`.
   No extra infixes; the test double follows the same pattern as real adapters.
4. **Within a subsystem, the consumer-facing API owns the `client` name**; wire
   plumbing is `transport`, with directional verbs `send` / `receive` (the canonical
   channel pair — never HTTP verbs like `postX`, never `listen` for an awaited
   one-shot). A reader opening `client.ts` must find the thing they call.
5. **Contracts live in `types.ts`** (see [types-placement.md](types-placement.md));
   `shared.ts` is reserved for genuine cross-cutting helper collections; `index.ts` is
   only ever a folder's public face — a barrel or a registry. A barrel exists only at
   a LAYER's public face and exports the audited list of what outside consumers
   actually use — not everything the layer contains. Inner folders normally need no
   barrel (internals import each other directly); delete barrels that serve nobody.
   An `index.ts` that holds real content is content — give it a content name
   (`catalog.ts`), don't let it pose as a barrel.
6. **Error subclasses are `<X>Error`** (`LLMValidationError`), never sentence
   fragments (`<X>Failed`).
7. **One-function consumer-facing modules fold into the client module** rather than
   existing as a file whose name must be guessed.
8. **File names match their primary export** where a file has one
   (`model.ts` ↔ `resolveModel`); multi-export files are named for their role.
9. **Stateful collaborators carry a role suffix that says how you use them.** An
   `<Area>Engine` is a long-lived object you *call to do work* and that owns a
   subsystem's behaviour (`SessionEngine`); an `<Area>Registry` is a *lookup* of
   instances resolved by key; an `<Area>Store` *holds reactive state* you read. The
   suffix answers, at the use site, whether to invoke it, resolve from it, or read it —
   so don't name three different roles all `Manager`/`Service`.

## Why

Import sites become role statements: `from "../llm/client.ts"` means "I call the
LLM"; `extends BaseProvider` means "I am a provider". Implementation-flavored names
rot the moment the implementation shifts, and mislead every reader until someone
pays to rename them.
