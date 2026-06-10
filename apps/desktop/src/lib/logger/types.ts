// Logger port (conventions/logging.md): structured events with dot-scoped
// children. Components depend on this interface; sinks are adapters (console
// for DevTools, memory for tests). Events are dot-scoped snake_case with a flat
// data object — never values interpolated into the event string.
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  scope: string;
  event: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

// The scope-join format every sink must reproduce identically (the essential-
// duplication case from conventions/consolidation.md — defined once, here).
export function joinScope(parent: string, scope: string): string {
  return parent ? `${parent}.${scope}` : scope;
}
