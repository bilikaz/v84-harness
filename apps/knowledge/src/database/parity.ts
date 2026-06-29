// Compile-time shape-parity guard (ADR-0071, conventions/canonical-shapes.md rule 6).
//
// The remote store maps explicit typed columns, so any field missing from a DTO is silently DROPPED on the
// round-trip (unlike the desktop's lossless blob stores). This guard asserts each server DTO covers the
// harness canonical field set. Adding a field to a harness entity? Add its name to the union below — this
// file won't compile until the DTO (hence schema + migration + repo + router) carries it. That failure IS
// the reminder. Server-managed extras (userId, createdAt/updatedAt) are intentionally not listed.

import type { ChatSession } from "../features/data/sessions/repo.ts";
import type { Message } from "../features/data/messages/repo.ts";
import type { Agent } from "../features/data/agents/repo.ts";
import type { Container } from "../features/data/containers/repo.ts";

// Errors if any listed key is not a key of the DTO.
type Covers<DTO, Keys extends keyof DTO> = [DTO, Keys];

// Harness SessionMeta — apps/desktop/src/core/sessions/persistence.ts
type _Session = Covers<
  ChatSession,
  "id" | "containerId" | "parentId" | "agentId" | "graphId" | "title" | "system" | "tools" | "usedTokens" | "lastModel" | "errorKind" | "bytes" | "unread"
>;
// Harness Message — apps/desktop/src/core/sessions/types.ts (browserWindowId is intentionally not persisted)
type _Message = Covers<
  Message,
  "id" | "sessionId" | "role" | "text" | "thinking" | "toolCalls" | "toolCallId" | "childSessionIds" | "images" | "videos" | "files" | "summary" | "hidden"
>;
// Harness Agent — apps/desktop/src/core/agents.ts (ownerPluginId is never persisted)
type _Agent = Covers<Agent, "id" | "name" | "description" | "system" | "user" | "workspace" | "tools">;
// Harness Container — apps/desktop/src/core/containers.ts
type _Container = Covers<Container, "id" | "type" | "name" | "permissions" | "config">;

export type ShapeParity = [_Session, _Message, _Agent, _Container];
