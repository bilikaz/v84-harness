// Logger barrel — modules derive their scope via `rootLog.child(...)`.
import { ConsoleLogger } from "./console.ts";

export type { Logger, LogEntry, LogLevel } from "./types.ts";
export { joinScope } from "./types.ts";
export { ConsoleLogger } from "./console.ts";
export { MemoryLogger } from "./memory.ts";

export const rootLog = new ConsoleLogger();
