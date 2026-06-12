// The storage port — durable key→string persistence; callers JSON-(de)serialize, and an adapter's create() THROWS when its backend is unavailable.

export interface Storage {
  readonly name: string;
  get(key: string): Promise<string | null>;
  /** Throws on failure — the caller decides whether that's fatal or a warning. */
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}
