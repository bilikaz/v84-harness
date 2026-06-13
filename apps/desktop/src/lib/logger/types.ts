// Logger port: events are dot-scoped snake_case with a flat data object — never values interpolated into the event string.
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

export function joinScope(parent: string, scope: string): string {
  return parent ? `${parent}.${scope}` : scope;
}
