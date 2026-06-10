// Chat domain types are defined by their producer, core/sessions/types.ts
// (producer defines, port re-exports — see ADR-0010 / the reviewer's ADR-0009).
// This shim keeps existing UI import sites stable; new code may import from
// core/sessions directly.
export type {
  Role,
  MediaRef,
  FileAttachment,
  Message,
  Tool,
  Session,
  ToolCall,
} from "../core/sessions/types.ts";
