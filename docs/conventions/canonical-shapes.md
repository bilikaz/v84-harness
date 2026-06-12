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

## Example

Before: `resolve()` returns `FlatA | NestedB`; consumers sniff shape and fake
one shape out of the other. After: every source returns `CanonicalShape`;
the consumer is one lookup with zero branches — and the "unsupported"
special-cases collapse into ordinary absent-capability errors.
