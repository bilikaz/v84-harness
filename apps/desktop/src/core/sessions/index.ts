// Public API for the sessions feature. The listeners side-effect import wires the store's bus subscribers once;
// the naming/compaction triggers are owned by SessionEngine (they need ctx). The engine itself lives on ctx.sessions.
import "./listeners.ts";

export {
  isFull,
  contextLimit,
  setActive,
  createSession,
  newSession,
  renameSession,
  unlinkAgent,
  getSessionsForWorkspace,
} from "./store.ts";
export { SessionEngine } from "./engine.ts";
export type { TurnResult, SendOptions, Validate } from "./engine.ts";
export type { Session, Message, Role, MediaRef, FileAttachment, Tool, ToolCall } from "./types.ts";
export {
  useSessions,
  useActiveId,
  useActiveSession,
  useStreaming,
  useCompacting,
  useStreamingIds,
  useChildRuns,
  useHydrated,
} from "./hooks.ts";
