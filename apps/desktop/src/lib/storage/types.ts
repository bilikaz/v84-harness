// The storage port — durable key→string persistence for state too large for
// localStorage. Modeled on the reviewer's Provider port (its ADR-0003): one
// interface, `<Impl>Storage` adapters with static async `create()` factories
// (constructors private + sync; create() does the probing and THROWS when the
// backend isn't available here), and detection in exactly one place
// (detectStorage in index.ts) that tries adapters best-first.
//
// Callers JSON-(de)serialize; the port speaks strings only.

export interface Storage {
  /** Which backend was selected — for logs ("sqlite" | "idb" | "local"). */
  readonly name: string;
  get(key: string): Promise<string | null>;
  /** Throws on failure — the caller decides whether that's fatal or a warning. */
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  /** All stored keys starting with `prefix` — for namespace deletes/GC. */
  keys(prefix: string): Promise<string[]>;
}
