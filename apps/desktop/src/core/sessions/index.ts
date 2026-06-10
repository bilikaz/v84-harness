// Public API for the sessions feature. Components import from here. The
// side-effect imports wire the bus subscribers once (transcript/usage/streaming
// listeners, and the auto-naming service).
import "./listeners.ts";
import "./naming.ts";
import "./compaction.ts";

import { deleteSession as deleteSessionState } from "./store.ts";
import { stopTurn } from "./driver.ts";

export {
  isFull,
  contextLimit,
  setActive,
  createSession,
  newSession,
  renameSession,
  getSessionsForWorkspace,
} from "./store.ts";
export { send, runAgent, stopTurn } from "./driver.ts";
export type { Session, Message, Role, Step, StepStatus, MediaRef, FileAttachment, Tool, ToolCall } from "./types.ts";

// Deleting a session must also abort its in-flight turn, or the stream keeps
// running (and writing) against a session that no longer exists. Composed here
// because store.ts must not depend on the driver.
export function deleteSession(id: string): void {
  stopTurn(id);
  deleteSessionState(id);
}
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
