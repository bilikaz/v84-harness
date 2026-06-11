// Public API for the sessions feature. Components import from here. The
// side-effect imports wire the bus subscribers once (transcript/usage/streaming
// listeners, and the auto-naming service).
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

// Deleting a session must also abort its in-flight turn, or the stream keeps
// running (and writing) against a session that no longer exists. Composed here
// because store.ts must not depend on the driver. Sub-agent runs don't outlive
// their context: deleting a parent cascades to the children it spawned.
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
