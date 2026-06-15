// Storage barrel — the port + the engine. Platform backends live in web/ + electron/; the cross-platform
// RemoteStorage (network only) lives here. Each harness init selects one, wraps it in a StorageEngine, and
// puts it on ctx.storage.
export type { Storage } from "./types.ts";
export { StorageEngine } from "./engine.ts";
export { RemoteStorage, type AuthedFetch } from "./remoteStorage.ts";
