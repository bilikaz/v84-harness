# ADR-0019: Reference-stable messages + memoized transcript leaves

Status: accepted
Date: 2026-06-10

## Context

Every store notify re-rendered the whole transcript: each streamed token,
tool-result append, and composer keystroke re-ran `ReactMarkdown` (remark-gfm
parse) over every message. Cost per token grew with transcript length — INP
measured 1.2s+, the window visibly lagging "once several messages combine".
The store's immutable-update style already kept untouched message objects
reference-identical across mutations (streaming swaps only the last message;
appends copy only the array container), but nothing in the UI exploited that.

## Decision

**Make reference stability a load-bearing contract between the sessions store
and the transcript UI.**

- The store guarantees: a mutation never clones message objects it doesn't
  touch. (Already true; now relied upon — don't "defensively" deep-copy.)
- The transcript leaves bail by reference: `Message`, `Markdown`, `Thinking`,
  `ToolCard` are wrapped in `memo(function Name(){})`. A streamed token
  re-renders exactly one message; a tool result re-renders the card it answers.
- `Message` uses a custom comparator (`sameMessage`): everything compares by
  reference except the tool-result maps — those are rebuilt by the parent every
  render (fresh identity), so they're compared by the entries this message's
  call ids actually read. The map *values* come from settled tool messages and
  are reference-stable.
- The parent memoizes the tool maps on `session.messages` so local state
  (composer input, menus) doesn't rebuild them.

Alternatives considered: **list virtualization** (windowing) — heavier, solves
huge-transcript DOM size but not the per-token re-parse of visible items;
stays open as a future addition for very long sessions. **Extracting the
composer** into its own component — helps keystrokes only, not streaming;
unnecessary once leaves bail by reference.

## Consequences

- Store mutations must preserve untouched-object identity or the memo layer
  silently degrades to full re-renders — review store changes with that lens.
- `sameMessage` is by-hand: adding a prop to `Message` requires extending the
  comparator, or the new prop is ignored by re-render checks (a stale-UI bug,
  not a perf bug). The comment on the comparator says so.
- The `memo(function Name(){})` const-export shape is the sanctioned deviation
  from the "named function declarations" rule (conventions/react.md rule 9).
