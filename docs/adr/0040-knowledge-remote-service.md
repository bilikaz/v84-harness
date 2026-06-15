# ADR-0040: `apps/knowledge` — the remote service

Status: Accepted
Date: 2026-06-15
New area. Companion to [ADR-0038](0038-storage-backend-swappable-at-runtime.md) (the remote storage backend) and [ADR-0041](0041-knowledgebase-plane.md) (the knowledgebase). Auth model cribbed from the legal-help service; folder structure from the task-builder api.

## Context

The connected mode ([ADR-0038](0038-storage-backend-swappable-at-runtime.md) /
[ADR-0039](0039-account-local-store-and-connection-lifecycle.md)) needs a server:
per-user durable storage (the `/data` backend behind `RemoteStorage`), the
knowledgebase ([ADR-0041](0041-knowledgebase-plane.md)), and auth. The harness
repo was single-app (`apps/desktop`); this adds the second app. The framing
up front: reuse the proven Hono + Traefik + MariaDB + Inngest stack rather than
invent one.

## Decision

A new `apps/knowledge` Hono service (Node, run strip-only — no TS parameter
properties; explicit field assignment), structured as filesystem-as-registry
([conventions/module-registries](../conventions/module-registries.md)) and brought
up by a dev `docker/` compose.

- **Filesystem-as-registry.** Each feature is `src/features/<x>/register.ts`
  calling `r.mount(path, router)` and/or `r.inngest(fn)`; `core/registry.ts` scans
  them, and `http/app.ts` mounts the routers — plus `/health` and the
  signature-gated `/inngest` webhook. Adding a feature = adding a folder.
- **Features.** `data` (the harness `/data` kv backend — key/value rows + prefix
  listing; backs `RemoteStorage`), `auth` + `sessions` (below), and `kb`
  ([ADR-0041](0041-knowledgebase-plane.md)).
- **Auth = access JWT + rotating refresh sessions.**
  `/auth/register|login|refresh|logout`; a short-lived HS256 access JWT
  (`hono/jwt`) carrying `user_id`; an opaque refresh token `<sessionId>.<secret>`
  stored hashed in a `sessions` table, rotated on every refresh, one row per
  device (`X-Device-Name`) — multi-device, individually revocable. A `requireAuth`
  middleware gates everything but `/health`, `/auth/*`, and `/inngest`.
- **Relational persistence.** kysely + mysql2 over MariaDB 11; a
  `schema_migrations` runner applies `migrations/*.sql` at boot. The kv (`/data`)
  and chats live in MariaDB; the knowledgebase does NOT
  ([ADR-0041](0041-knowledgebase-plane.md) — it is all OpenSearch).
- **The `/inngest` webhook is signature-gated** (`INNGEST_SIGNING_KEY`), outside
  `requireAuth` — only Inngest can invoke the ingest functions.
- **Dev stack** (`docker/dev`, compose project `v84`): Traefik (`*.localhost`),
  MariaDB + Adminer, OpenSearch + Dashboards, the TEI embedding server, Inngest,
  and the knowledge service itself (source bind-mounted, hot reload).

## Consequences

- The monorepo is now two apps; ARCHITECTURE.md grows a second hub section and a
  new `architecture/knowledge.md`.
- `RemoteStorage` and the memory tools have a real backend; the connected mode is
  end-to-end.
- Reusing the task-builder / legal-help shapes kept the auth + registry decisions
  off the table — they are adopted, not re-litigated (cite, don't re-derive).
- Node strip-only is a standing constraint for this app (no parameter properties)
  — already recorded, reaffirmed here so the next contributor doesn't reach for
  them.
