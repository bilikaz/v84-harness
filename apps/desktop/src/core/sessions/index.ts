// Public API for the sessions feature. The side-effect imports wire the bus subscribers once.
import "./listeners.ts";
import "./naming.ts";
import "./compaction.ts";

import { deleteSession as deleteSessionState, getSessions } from "./store.ts";
import { stopTurn } from "./driver.ts";

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
export { send, sendTo, runAgent, stopTurn, sessionToolModes } from "./driver.ts";
export type { TurnResult, SendOptions, Validate } from "./driver.ts";
export type { Session, Message, Role, MediaRef, FileAttachment, Tool, ToolCall } from "./types.ts";

// Abort the in-flight turn too, or the stream keeps writing to a deleted session. Composed here so
// store.ts need not depend on the driver. Deleting a parent cascades to the children it spawned.
export function deleteSession(id: string): void {
  for (const child of getSessions().filter((s) => s.parentId === id)) deleteSession(child.id);
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
  useChildRuns,
  useHydrated,
} from "./hooks.ts";
