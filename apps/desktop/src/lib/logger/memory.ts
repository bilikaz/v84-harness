// Memory sink — records entries for structural test assertions; children share the parent's entries array.
import { joinScope, type LogEntry, type Logger, type LogLevel } from "./types.ts";

export class MemoryLogger implements Logger {
  constructor(
    public readonly entries: LogEntry[] = [],
    private readonly scope = "",
  ) {}

  child(scope: string): Logger {
    return new MemoryLogger(this.entries, joinScope(this.scope, scope));
  }

  private push(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    this.entries.push({ level, scope: this.scope, event, ...(data ? { data } : {}) });
  }

  debug(event: string, data?: Record<string, unknown>): void {
    this.push("debug", event, data);
  }
  info(event: string, data?: Record<string, unknown>): void {
    this.push("info", event, data);
  }
  warn(event: string, data?: Record<string, unknown>): void {
    this.push("warn", event, data);
  }
  error(event: string, data?: Record<string, unknown>): void {
    this.push("error", event, data);
  }
}
