# ADR-0015: Prompt assets — English-only `pt()` catalog, separate from i18n

Status: accepted
Date: 2026-06-10

## Context

The app has two kinds of strings: UI text (translated, ADR-0009) and
**model-facing prompts** (system messages, instruction turns, upsampler
schemas). Review flagged that the prompt pattern was tribal knowledge, and that
it was applied unevenly (naming uses the catalog; compaction and the media
upsamplers carry their prompts in-file).

## Decision

- Prompts are **English-only, by policy**: agents operate in English regardless
  of the UI language — translated prompts cost more tokens and degrade output
  quality. The active UI language is injected as a `{{language}}` variable so a
  prompt can *instruct* the model to answer in the user's language; the
  instructions themselves stay English.
- Prompts live **outside the i18n namespace** — never in `locales/*.json`,
  never counted in locale parity. `lib/prompts.ts` is the shared catalog,
  accessed via `pt("<segment>.<role>", vars)` (`role` = system/user placement).
- **Placement follows types-placement logic**: a prompt used by more than one
  consumer (or assembled with shared variables) belongs in the catalog; a
  prompt owned by exactly one module (compaction's summary instruction, the
  media upsamplers' schema prompts) **stays colocated with its consumer** —
  that is the rule working, not drift.
- If a prompt's consumer migrates to a host where `lib/` is unavailable, the
  prompt moves with it (prompts are data; they carry no i18n dependency beyond
  the injected language name).

## Consequences

- "Where do I put a prompt" has a mechanical answer; the naming/compaction
  asymmetry is now documented as intended.
- All model-facing text is greppable: `pt(` plus the colocated `*_SYSTEM` /
  `*_INSTRUCTION` constants.
- Translators never see prompts; locale parity checks stay purely about UI.
