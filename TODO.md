# TODO

Deferred engineering tasks not yet scheduled. Architectural gaps tied to a
specific decision live in the ADR "Needs review" table
([docs/adr/README.md](docs/adr/README.md)); this file is for actionable work.

## Incremental message persistence

`persistSession` rewrites the **whole transcript** on every turn —
`messages.replaceForSession` deletes all of a session's rows and re-inserts them
(O(transcript) writes per turn, ~O(n²) over a long session). Media is already
write-once (`storeMedia` skips items whose url isn't a `data:` URL); messages
aren't.

Now that messages are per-row ([ADR-0043](docs/adr/0043-per-entity-repos.md)),
change the persist path to **upsert by ULID**: write new/edited rows, delete
removed ones, leave the rest. No schema change — just the `replaceForSession`
contract (client store + server repo). Matters most for long sessions / slow
remote.

## Refactor the Bash tool

`Bash` is too open-ended: agents reach for it as a catch-all and run arbitrary,
ad-hoc commands, so runs end up messy and hard to reason about (and to gate — one
"ask" covers everything from `ls` to `rm -rf`). Tighten it: narrower, intention-
revealing affordances over a raw shell where a dedicated tool fits, and/or
constraints on what `Bash` accepts, so the common cases stop going through a
blank shell prompt.

It also isn't portable: the Windows build has **no real bash**, so a
`Bash`-centric agent degrades or breaks there. The refactor needs a cross-platform
story — a portable command layer, or platform-appropriate shells behind one tool
contract — so workspace tooling works the same on Windows as on Linux/macOS.
Needs a design pass (and likely an ADR, given the tool-surface + permission impact).

## Bound a child's context growth (re-prefill cost)

The local-LLM eviction/stream-reset failure is **resolved**: the concurrency runner
([ADR-0065](docs/adr/0065-per-service-priority-pools.md) /
[ADR-0066](docs/adr/0066-concurrency-runner.md)) caps in-flight calls per model (`c` +
reserve + queue) so the app never overruns the server budget, and keeps a returning
session on its warm provider (provider affinity + KV-protect threshold) instead of
re-routing; the server-side keep-alive ping covers stream/connection liveness. Set each
model's `c` to the endpoint's `max_num_seqs` budget and the eviction pressure is bounded.

What remains is an **optimization, not a live failure**: a child's prefix still **grows
unbounded** over a long run ([ADR-0058](docs/adr/0058-conversational-sub-agent-orchestration.md)
flagged this), so the rare re-prefill that does happen (e.g. a binding lapses past its TTL)
is more expensive than it needs to be. Bound the growth — sliding window, mid-run
compaction, or a per-child context budget — so re-prefill stays cheap. Lower priority now
that eviction itself is contained; likely a refinement ADR if/when pursued.

## Implement remote workspaces

The `remote` container type ([ADR-0046](docs/adr/0046-typed-containers.md)) is
scaffolded only — the data model holds it (`type: "remote"`, `config:
{dockerName, root}`) and the tool tier exists, but there's no VM runtime behind
it. Implement the actual remote workspace: provision/attach a Docker container
per workspace, route the `remote/` tools to execute inside it, and wire its
lifecycle (create / connect / teardown). Needs its own design pass + ADR.

---

The items below came out of an architecture review. None is a bug — they're
deliberate-tradeoff or future-work refinements, recorded here so the decision is
made on purpose (with an ADR) rather than reactively.

## Retire the global `ctxRef` in account.ts

`account.ts` holds a module-global `let ctxRef: Ctx | null` set by
`attachAccount(ctx)`, and `applyConnection()` reaches out to mutate `ctx.storage`
directly. It works — it's the single, documented connection-switch seam ("the
whole switch is right here") — but the global makes the module a hidden singleton:
it can't be tested without wiring a real `Ctx`, and the storage swap is a side
effect invisible from `Ctx`'s own surface.

Move connect/disconnect onto `Ctx` as a method (or an injected
`ConnectionController`) so the switch is owned by the thing it mutates, leaving
`account` to hold only identity + tokens. **Gain:** account becomes unit-testable
in isolation, the storage swap stops being a cross-module reach-in, and the
connection lifecycle has one obvious owner. Touches `account.ts` + `ctx.ts`;
refines [ADR-0039](docs/adr/0039-account-local-store-and-connection-lifecycle.md)
/ [ADR-0032](docs/adr/0032-ctx-main-data-carrier.md).

## Type the plugin event bridge

`HostApi.onPluginEvent(cb: (slug, type: string, payload: unknown) => void)` is the
cross-process channel plugins use to push state to the renderer (e.g. the MCP
plugin's connection-status changes). Both `type` (bare `string`) and `payload`
(`unknown`) are untyped: subscribers narrow by hand, there's no autocomplete, no
discoverable "what events exist?", and renaming a payload shape breaks subscribers
silently.

The wrinkle: events are **plugin-defined**, so the typed map must NOT live in
`core/` — that would couple core to plugin event names and break the
core-never-imports-plugins boundary. Type it at the plugin layer: each plugin
declares its own event map and exposes a typed `on<K>()` wrapper over the raw
bridge; the `HostApi` seam stays `unknown` (honest for a cross-process channel).
**Gain:** compile-time safety + autocomplete + a documented per-plugin event
contract, with no plugin specifics leaking into core. Touches the MCP plugin
([ADR-0063](docs/adr/0063-mcp-client-plugin.md)) and the plugin event helper.

## Plugin lifecycle hooks (onEnable / onDisable)

`PluginManifest` has no lifecycle — a plugin is gated purely by `canRun()` + tool
`filter()`. Fine while plugins are stateless first-party tools, but one that
allocates resources (watches a directory, holds a socket, spawns a process) has
nowhere to set up or tear down: disabling it leaves the resource dangling.

Add optional `onEnable()` / `onDisable()` (+ a dispose path) to the manifest,
called by the registry on the enabled-flag transition. **Gain:** plugins own
their resources cleanly — a prerequisite for safe third-party plugins. Low
priority while everything is first-party + stateless; pull forward when a stateful
or third-party plugin lands.

## Declare feature dependencies (knowledge)

Knowledge features self-register via `features/*/register.ts`, discovered and run
in **alphabetical** order ([ADR-0040](docs/adr/0040-knowledge-remote-service.md)).
If one feature depends on another (e.g. `kb` on `auth`), that ordering is
coincidental, not contractual — a rename could silently reorder boot and break it.

Let a feature declare its prerequisites (a `dependsOn` field on registration) and
have `loadRegistry()` topologically order them, erroring on a missing or cyclic
dep. **Gain:** boot order becomes explicit and verified instead of alphabetical
luck; a missing prerequisite fails loudly at startup, not mysteriously at runtime.

## Tool execution observability hooks

`ToolRegistry.run()` has no seam for monitoring — no hook around
start/complete/error — so there's no central place to log timings, count failures,
or trace a tool call; each tool logs ad hoc, if at all.

Add a lightweight middleware/event around tool execution (run →
complete/error, with name, duration, outcome). **Gain:** uniform tool telemetry
(latency, error rates, which tools agents actually reach for) from one place
without touching each tool — useful for debugging agent behaviour and catching
slow/failing tools.

---

The two below came out of a performance review and are related: do the Blob one
FIRST — it removes the bulk of the in-memory weight the session one is trying to
manage, so the second likely shrinks to a cheap lookup change.

## Store media as Blobs, not base64 data URLs

Media is captured/downscaled into a `data:` URL string, persisted as
`MediaRow.data: string` (base64), reinflated to a `data:` URL on load, and
rendered with `<img src={dataUrl}>`. Base64 costs ~33% over the raw bytes, lives
as a JS string on the heap inside **every** message of **every** loaded
transcript, and must be decoded on the main thread. IndexedDB stores `Blob`s
natively, and a `blob:` URL (`URL.createObjectURL`) keeps the bytes off the JS
heap (browser-managed) while `<img>` works unchanged.

Target: `Blob` is the canonical media payload; the renderer holds short `blob:`
URLs, not megabytes of base64. **Gain:** big cut in resident memory (the main
driver of the session-memory problem below), no main-thread base64 decode on
load, ~33% less storage.

Four decisions/forks to settle (warrants `implementation.md` + an ADR — it
changes the media storage contract):

1. **Local vs remote boundary.** `MediaRow.data` is shared by the IDB backend and
   the remote HTTP backend; IDB can hold a `Blob`, JSON-over-HTTP can't. Make
   `data: Blob` canonical and have the **remote repo base64 at the wire** (encode
   on PUT / decode on GET) so the knowledge **server is unchanged** while local
   gets the win (the common case).
2. **Revocation lifecycle — the real risk.** A `blob:` URL leaks its Blob for the
   document's life unless `revokeObjectURL` is called; without disciplined revoke
   on message-removal / transcript-replace / eviction it's a net loss vs data URLs
   (which GC with the string). Wire revoke into the inflate/replace/delete paths.
3. **The LLM wire still needs base64.** Provider image APIs take base64, so read
   the blob back to base64 at **send** time — base64 becomes transient (per-send)
   instead of permanent (in every message + IDB). "Blob everywhere" relocates
   base64, doesn't remove it.
4. **imageResize** already makes a `Blob` internally then base64-encodes it —
   return the Blob directly, which also trims the resize memory spike (holds
   blob + bitmap + Uint8Array simultaneously today).

Touches: `MediaRow` type, both storage backends, `storeMedia`/`inflateMedia`,
`imageResize`, the render refs, the LLM-send conversion, and the revoke lifecycle.

## Evict inactive session transcripts from memory

`sessions: Session[]` is a module-level array kept for the app's whole life.
Transcripts already lazy-LOAD (`loaded: false` until `ensureLoaded` reads them),
so meta is always resident but messages aren't — UNTIL you open a session, after
which its messages stay in memory **forever** (no eviction). Open 50 image-heavy
chats and all 50 transcripts stay resident.

Two independent pieces:
- **`Map<string, Session>` instead of the array** — O(1) `getSession` vs today's
  `.find()`. Cheap, mechanical, pure CPU win, low risk. Worth doing on its own.
- **LRU eviction** — drop messages of clean, non-active, non-streaming sessions
  (keep the last N), re-lazy-load on access via the path that already exists.
  **Gain:** peak memory bounded to the active set instead of "everything ever
  viewed." The hard part is the safety logic: never evict unpersisted or streaming
  state, and revoke any `blob:` URLs the dropped messages held (ties into the Blob
  item above).

Priority note: the dominant resident cost is base64 images inside transcripts —
which the Blob change removes. Do Blob first; after it a loaded transcript is
light (text + short blob-url refs), so eviction may be unnecessary and only the
cheap `Map` lookup is clearly worth it. Re-measure before building eviction.

## Progress indicator while a tool call is being generated

Assistant text and thinking stream into the UI token-by-token (the `text` /
`thinking` deltas append live), but a TOOL CALL only appears once it's complete —
`tool:calls` fires after the whole call is assembled. While the model is generating
a large tool call (a big file write, a long patch, a wide search payload), nothing
moves on screen, so the chat looks **frozen** even though the model is actively
producing output.

Show a live indicator during tool-call generation — e.g. a "preparing a tool
call…" affordance (optionally with the tool name once known, or a streamed-bytes /
spinner cue) on the streaming assistant placeholder, cleared when the call lands.
**Gain:** the UI reads as working, not hung, during long tool-call output — the
same reassurance the streaming text already gives for prose. Needs the driver to
surface a "tool-call in progress" signal (the transport sees the partial
tool-call tokens; today they're only emitted as a finished `tool:calls`).

## Recover tool calls that leak into the reasoning/content stream

Observed against the live vLLM endpoint (Holo-3.1-35B): a model emitted a `Read`
call as its native tool-call tokens (rendered `<|…|>invoke name="Read" …`) inside
the **reasoning** stream. Our OpenAI handler maps `reasoning_content` → `thinking`,
`content` → `text`, and only a **structured** `delta.tool_calls` array → an executed
call ([llm/providers/text/openai.ts](apps/desktop/src/llm/providers/text/openai.ts)).
So the call surfaced as Thoughts text and was never executed — the turn dead-ends.

Root cause is **server/model-side**, not harness logic: vLLM needs
`--enable-auto-tool-choice` + a `--tool-call-parser` matching the model's format (and
a reasoning parser that doesn't swallow the tool tokens). The primary fix is to
configure the endpoint correctly — verify with a direct tools request whether the
response carries `tool_calls` or buries the call in `reasoning_content`/`content`.

Harness mitigation (only if the endpoint can't be relied on): a defensive
text-fallback parser that scans `content`/`reasoning` for leaked tool-call markup
and reconstructs a structured call when no native `tool_calls` arrived. Fragile and
format-specific (per-model markup), so gate it behind a provider/model opt-in rather
than running it universally. **Gain:** these dead-end turns recover instead of
stalling, on endpoints whose tool-call parser is misconfigured or absent.
