// Storage barrel — the port + the engine. Backends live in their platform folders (web/, electron/); each
// harness init selects one, wraps it in a StorageEngine, and puts it on ctx.storage.
export type { Storage } from "./types.ts";
export { StorageEngine } from "./engine.ts";
