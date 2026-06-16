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

## Browser fleet optimization

The managed browser-window fleet (`apps/desktop/src/core/browser.ts`,
`core/browserTools.ts`, `electron/browserFleet.ts`, `pages/browser/`) needs an
optimization pass. **Specifics TBD** — define the actual bottleneck before acting.

## Implement remote workspaces

The `remote` container type ([ADR-0046](docs/adr/0046-typed-containers.md)) is
scaffolded only — the data model holds it (`type: "remote"`, `config:
{dockerName, root}`) and the tool tier exists, but there's no VM runtime behind
it. Implement the actual remote workspace: provision/attach a Docker container
per workspace, route the `remote/` tools to execute inside it, and wire its
lifecycle (create / connect / teardown). Needs its own design pass + ADR.

## Implement the plugin system

The `plugins` + `plugin_data` tables/repos exist across all backends
([ADR-0043](docs/adr/0043-per-entity-repos.md)) but nothing reads or writes them
yet — pure scaffolding. Build the actual plugin system: a registration model, a
plugin's own UI contributions (Slot regions) + tools, and its namespaced data
store (`pluginData`, keyed by `(pluginId, collection, key)`). Needs its own
design pass + ADR (capability/permission surface, load/enable lifecycle, trust
boundary).
