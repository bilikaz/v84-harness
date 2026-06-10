// Public face of the logger (a barrel) plus the app's root logger instance.
// Modules derive their scope: `const log = rootLog.child("session.naming")`.
// The LLM layer keeps its own debug-gated logger in providers/debug.ts.
import { ConsoleLogger } from "./console.ts";

export type { Logger, LogEntry, LogLevel } from "./types.ts";
export { joinScope } from "./types.ts";
export { ConsoleLogger } from "./console.ts";
export { MemoryLogger } from "./memory.ts";

export const rootLog = new ConsoleLogger();
