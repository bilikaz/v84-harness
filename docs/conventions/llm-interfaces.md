# Model-facing interfaces

Rules for the surfaces a language model consumes: tool schemas, tool outputs,
and the resubmitted conversation. The consumer is a probabilistic text-copier —
design for what models actually do (echo what they see, miss subtleties, emit
one tool call where you hoped for five), not for what a careful programmer
would do.

## 1. Schemas are stable; catalogs are data

Advertised tool schemas should be byte-identical across turns and sessions.
Provider prompt caches key on the tools block; a schema that embeds live data
(a list of available items, counts, names) invalidates the cache on every
mutation and shifts the contract under an in-flight conversation. Expose the
changing part through a *list tool whose result is the catalog* — data flows
through results, never through schemas.

```text
BAD:  RunAgent schema description embeds the agent list (changes when edited)
GOOD: ListAgents returns the catalog; RunAgent's schema never changes
```

## 2. Batch parameters, not parallel calls

When N operations should run concurrently, accept an array in ONE call rather
than relying on the model to emit N tool calls in one response — most models
won't, and the plan degrades to a slow sequential loop. Process the batch
per-item (one bad entry reports inline; the rest proceed — see
error-handling.md's per-item catch rule). Accept the obvious degenerate shapes
leniently (a flat single item where the array was documented).

## 3. Names are addresses: decorate nothing, normalize everything

If the model selects items by name, the listing must make the name's exact
boundaries unmistakable — quote it, and never glue markers or annotations onto
it (`name [tag]` WILL be echoed back as the name, observed in practice). On
input, normalize before matching: trim, strip surrounding quotes and trailing
bracketed decoration, compare case-insensitively. Reject ambiguity instead of
picking, and make every miss self-healing: the error carries the valid names,
so a blind guess costs the model the same one step as listing first.

When the system mints the handle (not a human-chosen name), make it **short and
model-holdable** — a small per-scope counter (`1`, `2`, …), not an opaque UUID.
A model fumbles a long random id, and a fumble it can't recover often cascades:
"no such window" → it opens a *new* one → repeat → resource sprawl. Short ids it
can actually echo, scoped so they don't collide where the model sees them, plus
the self-healing miss above, close that loop. Keep the opaque id internally;
expose the short one. (Observed: random-UUID browser-window ids drove a model to
spawn duplicate windows until per-session integer ids replaced them; the same
short-alias scheme then addresses long-lived sub-agent runs, and conversation
media — `img-3` as the handle for a pasted/generated image, its storage ULID
kept internal.) When the aliased thing also has a filename-ish display name,
say explicitly that the ALIAS is the handle — a model shown "pasted.png" will
invent a plausible file path for it (observed) unless told the name is display
only.

Self-healing extends past misses to **failures**: when an operation fails, the
result should name the **recovery action**, not just the error — and warn off the
wrong one. A model handed "X failed: <message>" guesses what to do next; a model
handed "X failed — do Y to continue (don't do Z, it will re-fail)" acts. Make the
result the affordance: print the exact next call, and when a failure is *not*
recoverable the obvious way, say so explicitly. (Observed: a sub-agent that lost
its connection should be told to resume it; one that ran out of context must be
told NOT to resume — continuing re-sends the same oversized prompt and re-fails.)

## 4. Announce every edit to the model's context

Whatever the engine quietly removes or withholds from the resubmitted
conversation must be announced *in place*: a stub naming what was there and how
to get it back ("removed to save space: photo.png — load again if needed"),
a truncation marker with the dropped size, a summary labeled as a summary.
A model that doesn't know something vanished reasons as if it were still
there; silent edits manufacture hallucinations.

## 5. State capabilities; never assume the model knows its environment

Anything non-obvious about the execution environment — a virtual filesystem
root, a sandbox boundary, which tool is the exception to a rule — goes into the
system message when (and only when) the capability is actually present. The
model's training set did not include your environment's conventions.

## 6. Bound resubmitted payloads on every axis that can kill the request

Conversations are resubmitted wholesale, so anything heavy that enters the
transcript rides every later request. Bound it twice: by count (token/prefill
cost) and by bytes (transport/proxy limits), newest-first — and always deliver
the newest item regardless, because being blind to what it was just given is
the worst failure a model can have. Align per-item caps at the door with the
window: what could never be resent shouldn't enter the transcript at all.

## 7. Context pressure shrinks the projection, never the source

The stored conversation and what a given request sends are two different
things: the transcript is the source of truth, the request is a send-time
PROJECTION of it. All context-pressure mechanisms — media windows, truncation,
summarization/compaction — belong in the projection. Destructively rewriting
the source to save context loses the user's own history, and silently breaks
every handle into it (aliases, ids, "as discussed above"). A summary is a
message that changes what the projection includes from that point back — not a
replacement for what came before. (Observed: replace-with-summary compaction
destroyed transcripts and killed every media alias behind it; recast as an
appended boundary, the same budget win cost nothing.) Pair with rule 4: the
projection's edits are announced in place.

## 8. Never reflect a model's failed output back — retry clean

When a reply fails its contract — unparseable JSON, a malformed tool call — do
not echo the broken output back in the correction. The model has no memory of
its failed attempt, so re-sending the garbage only anchors it; worse, broken
content in the resubmitted transcript can make the provider's chat renderer
**400 the whole request** (some renderers `json.loads` message content),
leaving the model unable to recover at all. Drop the bad turn from history and
retry (a bare continue); only when the output is *structurally valid but
incomplete* (parses, missing a field) send a targeted, content-free correction
("missing field X"). Extract what's usable (the JSON out of prose) and forward
that — a reply that never satisfies its contract contributes nothing, never its
error text.
