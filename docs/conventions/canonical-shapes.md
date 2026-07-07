# Canonical shapes: one concept, one shape, end to end

**Rule in one line:** a domain concept gets ONE canonical shape that every
layer speaks — stores persist it, boundaries pass it through — and a union of
look-alike shapes discriminated by sniffing (`"field" in obj`) is the smell
that says the canonical shape is missing.

## Why

When the same concept exists in two shapes (a flat settings record here, a
nested registry record there), every boundary grows a translator, and the
translators grow guards (`"provider" in target ? … : …`), and the guards grow
fake-object shims to satisfy the other side's type. None of that code does
domain work — it exists only because the shapes disagree. Worse, the
translators don't die when one caller is fixed; they migrate to the next
boundary. The fix is never a better translator; it's making the shapes agree.

## How to apply

1. **Model the shape after how the data is entered/owned**, not after what one
   consumer finds convenient. If users configure "a provider hosting models",
   the shape is `{provider: {...}, model: {...}}` — and a per-call override
   bag can then overlay one half without being able to touch the other.
2. **Unify the discriminant axes.** Two fields meaning "which kind" on two
   shapes (`provider: "openai"` vs `api: "openai"`) become one field with one
   union on the one shape.
3. **Push the shape into the stores.** A canonical shape only at runtime still
   needs seam translations from every store; a canonical shape IN the stores
   makes boundaries pass-throughs. Layer-specific extras extend the canonical
   shape (`interface Settings extends CanonicalShape { uiExtras… }`) — they
   ride along harmlessly.
4. **Derive, don't store, presentation** (display labels etc.) — stored
   derived fields are where shapes start diverging again.
5. **When converging stored shapes, decide migration explicitly.** Carrying
   old-shape readers forever is the translation layer sneaking back in;
   resetting (with the owner's sign-off) is often cheaper than migrating
   low-value local state. Either way the decision is recorded, not implied.
   The mechanism for the reset path is a **data-version stamp**: store a
   version with the data and, on load, wipe + re-seed when the stamp is older
   than the code's — so a breaking shape change is a one-line version bump, not
   scattered back-compat readers. An unstamped store is grandfathered when the
   change is forward-compatible (unknown fields drop, missing ones default).
6. **Pick one canonical source; mind lossy backends and guard the round-trip.**
   When one canonical shape spans interchangeable backends, name a single source
   of truth and make every backend mirror it — backends adopt the canonical
   shape, never the reverse. Backends are *not* equally shape-faithful: a
   whole-object/blob store (a JSON column, an IndexedDB object store) is lossless
   by construction — a new field rides along automatically — while a
   typed-column store (a SQL schema with an explicit DTO mapping) silently
   **drops** any field it has no column for. So a field added to the canonical
   shape persists fine through the blob backend and vanishes through the typed
   one, invisible until it changes behaviour. Add a round-trip / compile-time
   **parity check** on the lossy backend so the next added field fails a check
   instead of disappearing only when that backend is active. The trap that bit
   us: `graphId` / agent `tools` / message `files` persisted locally (blobs) and
   were silently lost on the remote (typed columns) — see
   [ADR-0071](../adr/0071-remote-mirrors-harness-shapes.md).
7. **Group churning, never-queried fields into one bag — guarded as one field.**
   When a cohesive set of fields is pure round-trip state (written every cycle,
   never filtered or indexed), give them ONE sub-object on the canonical shape and
   let the typed backend store it as a single opaque JSON value, not a column each.
   It's still one shape end to end — both sides carry the same bag — so the parity
   check (rule 6) guards the bag as a single field; its contents stay unguarded, so
   a new flag in the bag needs no schema change. Reserve this for runtime state:
   identity/queryable fields still earn their own columns. The opposite split — an
   *identity* field buried in the bag — loses the index you'll want. Example: a
   session's per-turn `usedTokens`/`lastModel`/`errorKind`/… ride in one `meta`
   object ([ADR-0074](../adr/0074-session-identity-vs-runtime.md)), while
   `containerId`/`parentId` stay columns.

## Example

Before: `resolve()` returns `FlatA | NestedB`; consumers sniff shape and fake
one shape out of the other. After: every source returns `CanonicalShape`;
the consumer is one lookup with zero branches — and the "unsupported"
special-cases collapse into ordinary absent-capability errors.
