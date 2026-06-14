// The storage port — durable key→string persistence; callers JSON-(de)serialize.

export interface Storage {
  readonly name: string;
  get(key: string): Promise<string | null>;
  /** Throws on failure — caller decides severity. */
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}
