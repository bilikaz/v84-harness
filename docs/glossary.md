# Glossary — The Naming Authority

One canonical name per concept. If a conversation or draft uses another word for one of these, **it maps
here** — check the *Also seen as* column before coining anything new. Docs use only the canonical names.

> **Why this table exists:** every drafting session — human or LLM — invents its own synonyms (a single
> design conversation here can burn through three names before one lands), and across sessions that
> drift compounds into real confusion. This glossary is the anchor:
> **before any new term enters a doc or a discussion, it is either found here or added here.** Retired
> words stay in the *Also seen as* column forever, so old drafts remain decodable.

## The cast — sessions & the loop

| Canonical name | What it stands for | Also seen as (map these here) |
|----------------|--------------------|-------------------------------|
| **Session** | The ONE conversational unit. Chat, sub chat, graph run, child head — all are sessions; the *kind* is metadata (`agentId` / `graphId` / `parentId`), never a different object. | conversation · chat (loose) · run (loose) |
| **Loop** | `SessionLoopBase` — the one supervised cycle over any session: respond → dispatch → drain inbox → classify → react or settle. One instance per run. | step loop |
| **Driver** | The `respond()` implementation under the loop: `LlmSessionLoop` (one model step) or `GraphSessionLoop` (deterministic command interpreter). | shape · producer |
| **Envelope** | `ResponseEnvelope` — one respond()'s result: `{text, toolCalls?, errored?, fatal?, aborted?, yield?}`. **Never leaves the loop** (the `[object Object]` bug was an envelope escaping). | response object |
| **Segment** | The UI's "turn": one fresh input → the next wait/settle boundary; every turn event fires per segment. "Turn" is fine user-facing; code and docs say segment. | turn (UI sense) |
| **Contract** | What a driven session must return: `schema` + `interactive` flag. `runContract(sid, spec)` drives any session to settlement. | spec (loose) |
| **Fault** | The typed classification of a bad envelope: `errored` / `unparseable` / `missing-fields` / `invalid`. | error kind (loose) |
| **Reaction** | The one table's answer to a fault: resume · correct · wait · escalate. The budget bounds *automatic* repairs only. | heal policy |
| **Heal** | An automatic correction iteration — same loop, same session, never a respawn. | repair · retry (loose) |
| **Settlement** | The loop's terminal event: `end(sid, ok\|fail, data)` — the ONLY way a run ends. | completion · finish |
| **Wait record** | Persisted "A settled (data stored), B still running" row in `session.meta.waits`; settled children replay, pending ones re-arm on load. | wait store row |
| **Pending inbox** | Queued messages for a busy session — drained at cycle boundaries, dated at drain. Busy sessions never refuse. | message queue (loose) |
| **Resident loop** | An interactive loop that stays alive across segments; the drive seam feeds it. | — |
| **Drive seam** | The engine's one routing question per message: resident loop waiting? → feed it; graph session? → command; else → new loop. | dispatch (loose) |
| **Soft stop** | Stop = **pause**, everywhere (abort → wait); only a hard kill settles a run. | abort (hard sense only) |
| **Boot = resume** | Loading unsettled state and continuing IS normal operation — there is no separate revival feature. | revival (retired as a feature name) |

## The cast — session state & tools

