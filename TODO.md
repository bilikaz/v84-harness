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
