# ADR-0051: Browser windows — session-owned, ephemeral, agent-driven

Status: Accepted
Date: 2026-06-17
Builds on [ADR-0036](0036-host-capability-surface.md) (`ctx.api.browser`, the WebContentsView fleet) and [ADR-0050](0050-engine-tool-tier.md) (the browser tools are engine-tier). Supersedes the prior global / user-seeded / tombstoned fleet model (which had no ADR of its own).

## Context

The browser fleet (one WebContentsView per window, owned in main) was **global and user-seeded**: every
session saw every window; the user opened windows via a "Open a URL…" box and forwarded a page into chat;
a closed window became a **tombstone** kept in the fleet store. That model bit in several ways:

- two agents (two sessions) could race to navigate the same window;
- an agent saw windows it never opened and reasoned about them;
- the right-rail panel accumulated dead tombstones (a user could end up with dozens);
- an agent couldn't open or drive its own browsing — only read what it was handed;
- windows were addressed by **random UUIDs**, which a model fumbles/hallucinates → "no such window" →
  the error said "open a new one" → **window sprawl** (a "visit 5 sites" task spawning 10+ windows).

## Decision

Browser windows are **owned by the session that opened them** and are **agent-driven**.

- **Ownership + isolation.** Each window carries `ownerSessionId`. The agent tools are session-scoped (see
  and touch only their own session's windows); the user's right-rail panel is a **god-view** over all
  sessions, each window labeled by its owner. No cross-agent races, no leakage.
- **Ephemeral, no tombstones.** `close()` **removes** the record — the god-view and `ActiveBrowsers` are
  live-only and never pile up dead chips. The durable record is the **transcript** (the `Browser` tool
  calls). A `Browser` call's tool-card renders a derived link: **alive** → opens the window, **closed** →
  struck-through tombstone — mirroring how sub-agent runs render (`ChildRunLink`). Live status (the load
  dot) lives only in the panel.
- **Agent surface** (engine tier, [ADR-0050](0050-engine-tool-tier.md)): `Browser` (open `id:"new"` /
  navigate; **ask**-gated), `BrowserContent` (text + links, plus a screenshot when the model has vision),
  `BrowserDescribe` (screenshot → the `imageRec` model → a text page-structure description, so a text-only
  agent can "see" forms/buttons/layout), `ActiveBrowsers` (list). **No agent-side close** — the human
  closes via the panel; session-close cleanup closes a deleted session's orphans.
- **Short per-session ids.** Windows are addressed by a monotonic per-session number (`1`, `2`, …), not the
  UUID — model-holdable, killing id hallucination. A bad/closed id returns the session's window list
  **inline** (the `resolveAgent`-on-miss pattern), so a wrong guess redirects to reuse instead of opening
  more; a soft per-session open cap backstops sprawl.
- **Host additions.** `capturePage(id)` (PNG data URL, for the two read tools) and a main→renderer push
  event carrying `{url, title, loading}` on navigate / title change / load start-stop — so the god-view
  tracks navigation live (not frozen at first load), the load dot flips live, and `Browser` can await load
  before returning.
- **User comment flow, session-routed.** The user can still act in a window (log in, dismiss a popup) and
  comment to continue; the comment routes to the window's **owning** session (`sendTo(ownerSessionId)`), so
  the agent that hit the wall resumes — wherever the user is in the UI.

Why session-owned over global: isolation. Why ephemeral over tombstoned: the transcript is the record; a
live view shouldn't accumulate dead entries. Why short ids: UUIDs are hallucination bait. Why
human-in-the-loop over click/type automation: logins/captchas fall to a human regardless, and
link-following is already covered by `Browser` navigation — click/type is deferred host work, revisited
only if unattended runs need it.

## Consequences

- Windows can't leak or race across agents, don't pile up dead chips, keep a full per-session audit trail,
  and let the user hand control back to the exact agent that needs it.
- A blind (non-vision) agent gains real page comprehension via `BrowserDescribe`; a vision agent gets the
  screenshot inline via `BrowserContent`.
- The bridge gains two channels (`browserCapture`, `browserEvent` — its second main→renderer push after
  [ADR-0049](0049-plugin-service-bridge.md)); the handshake gap ([ADR-0002](0002-typed-ipc-bridge.md))
  grows — noted in the index needs-review row.
- Tool-card entity links are now a shared shape across the engine tier (sub-agent child sessions and
  browser windows both render alive-link / tombstone by id lookup).
- The stale-title / frozen-god-view behavior is fixed by the full-update push event (a bug fix that rode
  this change, not its own ADR).
