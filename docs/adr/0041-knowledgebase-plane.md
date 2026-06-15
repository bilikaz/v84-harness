# ADR-0041: Knowledgebase — all-OpenSearch, nested chunks, hybrid sparse+dense, fire-and-forget ingest

Status: Accepted
Date: 2026-06-15
Part of [ADR-0040](0040-knowledge-remote-service.md). The harness-side memory tools are [ADR-0039](0039-account-local-store-and-connection-lifecycle.md)'s renderer tier.

## Context

The agent needs a durable memory it can write and recall: per-user private notes
plus a shared company corpus, queried both lexically (exact / regex) and
semantically. Decided up front: keep it ALL in OpenSearch — no split with MariaDB
— so a record and its vectors live and die together, and one query hits both
signals.

## Decision

One OpenSearch index `memories`, **one document per record**, with its **chunks
nested inside it**.

- **Shape.** Record fields: `user_id`, `scope` (`shared | private`), `category`
  (a tag on the shared corpus; permission-gating by category is later), `content`
  (stored for GET + re-ingest, `index: false` — search runs on the chunks, not the
  whole record), `status` (`ingesting | ready | failed`), `created_at`, and `chunks`
  (nested: `idx`, `content` `text` analyzed by a **`folding` analyzer** — `standard`
  tokenizer + `lowercase` + `asciifolding`, so matching is case- and
  accent-insensitive: `ąčęėįšųūž → aceeisuuz` on both index and query — and
  `embedding` `knn_vector` of the configured dim, hnsw / lucene / cosinesimil).
  Deleting the record drops its chunks; a hit returns the record plus the matched
  chunk via `inner_hits`.
- **Hybrid search, both legs AI-supplied, both over the chunks.** The agent
  provides a keyword list (`keywords`) and/or a natural-language related phrase
  (`phrase`). `keywords` → nested full-text **`match`** on the folding-analyzed
  `chunks.content` (tokenized → multi-word works, BM25-ranked, accent-insensitive);
  `phrase` → embed → nested `knn` over `chunks.embedding`. Both are nested queries
  on `chunks` with NAMED `inner_hits` (distinct names — two nested queries on one
  path collide otherwise), so each leg returns the matching chunk as a snippet. They
  ride one `bool.should` (`minimum_should_match: 1`) under a **visibility filter**
  (`shared ∪ own-private`, optionally narrowed by scope / category). Scores aren't
  normalized across the two signals — a hybrid-search pipeline can layer on later.
  (Regexp was tried first and rejected: on tokenized chunk text it can't match
  across token boundaries — a multi-word pattern never matches — and OpenSearch
  `regexp` is whole-field anchored, so a bare keyword matches nothing.)
- **Fire-and-forget ingest.** `POST /kb` indexes the record immediately
  (`status: ingesting`, no chunks) and emits `kb/record.created`; an Inngest
  function (`retries: 3`) chunks (≈2000 chars, 10% overlap, both configurable),
  embeds (TEI passage prefix), writes the nested chunks, and flips
  `status: ready`. The writer never waits on the encoder, and later importers can
  be added as more event sources.
- **CRUD.** `POST /kb/search` → snippets + id (NOT full content); `GET /kb/:id` →
  the full record; `PUT /kb/:id` → edit content, reset to `ingesting`, re-emit;
  `DELETE /kb/:id` → drop the doc. All visibility-scoped to the caller.
- **A downed dependency is a typed 503, and search degrades.** The encoder /
  OpenSearch being unreachable throws `ServiceDownError`; the kb router maps it to
  503 with a clear message the agent relays. Search degrades: if the encoder is
  down but a `keywords` leg exists, it runs that alone and returns a `note`; only a
  phrase-only query with the encoder down errors out. A save never needs the
  encoder — the record persists and Inngest retries the embed.

## Consequences

- One store, one lifecycle: there is no cross-store consistency to maintain
  between a record and its vectors.
- The agent drives retrieval precisely — it picks the regex AND the semantic
  phrasing per query, getting lexical exactness and fuzzy recall in one call.
- Ingest latency is off the write path, and a transient encoder outage self-heals
  via retries (records sit at `ingesting`). Gap noted: a record whose retries are
  exhausted stays `ingesting` — no `failed` flip yet; an Inngest `onFailure`
  handler is the follow-up.
- The 503 / degradation contract is the harness's signal to tell the user "the
  memory service is down" instead of failing opaquely (see the error-handling
  convention amendment this session).
