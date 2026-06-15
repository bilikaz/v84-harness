# The knowledge service (`apps/knowledge`)

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).
([ADR-0040](../adr/0040-knowledge-remote-service.md),
[ADR-0041](../adr/0041-knowledgebase-plane.md); the harness side that consumes it is
[ADR-0038](../adr/0038-storage-backend-swappable-at-runtime.md) /
[ADR-0039](../adr/0039-account-local-store-and-connection-lifecycle.md).)

The remote backend the harness talks to when an account is connected: per-user
durable storage (`/data`, behind `RemoteStorage`), the knowledgebase (`/kb`), and
auth. A Hono service on Node — MariaDB for relational data, OpenSearch for the
knowledgebase, Inngest for async ingest, TEI for embeddings. Node runs it
strip-only (no TS parameter properties; fields are assigned explicitly).

## Layout — the filesystem is the registry

Each feature is a folder with a `register.ts` that declares what it contributes;
`core/registry.ts` scans them and `http/app.ts` mounts the result. Adding a
feature is adding a folder ([conventions/module-registries](../conventions/module-registries.md)).

```ts
// features/<x>/register.ts
export default (r: Registry) => {
  r.mount("/kb", kbRouter);            // an HTTP router
  r.inngest(kbIngest);                 // an async function (optional)
};
```

| Path | Role |
|------|------|
| `src/server.ts` | Entry — runs migrations, builds the app, listens |
| `src/http/app.ts` | Builds the Hono app: CORS, `/health`, the signature-gated `/inngest` webhook, and every scanned router under `requireAuth` |
| `src/core/registry.ts` | Scans `features/*/register.ts` → `{ routers, functions }` |
| `src/core/feature.ts` | The `Registry` type (`mount` + `inngest`) |
| `src/config/config.ts` | One typed env read point (DB, OpenSearch, embedding, auth, Inngest) |
| `src/database/` | kysely + mysql2 client (`client.ts`), the schema/migration runner (`schema.ts`), repos (`repos.ts`) |
| `src/features/data/` | The harness `/data` kv backend — key/value rows + prefix listing; backs `RemoteStorage` |
| `src/features/auth/` | `/auth/register\|login\|refresh\|logout`, the JWT middleware, the password + token service |
| `src/features/sessions/` | Device sessions (one row per refresh token / device) |
| `src/features/kb/` | The knowledgebase — `client.ts` (OpenSearch + embeddings), `router.ts` (CRUD), `ingest.ts` (the Inngest function) |
| `src/inngest/client.ts` | The Inngest client (`id: "knowledge"`) |
| `src/lib/errors.ts` | `errorMessage` + `ServiceDownError` (the 503 marker) |

## Auth — access JWT + rotating refresh sessions

`/auth/register` and `/auth/login` return a short-lived **access JWT** (HS256,
`hono/jwt`, carrying `user_id`) plus an opaque **refresh token**
`<sessionId>.<secret>`. The secret is stored hashed in a `sessions` row, one row
per device (the client sends `X-Device-Name`) — so sessions are multi-device and
individually revocable. `/auth/refresh` verifies + **rotates** the refresh token
(new secret, same row); `/auth/logout` drops the row. A `requireAuth` middleware
puts `user_id` on the context and gates everything except `/health`, `/auth/*`,
and `/inngest`.

The harness side mirrors this in `core/account.ts`: `authedFetch` injects the
access token and refreshes once on a 401 ([ADR-0039](../adr/0039-account-local-store-and-connection-lifecycle.md)).

## `/data` — the remote storage backend

A flat key/value table (`GET`/`PUT`/`DELETE /data/:key`, `GET /data?prefix=`),
scoped to the caller's `user_id`. It implements exactly the harness `Storage` port
([storage.md](storage.md)) so `RemoteStorage` is a thin HTTP shim over it — which
is why, when connected, *all* harness state (settings, agents, workspaces,
sessions, media blobs) lives here, keyed by the same `v84-harness:…` strings.

## The knowledgebase plane (`/kb`)

Entirely in OpenSearch — one index `memories`, **one document per record**, with
its **chunks nested inside it** ([ADR-0041](../adr/0041-knowledgebase-plane.md)).

```
memories (doc = record)
  user_id, scope (shared|private), category, status (ingesting|ready|failed), created_at
  content        — type: wildcard            (the SPARSE / regex side)
  chunks []      — type: nested
    idx, content (text), embedding (knn_vector, dim from config, hnsw/lucene/cosinesimil)
```

**Hybrid search**, both legs supplied by the agent. `sparse` (a regex) →
`regexp` on `content`; `dense` (natural language) → embed → nested `knn` over
`chunks.embedding`. Both ride one `bool.should` (`minimum_should_match: 1`) under a
**visibility filter** (`shared ∪ own-private`, optionally narrowed by
scope/category). A hit returns the record + its matched chunk via `inner_hits`.

**Ingestion is fire-and-forget.** `POST /kb` indexes the record immediately
(`status: ingesting`, no chunks) and emits `kb/record.created`; the Inngest
function (`retries: 3`) chunks (≈2000 chars, 10% overlap — configurable), embeds
each chunk (TEI, passage prefix), writes the nested chunks, and flips
`status: ready`. The writer never blocks on the encoder, and more event sources
(importers) can be added later.

**CRUD**: `POST /kb/search` → snippets + id (not full content); `GET /kb/:id` →
the full record; `PUT /kb/:id` → edit + reset to `ingesting` + re-emit;
`DELETE /kb/:id` → drop the doc (chunks go with it). All visibility-scoped.

**A downed dependency is a typed 503, and search degrades**
([conventions/error-handling](../conventions/error-handling.md) rule 7). The
encoder/OpenSearch being unreachable throws `ServiceDownError` → `kbRouter.onError`
maps it to 503 with a relayable message. Search degrades: encoder down but a regex
leg present → run the regex alone + return a `note`; dense-only with the encoder
down → 503. A save never needs the encoder (the record persists; the embed
retries). Gap: a record whose retries are exhausted stays `ingesting` — no
`failed` flip yet (an Inngest `onFailure` is the follow-up).

The harness-side tools (`SaveMemory`/`SearchMemory`/`GetMemory`/`EditMemory`/
`DeleteMemory`) run in the renderer tier and relay these messages — see
[tools.md](tools.md) and [ADR-0039](../adr/0039-account-local-store-and-connection-lifecycle.md).

## Dev stack (`docker/dev`)

A compose project named `v84`, routed through Traefik on `*.localhost`:

| Service | Role |
|---------|------|
| `traefik` | Reverse proxy — `knowledge.localhost`, `adminer.localhost`, `dashboards.localhost`, `inngest.localhost`, `traefik.localhost` |
| `db` (MariaDB 11) + `adminer` | Relational data + browser |
| `knowledge` | This service (source bind-mounted, hot reload) |
| `opensearch` + `dashboards` | The knowledgebase index + its Discover/Dev-Tools viewer |
| `embeddings` (TEI) | OpenAI-compatible `/v1/embeddings`; the model is config (first boot downloads it) |
| `inngest` | Async ingest orchestration; the `/inngest` webhook is signature-gated |

Anonymous `node_modules` volumes shadow a rebuilt image — refresh with
`docker compose up -d --build --renew-anon-volumes` after a dependency change.
Swapping the embedding model means swapping `EMBED_DIM` + the e5 query/passage
prefixes together: the index dimension is fixed at create time.
