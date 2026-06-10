# ADR-0011: Contribute UI-layer conventions to the shared set

Status: accepted
Date: 2026-06-10

## Context

ADR-0010 adopted the shared conventions set from the reviewer project. That set
grew out of a CLI, so it has nothing to say about UI concerns. This repo's two
pattern-review rounds settled rules in exactly those gaps — i18n discipline,
React component shape, and the handling of literals/ids/storage keys — but they
were recorded only in ARCHITECTURE.md's repo-specific section, which contradicts
the conventions README: portable rules belong in `conventions/`, one topic per
file.

## Decision

Three new topics are added to [docs/conventions/](../conventions/), written
project-agnostically in the set's house style:

- [i18n.md](../conventions/i18n.md) — every user-facing string through `t()`;
  key-for-key locale parity as an invariant; constants store keys, translated at
  render; markup via component interpolation.
- [react.md](../conventions/react.md) — named function components, hooks-only
  state access, stable-vs-index list keys, `on<Event>` handlers, no floating
  rejections (`void` is explicit), extract nested components.
- [constants-and-identifiers.md](../conventions/constants-and-identifiers.md) —
  behavioral literals are named (`UPPER_SNAKE`, units in the name); one id
  generator (`crypto.randomUUID()`); seeds are not ids; persisted keys are
  namespaced named constants.

These are **contributions to the shared set**, not local deviations: the files
should flow back to the reviewer repo's `docs/conventions/` (the set's origin)
and into the standards knowledgebase, so both repos keep a single rule
vocabulary. ARCHITECTURE.md's conventions section keeps only what is genuinely
instance-specific (the `v84-harness:` prefix itself, tool/provider/event naming,
the dual-target rules).

## Consequences

- The shared set now covers UI projects; the reviewer repo's copy is behind
  until these three files are synced upstream.
- Rules invented here in future rounds follow the same path: portable → a
  conventions topic file (+ this kind of ADR), instance-specific →
  ARCHITECTURE.md.
