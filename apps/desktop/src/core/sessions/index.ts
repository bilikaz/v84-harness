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
  getSessionsForContainer,
} from "./store.ts";
export { SessionEngine } from "./engine.ts";
export type { TurnResult, SendOptions, OutputValidator } from "./engine.ts";
export type { Session, Message, Role, Image, Video, FileAttachment, Attachments, SessionTool, ToolCallRequest } from "./types.ts";
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
