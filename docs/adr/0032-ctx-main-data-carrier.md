# ADR-0032: Ctx — the one data carrier (config + llm client + tool gateway)

Status: Proposed
Date: 2026-06-14

## Context

With config as the sole source of truth (ADR-0031), consumers still each reached it
differently: the driver called `getConfig()`, tools called `getAppConfig()` directly
and minted their own client, the chat path used a separate `client` singleton, and
the IPC tool payload was a hand-rolled snapshot. There were two `LLMClient`s and
config was re-derived at every site. Tool *execution* was platform-coupled in the
driver (a `harness ? main : renderer` branch). The missing piece was one object that
carries everything a turn needs, that `core` reads instead of re-assembling — and
that the platform, not `core`, fills in where it must differ.

## Decision

`Ctx` is the single data carrier. It holds three things:

```ts
class Ctx {
  llm: LLMClient;      // the ONLY createClient() call site
  config: Config;      // live aggregate (getter) or fixed snapshot (main, from the wire)
  tools: ToolGateway;  // the platform's tool execution — installed by the boot
  resolve(service): ConfigLLM | null   // satisfies the llm client's ConfigSource
}
```

- **`config` + `llm` are platform-agnostic** — built in `core` from config (HTTP works
  anywhere). `Ctx` is the only birthplace of an `LLMClient`; the chat path, naming,
  compaction, and every tool share `ctx.llm`. The parallel `client.ts` singleton and
  `toolConfigSnapshot()` are deleted.
- **`tools` is the platform-specific part** — a `ToolGateway` ({ `schemas`, `run`,
  `descriptors` }) the platform installs (ADR-0034): web runs tools in-process,
  electron ships them over the bridge. `core` and the driver only touch `ctx.tools`;
  they never branch on platform.

**Built per host.** The renderer builds a singleton over *live* config; the main
process builds `new Ctx(wire.config)` per call from the JSON that crossed IPC. A live
object can't cross a process boundary — only data does.

**`ToolCtx` is dissolved.** Tools take `(ctx, cwd, signal)` and read `this.ctx.config`
/ `this.ctx.llm` / `this.cwd` / `this.signal`. The bridge payload is the minimal
`ToolWire { cwd, config }`; main wraps it back into a `Ctx`. Tool code never knows
which host it runs in.

This refines ADR-0028 (the client's injected `ConfigSource` is now the ctx),
ADR-0002 (the tool IPC payload is `ToolWire`), and supersedes the type-name/ownership
clause of ADR-0030 (`CallTarget` → `ConfigLLM`, owned by config).

## Consequences

- One `createClient` call site; one resolution path (`ctx.resolve`) in every process.
- "What does a turn need?" has one answer: `ctx`. New cross-cutting facilities join
  as ctx members (the trajectory — config first, the tool gateway next).
- Serialization is honest and minimal: only `{ cwd, config }` crosses IPC; the client
  and signal are re-minted main-side (they were always non-cloneable).
- The driver lost its platform branch entirely — it calls `ctx.tools`, and the boot
  decided which gateway that is.
