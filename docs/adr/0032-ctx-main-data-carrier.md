# ADR-0032: Ctx — the one data carrier (config + llm client + tool gateway + storage + host api + sessions)

Status: Accepted
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

`Ctx` is the single data carrier. It holds:

```ts
class Ctx {
  llm: LLMClient;          // the ONLY createClient() call site
  config: Config;          // live aggregate (getter)
  tools: ToolGateway;      // the platform's tool execution — installed by the boot
  storage: StorageEngine;  // the platform's storage backend — given at construction
  api: HostApi;            // the platform's capability surface — installed by the boot
  sessions: SessionEngine; // the session store/driver, built over this ctx
  resolve(service): LLMConfig | null   // satisfies the llm client's LLMConfigResolver
}
```

- **`config` + `llm` are platform-agnostic** — built in `core` from config (HTTP works
  anywhere). `Ctx` is the only birthplace of an `LLMClient`; the chat path, naming,
  compaction, and every tool share `ctx.llm`. The parallel `client.ts` singleton and
  `toolConfigSnapshot()` are deleted.
- **`tools` is the platform-specific part** — a `ToolGateway` ({ `filter`, `run`,
  `cancel` }) the platform installs (ADR-0034): web runs tools in-process,
  electron ships them over the bridge. `core` and the driver only touch `ctx.tools`;
  they never branch on platform. (`storage` and `api` are platform parts too — the
  same story: built by each platform's `init()`.)

**Built per host.** The renderer builds a singleton `Ctx` over *live* config (each
platform's `init()` constructs it and installs the platform parts). The main process
does **not** build a `Ctx`: `electron/tools.ts` holds a standalone `ToolRegistry` over
`createClient(resolver)`, whose resolver reads a module-level `config` re-seeded from
each call's wire. A live object can't cross a process boundary — only data does, so the
config snapshot rides the wire and main reseeds from it.

**`ToolCtx` is dissolved — tools depend only on the llm client.** A tool is
constructed with just the `LLMClient` (`new Ctor(llm)`, `BaseTool(llm)`); it holds no
ctx. Its `run(args, cwd?, signal?)` takes cwd and signal per call. The client is the
tool's only host dependency — it exposes `resolve(service)`, so a tool reaches config
only through the llm client, never a stored ctx. The bridge payload is the minimal
`WireConfig { config }` (cwd rides on the `ToolCallRequest`); main reseeds the
registry's resolver from it. Tool code never knows which host it runs in.

This refines ADR-0028 (the client's injected `LLMConfigResolver` is the ctx in the
renderer, a module-level seed in main), ADR-0002 (the tool IPC payload is `WireConfig`),
and supersedes the type-name/ownership clause of ADR-0030 (`CallTarget` → `LLMConfig`,
owned by config).

## Consequences

- One `createClient` call site; one resolution path (`ctx.resolve`) in every process.
- "What does a turn need?" has one answer: `ctx`. New cross-cutting facilities join
  as ctx members (the trajectory — config first, the tool gateway next).
- Serialization is honest and minimal: only `{ config }` crosses IPC (cwd rides on the
  call); the client and signal are re-minted main-side (they were always non-cloneable).
- The driver lost its platform branch entirely — it calls `ctx.tools`, and the boot
  decided which gateway that is.
