// Storage barrel — no auto-detect; each harness init picks the right backend.
export type { Storage } from "./types.ts";
export { SqliteStorage } from "./sqlite.ts";
export { IdbStorage } from "./idb.ts";
export { LocalStorage } from "./local.ts";
