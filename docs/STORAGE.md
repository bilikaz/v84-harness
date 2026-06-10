# Storage map — what lives where

The "class diagram" of the sessions state: durable key scheme, in-memory state,
and the accessor surface. Part of the map layer (present tense, updated with the
code). Decisions behind the shapes:
[ADR-0017](adr/0017-storage-port-with-detected-backends.md) (port + detection),
[ADR-0020](adr/0020-persist-at-turn-completion.md) (when writes happen),
[ADR-0021](adr/0021-granular-session-persistence.md) (granular keys).

## Durable tier — key scheme

One detected backend (SQLite > IndexedDB > localStorage) behind the
`Storage { get, set, del, keys }` port. Every key below lives in that one
backend; the prefixes are the "tables":

```mermaid
erDiagram
    INDEX ||--o{ MSGS : "one row per session"
    MSGS ||--o{ MEDIA : "media: refs point to blobs"

    INDEX {
        string key "v84-harness:sessions:index"
        string activeId
        SessionMeta_array sessions "metas only - no messages"
    }
    MSGS {
        string key "v84-harness:sessions:msgs:<sid>"
        Message_array messages "media URLs replaced by media:<id>"
    }
    MEDIA {
        string key "v84-harness:media:<sid>:<id>"
        string value "one data: URL - written ONCE at first persist"
    }
```

| Key | Shape | Written when | Read when |
| --- | --- | --- | --- |
| `sessions:index` | `SessionsIndex { activeId, sessions: SessionMeta[] }` | meta changes (create/delete/rename/switch/title) + every `persistSession` | boot |
| `sessions:msgs:<sid>` | `Message[]` (media as `media:<id>` refs) | `turn:end` for the turn's session; compaction replace | boot (active session) + `ensureLoaded` on first open |
| `media:<sid>:<id>` | one `data:` URL | once, when the ref is first persisted (id stamp = already stored) | `loadMessages` reinflation |

GC: `saveMessages` deletes this session's blobs not referenced by any stored
message; `deleteSessionData` removes the msgs row + all `media:<sid>:*`.

## Shapes

```mermaid
classDiagram
    class SessionsIndex {
        activeId: string
        sessions: SessionMeta[]
    }
    class SessionMeta {
        id: string
        title: string
        system: string
        workspaceId: string | null
        tools: Tool[]
        steps: Step[]
        usedTokens?: number  «snapshot - latest request, ADR-0018-meter-note»
        unread?: boolean
        bytes?: number  «persisted footprint, set on persist/load»
    }
    class Session {
        messages: Message[]
        loaded?: boolean  «false until lazy-loaded - in-memory only»
    }
    class Message {
        id: string
        role: user | assistant | tool
        text: string
        thinking?: string
        images?: ImageRef[]
        video?: ImageRef[]
        files?: FileAttachment[]
        toolCalls?: ToolCall[]
        toolCallId?: string
        summary?: boolean
        hidden?: boolean
    }
    class ImageRef {
        url: string  «data: in memory, media:id when stored»
        mime?: string
        name?: string
        id?: string  «stamped at first persist = blob exists»
    }
    SessionMeta <|-- Session : + messages, loaded
    SessionsIndex o-- SessionMeta
    Session o-- Message
    Message o-- ImageRef
```

`SessionMeta` is exactly `Session` minus `messages`/`loaded` (`toMeta()` in
persistence.ts). `bytes` ≈ stored messages JSON + live media blob lengths.

## In-memory state (`core/sessions/store.ts`, module singletons)

| Variable | Type | Role |
| --- | --- | --- |
| `sessions` | `Session[]` | the profile; untouched message objects keep reference identity (ADR-0019) |
| `activeId` | `string` | selected session |
| `streamingIds` | `Set<string>` | sessions with a live turn (fresh Set per change) |
| `compactingIds` | `Set<string>` | sessions being summarized |
| `hydrated` | `boolean` | durable-tier boot read finished |
| `loading` | `Map<sid, Promise>` | in-flight lazy loads (deduped) |

## Accessor surface

**Selectors** (plain reads — components never call these directly, see hooks):
`getSessions`, `getActive`, `getActiveId`, `getSession(id)`,
`getSessionsForWorkspace`, `getStreamingIds`, `getStreaming`,
`getCompactingIds`, `getCompacting`, `getHydrated`.

**Hooks** (`hooks.ts` — the only state access components use):
`useSessions`, `useActiveId`, `useActiveSession`, `useStreaming`,
`useCompacting`, `useStreamingIds`, `useHydrated`.

**Commands** (user-facing changes; each persists what it touched):
`setActive` (→ `ensureLoaded` + index), `createSession`/`newSession` (index),
`renameSession`/`setTitle` (index), `deleteSession` (rows + blobs + index),
`replaceWithSummary` (session rows, GCs blobs).

**Persistence** (fire-and-forget, failures are logged warnings):
`persistIndex()` — the small index; `persistSession(sid)` — one session's rows
+ blobs + index, refuses unloaded shells; `ensureLoaded(sid)` — lazy load,
shared in-flight.

**Mutators** (called by listeners during a turn; in-memory only — durability
comes from `persistSession` at `turn:end`): `pushTurn`, `appendToLast`,
`setLastToolCalls`, `pushToolResult`, `pushMediaFeedback`, `pushAssistant`,
`pushHeal`, `resetLast`, `setUsage`, `markUnread`, `setStreaming`,
`setCompacting`.

## Lifecycle

```mermaid
sequenceDiagram
    participant UI
    participant Store as store.ts
    participant P as persistence.ts
    participant D as durable tier

    Note over Store,D: boot
    Store->>P: loadIndex (importFromIdb on first SQLite run)
    P->>D: get index
    Store->>P: loadMessages(activeId)
    P->>D: get msgs + media blobs
    Store-->>UI: hydrated=true, notify

    Note over UI,D: switch session
    UI->>Store: setActive(sid)
    Store->>P: loadMessages(sid) «first open only»
    Store->>P: saveIndex «activeId changed»

    Note over UI,D: turn completes (turn:end)
    Store->>P: saveMessages(sid) «new media → one blob write each»
    P->>D: set msgs row, set new blobs, GC orphans
    Store->>P: saveIndex «usedTokens, unread, bytes»
```

Other config stores (`settings`, `media`, `agents`, `workspaces`, ui state) are
small `createStore` instances persisting whole-value to localStorage — they are
NOT part of this scheme and don't need to be (each is a few KB).
