// IndexedDB adapter (web tier).
import type { Storage } from "../core/storage/types.ts";

const DB_NAME = "v84-harness";
const STORE = "kv";

export class IdbStorage implements Storage {
  readonly name = "idb";

  private constructor(private readonly db: IDBDatabase) {}

  static async create(): Promise<IdbStorage> {
    if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new IdbStorage(db);
  }

  get(key: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const r = this.db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      r.onsuccess = () => resolve((r.result as string | undefined) ?? null);
      r.onerror = () => reject(r.error);
    });
  }

  set(key: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  del(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  keys(prefix: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const r = this.db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      r.onsuccess = () => resolve((r.result as string[]).filter((k) => k.startsWith(prefix)));
      r.onerror = () => reject(r.error);
    });
  }
}
