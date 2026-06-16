# Capability gating: one predicate, enforced at advertise AND invoke

**Rule.** An affordance that is useless (or harmful) without a runtime capability
gates on a single predicate, and that predicate is checked at **both** boundaries
it can be reached through: where it's *offered* (the catalog/schema a caller picks
from) and where it's *invoked* (the executor). Advertise-only gating drifts —
a caller can bypass the catalog, or an LLM can fabricate a call for a thing it was
never shown.

## Rules

1. **One source of truth for "can this run."** Expose a single predicate
   (`canRun()`, `isSupported()`) that reads the capability off the injected
   carrier — the resolved client/config, not a global or a re-derived guess. Both
   gates call the same predicate, so they can't disagree.
2. **Filter the catalog with it.** The list of affordances offered to a caller
   (the tool schemas sent to a model, the actions in a menu) excludes anything the
   predicate rejects. The offer reflects reality.
3. **Re-check at the point of execution.** The executor calls the same predicate
   before doing the work and refuses with a clear message if it fails. This is not
   redundant: the caller may not have come through the catalog (a hand-written
   request, a hallucinated tool call, a stale UI).
4. **Match the predicate to the UI's truth.** If a checkbox/flag is a plain
   boolean, gate on `=== true`, not "truthy unless explicitly false" — an
   unconfigured/undefined value must read the same way the UI renders it, or the
   gate and the control disagree.
5. **Gate on the right capability.** A feature that feeds a *secondary* service
   (a recognizer, a converter) gates on *that* service being configured, not on
   the primary actor's capabilities — they're different signals.

## Why

A gate that exists only where things are advertised silently fails the moment
something reaches the affordance another way. The case that bit us: media-load
tools were filtered out of the schemas sent to a text-only model but had no
execution-time check — when the model fabricated the call anyway, the tool ran and
loaded media the model could never see, wasting the turn. The advertise gate had
also been lost in a refactor with nothing to catch it, because the executor didn't
share the check. One predicate, called at both boundaries, makes the gate a
property of the affordance instead of a property of one code path that can rot.

## How to apply

- Give the affordance a `canRun()`/`isSupported()` that reads the capability from
  the injected context (`client.resolve(...)`, `ctx.host.x`), returning a plain
  boolean.
- In the catalog/schema builder, drop entries whose predicate is false.
- In the executor, call the predicate first; on false, return a clear "not
  available" result rather than attempting the work.
- If a permission/config UI lists these affordances, filter that list with the
  same predicate too, so the editor only offers what's actually possible.
- Write the predicate to agree with how the capability is configured (boolean
  checkbox → `=== true`); don't invent a default that contradicts the control.
