# ADR-0077: Media reference aliases (`img-N`/`vid-N`)

Status: Accepted
Date: 2026-07-08
Present-tense map: [architecture/sessions.md](../architecture/sessions.md),
[architecture/tools.md](../architecture/tools.md), [architecture/storage.md](../architecture/storage.md).
Builds on the media externalization ids ([ADR-0043](0043-per-entity-repos.md)) and the image tools
([ADR-0076](0076-image-edit-service-and-referenceable-images.md)).

## Context

ADR-0076 made generated images addressable **by workspace path** — useless in plain chat, on the web
host, and for the core cooperation loop: the user pastes a screenshot, the model composes from it,
the result feeds the next iteration. Pasted and generated conversation media had no handle a tool
call could name. Media DO have durable ULID ids (the externalized blob rows), but a 26-char random
id is a hostile model handle — one hallucinated character fails silently.

## Decision

**Every image/video landing in a session gets a short per-session alias — `img-N`/`vid-N` — and the
alias is the model- and user-facing handle for conversation media.**

- **Stamped at landing, never renumbered**: a `ref` field on `Image`/`Video`, first-appearance order,
  counter in `session.meta.mediaSeq` (rides the runtime bag, ADR-0074 — no schema change; the message
  row persists `ref` inline, so storage is untouched). *Alternative rejected:* deriving numbers from
  transcript position — compaction/edits would renumber and break references already held.
  *Alternative rejected:* the raw ULID as the handle — length invites silent one-char misses; `img-3`
  is copyable by the model AND typable by the user (thumbnails show it as a badge).
- **The model learns aliases in-band**: `toChatMessages` annotates each media-carrying message
  ("attached media: img-1 … — conversation attachments, not workspace files; reference by alias");
  the resend-window stub and the capability-hidden note name aliases too, so media outside the send
  window — or invisible to a text-only chat model — stays referenceable. Tool results get the alias
  appended to their output text by the engine (the tool runs in the platform and can't know
  renderer-side refs).
- **The engine pre-resolves, tools consume**: at dispatch the engine scans the call args for alias
  tokens, resolves them against the in-memory transcript, and ships
  `ToolCallRequest.mediaRefs: Record<alias, {url, mime?, name?}>` into `ToolRunCtx`. Tools cross the
  bridge as pure data and never reach the transcript. A `references` entry exact-matching the alias
  pattern is always an alias; anything else is a path. *Alternative rejected:* tool-side resolution —
  a live store handle can't cross IPC, and a main-side lookup would couple tools to storage.
- **Aliases are session-scoped**: media delivered from a child session gets the parent's next number
  at landing; nothing travels by alias across sessions. Cross-session referencing is out (deferred).
- **The composer gate flips reject → attach-with-note** when the chat model lacks image input but an
  image model is configured: the attachment rides the message and even a blind chat model can
  orchestrate compose calls through the alias annotations.

## Consequences

- The paste-a-screenshot → compose → iterate cycle works with no workspace, no files, and no model
  ever seeing a filesystem path; it keeps working after media leaves the resend window.
- One prompt-shaped hazard is owned deliberately: display names that look like filenames tempt the
  model into inventing paths — the annotations and the compose tool's refusal text both steer back
  to the alias (live-tested failure, fixed by wording).
- An alias mentioned in free text resolves harmlessly into `mediaRefs` (extra IPC bytes, never
  wrong); unknown aliases are simply absent and the tool refuses with guidance.
- Compaction must not GC media or the aliases die — resolved by [ADR-0078](0078-compaction-as-send-boundary.md).
