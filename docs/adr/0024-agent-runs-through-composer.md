# ADR-0024: Agent runs go through the composer — pseudo-session priming

Status: accepted
Date: 2026-06-10

## Context

The original AgentsView was a separate page with its own run form: a user-text
area, its own attachment picker, its own Run button — a weaker duplicate of the
chat composer. Its menu entry had also silently vanished: the sidebar redesign
(Workspaces + Sessions) dropped the `menu` Slot, leaving the region registered
into but rendered nowhere. Running an agent and sending a chat message are the
same act with a different starting configuration; two implementations of "type
a task, attach files, send" is exactly the duplication the consolidation rule
exists to kill.

## Decision

**The composer IS the run form.** The shared `Composer` component (extracted
from SessionView: attachments, paste, auto-grow, model picker, send/stop) is
used by both the chat and the agent run page. Clicking an agent in the library
opens the **primed run page** (`agents/<id>`): a pseudo session — System banner
showing the agent's prompt, the saved user template seeded into the composer —
with **nothing written to the session store**. Browsing agents creates nothing;
the real session materializes on send (title = agent name, system stamped,
workspace per the agent's binding, `agentId` stamped) and the user lands in the
chat to watch it run. The pencil flips the same route to the editor
(`agents/<id>/edit`). The saved `user` markdown is a *template for manual runs*
only — orchestrators supply their own task (ADR-0022).

**The library lives in the right panel** (`right-panel` region, below the
context card): one row per agent, filtered to the active context (chat hides
workspace agents), hover pencil/play, play = immediate run with the saved
template. The **`menu` region is deleted** from the `Region` type — a region no
shell surface renders is a silent trap (this exact bug), so dead regions don't
get to linger.

Agent-stamped sessions render the System banner atop the transcript, and the
driver appends the `workspace.system` prompt asset (the `/` virtual-root
explanation, ADR-0007) whenever gated file tools are actually advertised — the
session's capabilities are stated to the model, never assumed known.

## Consequences

- One composer implementation; the agent run page deleted its weaker copy
  (attachments, capability gating, paste handling now uniform).
- No draft state to clean up: priming is route + props, so navigating away
  discards it by construction, and session-store litter from browsing is
  impossible.
- Run state is linkable (`agents/<id>`), and selection survives re-renders via
  the route instead of component state.
- The editor keeps live-save semantics; there is no read-only "preview" page —
  the primed run page (banner + seeded composer) is the preview.
- Removing `menu` is a breaking change for the `Region` type; any future
  contribution needs a rendered region — the type now only lists surfaces the
  shell actually draws.
