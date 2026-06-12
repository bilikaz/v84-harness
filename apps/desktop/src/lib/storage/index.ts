// Storage barrel + the ONE place backend selection happens: first create() to succeed wins, best-first (sqlite > idb > local).
import { errorMessage } from "../errors.ts";
import { rootLog } from "../logger/index.ts";
import type { Storage } from "./types.ts";
import { SqliteStorage } from "./sqlite.ts";
import { IdbStorage } from "./idb.ts";
import { LocalStorage } from "./local.ts";

export type { Storage } from "./types.ts";
export { SqliteStorage } from "./sqlite.ts";
export { IdbStorage } from "./idb.ts";
export { LocalStorage } from "./local.ts";

const log = rootLog.child("storage");

const CANDIDATES: { name: string; create: () => Promise<Storage> }[] = [
  { name: "sqlite", create: () => SqliteStorage.create() },
  { name: "idb", create: () => IdbStorage.create() },
  { name: "local", create: () => LocalStorage.create() },
];

async function detect(): Promise<Storage> {
  for (const c of CANDIDATES) {
    try {
      const storage = await c.create();
      log.info("selected", { backend: storage.name });
      return storage;
    } catch (e) {
      log.debug("skipped", { backend: c.name, reason: errorMessage(e) });
    }
  }
  // Reached only where localStorage itself is missing — nothing left to persist to.
  throw new Error("no storage backend available");
}

// Detection runs once per session; every consumer awaits the same selection.
let selected: Promise<Storage> | null = null;

export function detectStorage(): Promise<Storage> {
  if (!selected) selected = detect();
  return selected;
}
