// Public API for the sessions feature. Components import from here. The
// side-effect imports wire the bus subscribers once (transcript/usage/streaming
// listeners, and the auto-naming service).
import "./listeners.ts";
import "./naming.ts";
import "./compaction.ts";

export {
  isFull,
  contextLimit,
  setActive,
  createSession,
  newSession,
  renameSession,
  deleteSession,
  getSessionsForWorkspace,
} from "./store.ts";
export { send, runAgent } from "./driver.ts";
export { compact } from "./compaction.ts";
export {
  useSessions,
  useActiveId,
  useActiveSession,
  useStreaming,
  useCompacting,
  useStreamingIds,
  useHydrated,
} from "./hooks.ts";
