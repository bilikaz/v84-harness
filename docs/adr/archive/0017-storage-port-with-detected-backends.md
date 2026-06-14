# ADR-0017: Storage port with detected backends (SQLite > IndexedDB > localStorage)

Status: accepted
Date: 2026-06-10
Extends: [ADR-0012](0012-sessions-dual-tier-persistence.md) (resolves its "host-dependent future")

## Context

ADR-0012 left the durable tier host-dependent: IndexedDB everywhere, with a
hand-waved "SQLite later, Electron-only". The desktop build deserves the better
tier now — no browser quota, a real file under `userData`, queryable later —
but the web build can never have SQLite, and persistence code in the sessions
store must not care which host it's on.

## Decision

A storage **port**, deliberately modeled on the reviewer project's Provider
port (its ADR-0003):

- **One interface** — `Storage { name, get, set, del }` in
  `lib/storage/types.ts`; async key→string, callers JSON-serialize.
- **Adapters are `<Impl>Storage` classes** with **static async `create()`**
  factories: constructors private and synchronous; `create()` does the probing
  and **throws where the backend isn't available**:
  - `SqliteStorage` — thin client over the bridge's `harness.storage` IPC
    surface. The database lives in main: Node's built-in `node:sqlite`
    (`DatabaseSync`, WAL, one `kv` table) under `app.getPath("userData")` —
    no native dependency, nothing to rebuild against Electron. Loaded
    fail-soft in main: if this Electron's Node lacks `node:sqlite`,
    `available()` is false and detection falls through.
  - `IdbStorage` — the web tier (the previous `lib/idb.ts`, now an adapter).
  - `LocalStorage` — last resort (~5 MB), so detection always returns something.
- **Detection in one place** — `detectStorage()` in `lib/storage/index.ts`
  tries adapters best-first (sqlite → idb → local), memoizes the selection,
  and logs `storage selected {backend}`.
- **Migration on tier upgrade**: when the selected tier is empty, the sessions
  store reads IndexedDB once and seeds the new tier (same legacy-key recipe as
  store `load()` migrations) — a desktop user's existing IDB history survives
  the switch to SQLite.
- localStorage keeps its separate ADR-0012 job as the synchronous first-paint
  cache; the port selects only the durable tier.

## Consequences

- The sessions store is host-blind: `persist()` and hydration talk to the port;
  adding a backend (encrypted file, remote sync) is one adapter + one candidate
  row.
- Desktop loses the IDB quota ceiling — the growth/pruning item in
  [README.md](README.md) becomes less urgent on desktop, but remains real for
  web and for localStorage-cache overflow.
- `tools.cancel`-style caveat applies to availability: `available()` is probed
  once at detection; a SQLite failure mid-session surfaces as `persist_failed`
  warnings, not a re-detection.
