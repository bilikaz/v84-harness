# ADR-0076: Image editing service + workspace-addressable generated images

Status: Accepted
Date: 2026-07-08
Present-tense map: [architecture/tools.md](../architecture/tools.md),
[architecture/llm.md](../architecture/llm.md). Complemented by the chat-side reference scheme
([ADR-0077](0077-media-reference-aliases.md)).

## Context

Generation was one-shot: `ImageGenerate` returned an image riding the tool message, and nothing could
address it afterwards — "edit the image you just made" was impossible. The serving side (a FLUX.2
container speaking the OpenAI-images dialect) supports prompt-driven single- and multi-reference
editing via `/images/edits`, unexercised by the harness. Two gaps: no edit call path, and no handle a
follow-up call could use to name a prior image.

## Decision

1. **`imageEdit` is its own model service** in `MEDIA_SERVICES` — its own Use-cases row, model
   binding, and runner pool, independent of `imageGen`. Models opt in via a capability flag; the
   service is offered only on the OpenAI-images dialect (the one with `/images/edits`).
   *Alternative rejected:* reusing the `imageGen` slot — generation and edit models can differ, and
   the pool/priority knobs need to differ too.
2. **`ImageCompose` is the edit tool** (general tier): prompt + one or more reference images → the
   `imageEdit` slot. Editing is the single-reference case; several references compose/keep a subject
   consistent. References are `img-N` aliases ([ADR-0077](0077-media-reference-aliases.md)) or
   workspace paths, mixable.
3. **Generated/edited images become workspace assets when a workspace exists**: saved under a
   model-provided `name` into the container-configurable `imageOutputDir` (default
   `generated-images/`). The name is validated and **collision-checked BEFORE the generation is
   spent** (two-phase `PreparedSave`); a clash refuses with rename-or-`overwrite` guidance — naming
   stays intentional, assets are never silently clobbered. *Alternatives rejected:* auto-names
   (self-describing assets beat `generated-171234.png`), silent rename-on-clash (breaks the model's
   assumed path).
4. **Non-model call context rides the `ToolCallRequest`**: `imageOutputDir` (and later `mediaRefs`,
   ADR-0077) are engine-filled fields beside `cwd`, threaded by `registry.run` into a `ToolRunCtx`
   param — tools stay config-only constructibles ([ADR-0048](0048-tool-ctx-config-carrier.md)).
5. **Multi-reference wire format: repeated `image` multipart fields.** Confirmed live: the FLUX
   container (FastAPI, `image: List[UploadFile]`) 422s on the `image[]` spelling the OpenAI SDKs
   emit. The harness client sends the one conservative spelling; the SERVER side is the liberal end,
   accepting both `image` and `image[]` (patched in the container repo). Liberal server /
   conservative client keeps every standard client working.

## Consequences

- Iterative image work is possible by path in workspace sessions (generate → edit → re-edit), and —
  with ADR-0077 — by alias anywhere.
- A new media service costs one `MEDIA_SERVICES` entry + an i18n label; the Use-cases UI and runner
  pools derive from the list.
- The web bundle stays node-free: the fs save/read helpers load via dynamic import behind cwd guards,
  and renderer builds mark `node:` builtins rollup-external (chunks exist, never load in a browser).
- Masking/inpainting stays out: FLUX.2 inpaints only via a human-authored mask and there is no
  mask-drawing UI; the `/images/edits` `mask` field is additive later.
