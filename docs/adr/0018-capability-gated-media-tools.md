# ADR-0018: Capability-gated media tools + unified media feedback

Status: accepted
Date: 2026-06-10
Extends: [ADR-0007](0007-tool-system.md) (tool system)

## Context

Agents needed to review media files sitting in the workspace (e.g. inspect a
render before referencing it), not just media they generate. The existing
feedback path covered images only: tool-produced images rode `ToolResult.images`
and were fed back as a hidden user turn (`imageFeedback`), while tool-produced
video was display-only — and a tool that loads a video for review is pointless
if the model never sees it. Separately, a media-review tool advertised to a
text-only model invites calls whose entire output the model cannot perceive.

## Decision

**Two new gated tools, one factory.** `LoadImage` / `LoadVideo`
(`tools/loadMedia.ts`) read a workspace file under the virtual-root confinement
(same trust level as Read → default mode `2`/auto), enforce an extension
whitelist (png/jpg/jpeg/webp/gif vs mp4/webm/mov) and a size cap (10 MB / 50 MB,
rejection names the actual size), and return the bytes as a data URL on the
matching `ToolResult` field. One factory builds both — they differ only in
whitelist, cap, and payload field.

**Capability gating, advertised AND enforced.** A tool whose purpose is putting
media in front of the model is withheld from the advertised schemas when the
model doesn't declare the matching input (`allowedByCapability` in
`driver.ts`): `LoadImage` requires `input.image !== false` (image support is
assumed unless declared off), `LoadVideo` requires `input.video === true` (video
support only when declared on — the composer's attach-gate defaults). The same
check runs again per call, because a model can hallucinate a tool it wasn't
advertised — it gets "not available for this model" instead of media it can't
see.

**Feedback unified to media.** `imageFeedback` → `mediaFeedback`
(`pushMediaFeedback`): one hidden user turn carries tool-produced images *and*
video, each filtered by the model's declared inputs. Consequence: GenerateVideo's
output is now reviewable by video-capable models; its tool message is phrased to
be accurate whether or not the clip gets attached.

## Consequences

- The advertise-time + run-time pair is the pattern for any future
  capability-bound tool (audio loaders, document viewers).
- Loaded media rides messages as data URLs and persists with the session — the
  caps bound transcript growth, but a video-heavy session still gets large;
  storage pruning (ADR-0012/0017 quota item) stays relevant.
- `toChatMessages` now keeps messages whose only content is video (the filter
  previously dropped them — user-attached video with no text never reached the
  model).