| Canonical name | What it stands for | Also seen as (map these here) |
|----------------|--------------------|-------------------------------|
| **Session meta** | `SessionRuntime` — the persisted per-session runtime blob (`session.meta`): typed core keys (`graphRun`, `waits`, `errorKind`…) plus extension keys flat beside them. | metadata · runtime state |
| **Extension key** | A flow-owned key patched into session.meta at run construction (`runContract`/dialog/agent `meta`), stamped to tools on every call, **never read by core** (e.g. `generationJob`). | session job (the comics key's loose name) |
| **Stamp** | The engine-filled non-model fields riding a tool call across the bridge: `cwd`, `imageOutputDir`, `mediaRefs`, `sessionId`, `meta`. Tools can't reach the store — the stamp is their view of the session. | inject · thread through |
| **Agent** | A registered identity: system prompt (the METHOD) + tools ceiling + workspace flag. Plugin agents live in `agents.json`. | worker · persona |
| **Ceiling** | The agent's tools map (`{"*": 0, X: 2}`) — binds EVERY tool tier (ADR-0083). **Grounding** = a ceiling that pins the exact toolset. | agent permissions (workspace *grants* are the separate policy surface) |
| **Tier** | Where a tool executes: registry tools (main process, over the bridge) · engine tier (in-loop: sub-agents, browser) · account tier (remote API: memory). | layer (loose) |
| **Capabilities** | `SessionCapabilities` — the ONE derivation of a session's tool reality (filtered specs + access flags); `composeSystem` renders the prompt blocks from it, wire and banner alike. | — |
| **Task** | The data-only opener of a driven run — the method lives in the agent's system prompt (*task = data, system = method*). | instruction (avoid) |
| **Media alias** | `img-N` / `vid-N` — a conversation's handle for pasted/generated media. Session currency; files are cross-session currency (`Copy` converts). Always qualify "alias". | reference (bare — qualify) |

## The cast — graphs

| Canonical name | What it stands for | Also seen as (map these here) |
|----------------|--------------------|-------------------------------|
| **Graph** | A deterministic flow: a registry of named **nodes**, driven by `GraphSessionLoop` — user commands are its "prompt", node actions are real tool calls. | flow (loose) · orchestration |
| **Node** | A start/end pair: `start(input)` kicks off work (Select / Call / dialog / value), `end(input, response)` routes onward. No node reads another node's data. | step (loose) |
| **Head** | One in-flight flow strand — a node instance bound to its fan-out identity (member name + group). Graph vocabulary ONLY. | strand · branch · worker |
| **Group** | A producer-declared fan-out set; a join fires when `size` members have ARRIVED — never by checking who looks idle. | fan-out set |
| **Call / Select** | The graph's REAL tool calls: `Call` drives a session via `runContract`; `Select` opens a selection. Every card in the UI is literally one of these. | openCard (RETIRED — was a simulation) |
| **Dialog** | A ReAct interview with a JSON contract, run ON a surface session (its own sub chat when `agentId` is set). | interview |
| **Surface** | The session a dialog runs on — the graph session itself, or a spawned sub chat. | — |
| **Park** | `ctx.break(message)` — yield the run at this node awaiting user input; `continue` re-enters the node. | break · pause (loose) |
| **Milestone** | The persisted node-boundary cursor (`session.meta.graphRun`) a relaunch resumes from; `dialogSurface` re-binds a live interview. | cursor · checkpoint |

## The cast — generation & comics

| Canonical name | What it stands for | Also seen as (map these here) |
|----------------|--------------------|-------------------------------|
| **Generation job** | Comics' extension key: `{kind: avatar\|panel, aspect, quality, max}` — budgeted generate tools refuse without a matching one. Never bare "job". | session job · job (bare — qualify) |
| **Attempt budget** | The generation cap (`max`): silent until it binds; at the cap the tool refuses and instructs choosing the best attempt. Qualify "budget" — the loop's **heal budget** is the other one. | budget (bare — qualify) |
| **Attempt ledger** | The files `generated-images/jobs/<sid>/attempt-N.png` ARE the count — readdir is the counter, sessions are the namespace. | budget tracking · counter |
| **Scratch** | `generated-images/` — ALL generation lands here, structurally unable to touch curated homes. | temp output |
| **Curated** | The promoted homes (`avatars/`, `comics/<name>/`) — only graph nodes write here. **Promotion** = the graph's `Copy` from scratch. | final output |
| **Reference** | A structured generation input the agent declares: `{image, alias, description, role?}`. Its **reference alias** is the handle the prompt speaks in — distinct from a *media alias*. | anchor (count sense ok: "4 anchors") |
| **Reference manifest** | The `image N ("alias"): description` preamble the TOOL prepends (it owns alias → position translation). Distinct from a *plugin manifest*. | manifest (bare — qualify) |
| **Mascot** | The reusable comic character. Its **avatar** is the curated image (and the mascot flow's job kind); its **bible** (`avatars/<slug>.json`) is the character record — look/character/lineage + accumulating stories/lore. | character (loose) |
| **Panel** | One comic image — the artifact. **Frame** is the flow step/agent that produces a panel (`comics:frame`, the panel job). | frame (artifact sense — the artifact is a panel) |
| **User as gate** | Where the user judged output live (mascot interview, per-frame review), the user IS the validation — no machine re-check. | — |
| **Models create, graphs housekeep** | The division of labor: models produce content; graphs do the deterministic bookkeeping (naming, placement, records, promotion) in code. | — |

## Naming rules

1. **One canonical name per concept** — new words map into this table before they enter a doc.
2. **The *Also seen as* column carries only words with a durable referent** — code history, docs, or
   common loose speech. A synonym that lived inside one drafting session and never touched a file does
   not get memorialized; it just dies. **Reader's corollary** (for agents reading old transcripts,
   session summaries, or draft notes): a term you find there that exists neither in this table nor in
   the codebase was such a draft name — resolve it to the current canon by what it *described*, use the
   canonical word in everything you produce, and do not reintroduce the dead one.
3. **"envelope" means `ResponseEnvelope` only**, and it never leaves the loop — anything crossing a
   boundary is the settled `data`, a turn's text, or a tool result.
4. **Qualify the collision-prone words, always**: *attempt* budget vs *heal* budget · *media* alias vs
   *reference* alias · *plugin* manifest vs *reference* manifest · "job" only as **generation job**.
5. **"head" is graph vocabulary only** — a flow strand. It is never "the first model turn" or a session
   in general.
6. **"revival" is not a feature** — boot = resume: loading unsettled state and continuing is the engine's
   normal operation. Say "resumes from its milestone", not "the revival system".
7. **Extension keys are flow-owned, core-blind** — core never reads them, and their names belong to the
   owning plugin's vocabulary (`generationJob` is comics', not core's).
8. **Task = data, system = method** — a "task" carries only the run's specifics; if method text is
   appearing in a task, the word being reached for is the agent's *system prompt*.
