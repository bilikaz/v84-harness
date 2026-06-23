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

## Local-LLM prefill/eviction kills long & resumed runs

Self-hosted LLM servers (vLLM and friends) hold a **finite KV cache** and admit a
bounded number of concurrent sequences (`max_num_seqs`). Two harness behaviours
push past that and the server evicts cached prefixes — which then have to be
**re-prefilled** from scratch on the next turn (slow), or the slow-trickling SSE
stream is reset mid-response:

1. **Fan-out concurrency.** `RunAgent` spawns every run at once
   ([ADR-0060](docs/adr/0060-async-subagent-delivery.md)); N children + the parent
   can exceed the server's eviction-proof budget (roughly
   `max_num_seqs × max_model_len ≤ KV pool`), so sessions get evicted and thrash
   re-prefill, or streams reset under the load.
2. **Resume re-prefills the whole context.** `ResumeAgent` /
   `engine.resume` continues from the *full* saved history
   ([ADR-0058](docs/adr/0058-conversational-sub-agent-orchestration.md)) — and if
   the cache was evicted in the gap (a 10–15 min wait is enough), the entire
   prompt is recomputed before the run can make progress.

This is a **design gap, not a settled fix** — think it through before building.
Candidate directions (not yet decided):

- **Cap concurrent sub-agents** to fit the server budget — e.g. a
  `session.maxConcurrentAgents` (default ~`max_num_seqs − 1`, reserving a parent
  slot), queue the excess, start the next as one finishes. Bounds both eviction
  pressure and stream-reset risk. Async delivery already makes "queued, not
  blocking" natural.
- **Bound a child's context growth** so long runs don't balloon the prefix in the
  first place (ADR-0058 flagged this as still-needed) — the cheaper a prefix is to
  recompute, the less an eviction hurts.
- Anything touching the server side (KV pool sizing, `max_num_seqs`, proxy stream
  timeouts) is the **operator's** lever, not the app's — but the app should not
  *generate* load it knows the server can't hold.

Likely an ADR once a direction is chosen (it changes dispatch behaviour + adds
config). Tracked in the ADR "Needs review" table too.

## Implement remote workspaces

The `remote` container type ([ADR-0046](docs/adr/0046-typed-containers.md)) is
scaffolded only — the data model holds it (`type: "remote"`, `config:
{dockerName, root}`) and the tool tier exists, but there's no VM runtime behind
it. Implement the actual remote workspace: provision/attach a Docker container
per workspace, route the `remote/` tools to execute inside it, and wire its
lifecycle (create / connect / teardown). Needs its own design pass + ADR.
