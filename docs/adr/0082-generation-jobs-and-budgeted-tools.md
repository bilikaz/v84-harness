# ADR-0082: Generation jobs, budgeted generate tools, and the scratch/curated split

Status: Accepted
Date: 2026-07-09
Builds on [ADR-0076](0076-image-edit-service-and-referenceable-images.md) and
[ADR-0077](0077-media-reference-aliases.md).
Present-tense map: [architecture/plugins.md](../architecture/plugins.md) (comics),
[architecture/tools.md](../architecture/tools.md).

## Context

Flow agents generating images need format discipline (aspect, quality, naming), attempt budgets,
and safety (a generation must never overwrite curated files) — but prompt discipline doesn't hold,
and passing configuration through the model invites drift. The comics flows also exposed
reference-order confusion (image servers see references unnamed, positional) and prompt anchoring
(an example in an instruction absorbed as data).

## Decision

**Invariants live in code, keyed by the session ("models create, graphs housekeep"):**

- **Per-session generation JOBS as session-meta extension keys**: `SessionRuntime` admits
  flow-owned keys flat next to the core ones; a flow passes extra meta at run construction
  (`runContract`/dialog/agent `meta`), the store patches it into `session.meta` (persisted with
  it), and the engine stamps the whole meta onto every tool call (like `mediaRefs` — tools run
  across the bridge and can't reach the store). Core carries these keys blindly and never reads
  them. Comics owns `generationJob` (`{kind, aspect, quality, max}`, defined in its tool base);
  its generate tools look for that key and refuse without a matching one. No registry, no
  lifecycle: overwritten by the next configure, never cleared — persisting with the session
  complies with boot=resume by construction.
- **Budgeted generate tools** (comics: `MascotGenerate`/`PanelGenerate` over one shared trunk):
  the agent supplies ONLY the creative part; format/naming/output come from the job. Attempts land
  as `generated-images/jobs/<sessionId>/attempt-N.png` — **the files ARE the ledger** (counted by
  readdir; sessions are the namespace, so concurrency is safe) and **the budget is silent** until
  it binds: at the cap the tool refuses and instructs choosing the best attempt.
- **Scratch vs curated**: ALL generation lands under `generated-images/` (folder-named outputs nest
  INSIDE it — generation structurally cannot write outside); only graph nodes promote into curated
  homes (`avatars/`, `comics/<name>/`) via `Copy`. Core `Copy` accepts an `img-N` alias as `from`
  (aliases are session currency; files are cross-session currency — Copy is the converter), and the
  graph materializes pasted references before any cross-session use.
- **The structured reference law** (enforced in code): references are
  `{image (path|img-N), alias, description}` — total ≤ 4 (frontier image models degrade past
  that), unique aliases spoken in the prompt (word-boundary checked), and the TOOL owns the
  alias→position translation: a prepended manifest (`image 1 ("mia"): …`) plus body rewriting to
  the same notation. Roles (`subject ≤2 mandatory-when-provided / style ≤2 / attempt ≤1`) are
  mascot-only; panel references are role-less, ≥1 required, most-important-first; >4 anchors →
  staged generation (core first, best attempt as base + extras).
- **Task = data, system prompt = method**: agent tasks composed by graphs carry only the run's
  data; the method, contracts, and checklists live in the agent's system prompt (see the
  llm-interfaces convention amendment). Anatomy is a COUNT pass, not a glance (features counted per
  character, bodies/heads per scene) — generators self-check every attempt before showing it; the
  independent checker re-counts on the panel path.

## Consequences

- An agent cannot mis-name, mis-place, over-spend, or overwrite — the failure modes moved from
  prompt discipline to structure.
- Independent validation (`comics:check`, tool-grounded so it CANNOT generate) gates panel securing
  (bounded refires, rejected attempt fed back as reference). Where the USER already judged the
  output live (the mascot interview, per-frame review), the user is the gate — no machine re-check.
- Settled records (bibles, story logs, memory sheets) are written ONCE by graph nodes at settle
  points — never by agents mid-conversation.
