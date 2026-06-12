# Base classes: plumbing as members, one constructor shape

**Rule in one line:** in a class family behind a factory, shared per-instance
plumbing lives on the abstract base as `protected` members (not module
helpers), the constructor shape is uniform and never overridden — an `init()`
hook covers per-class setup — and per-call state is wired in at construction
so methods stop threading it as parameters.

## Why

Module-level helpers next to a class family are members in denial: every
subclass imports them and threads the same arguments (the connection, the
abort signal, the request context) through every call. That threading is
noise, and it leaks — one forgotten `signal` parameter and cancellation
silently stops working on one path. Constructor overriding breaks factories:
the moment subclasses have different constructor shapes, the factory needs
per-class knowledge, which is a routing table by another name.

## How to apply

1. **Constructor = the family's contract.** The base takes everything an
   instance is (its config/target) and everything the interaction needs (the
   call context: inputs, signal, knobs). Subclasses declare no constructor.
2. **`init()` hook, empty in the base**, for the few classes that need extra
   setup (token exchange, handshake). Most never touch it.
3. **Helpers used by more than one subclass become `protected` base methods**
   reading the wired state: `this.request(path, opts)` carries auth and the
   signal itself; `this.prompt()` reads the wired inputs. If only one subclass
   family needs a helper, it goes on that family's intermediate base.
4. **Intermediate bases own the shared flow, subclasses own the variation**:
   the base sequences (retry, demux, poll loop, deliver), the subclass
   provides the wire mapping as small abstract methods (`stream()`,
   `generate(prompt, p)`, `submit/poll/content`).
5. Instances are cheap and per-interaction — that's what makes wiring
   per-call state into the constructor safe. Don't cache family instances
   across calls if their context is per-call.

## Example

```ts
abstract class BaseProvider {
  constructor(protected target: Target, protected ctx: CallContext) { this.init(); }
  protected init(): void {}
  abstract call<T>(handler: Handler<T>): Promise<T>;
  protected async request(path: string, opts: RequestOpts): Promise<Response> {
    // auth from this.target, cancellation from this.ctx.signal — callers pass neither
  }
}

abstract class BaseVideoProvider extends BaseProvider {
  protected abstract submit(prompt: string, p: Params): Promise<Job>; // no signal param
  async call<T>(handler: Handler<T>) { /* the time loop, once, here */ }
}
```
