# Documentation

**Three layers, separated by lifecycle:**

| Layer | File(s) | Tense / lifecycle |
| --- | --- | --- |
| Map | `docs/ARCHITECTURE.md` (+ area docs) | present tense; updated with the code; instance-specific |
| Rules | `docs/conventions/` | present tense; portable across projects; one topic per file |
| Decisions | `docs/adr/` | dated, immutable log; statuses Proposed → Accepted → Superseded |

When the map outgrows one file, it becomes a **hub and spokes**: the hub keeps
the cross-cutting orientation (overview, process model, directory map, an index
of area docs) and each subsystem gets its own area file under
`docs/architecture/`. Updating the map then means updating the right spoke, not
just the hub — the hub's index line per spoke is what keeps "which file owns
this" answerable.

The separation exists because mixing them corrupts both: rules buried in dated
records go stale-looking the moment a supersession lands; history rewritten into
"current state" docs loses the why. ADRs record *that and why* something was
adopted; conventions state *what the rule is now*; the map shows *where things are*.

**Rules.**

1. **Diagrams are Mermaid**, never ASCII art — they render on the hosting platform
   and in IDEs, and survive edits. Quote node labels containing `?`, `/`, or
   `<br/>` (flowchart parser traps).
2. **ADR hygiene:** one decision per ADR; supersede, don't rewrite (exception: a
   never-published doc set may be cleaned wholesale — history that was never shared
   isn't history). Convention adoption is one ADR pointing at `conventions/`, not a
   restatement.
3. **Documentation lives in documentation, not code.** Over-commenting steals
   context: source files are read whole, by people and by models, and every
   comment line spends working memory the task needed. Anything that documents —
   architecture narration, design rationale, module relationships — goes to its
   layer (the map, ADRs), never into the source file. File headers are **one
   line** — the file's role, plus a non-obvious contract if there is one. Inline
   comments exist only for traps the code cannot show: a constraint, a contract
   edge, a "this looks wrong but isn't" — one line each. Never narrate what the
   next block does, never number-walk the steps of a function, never restate the
   design, and never explain why a change was correct (reviewer-talk, noise
   after merge).
4. **Heuristics carry their rationale inline** — a threshold or magic decision in
   code states why that value, right where it's read.
5. **README is the operator's view** (install, run, configure); architecture detail
   links out to the map rather than duplicating it.
