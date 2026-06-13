// Console sink — debug gated by predicate; uses console.log so events show at DevTools default level.
import { joinScope, type Logger } from "./types.ts";

export class ConsoleLogger implements Logger {
  constructor(
    private readonly scope = "",
    private readonly opts: { isDebugEnabled?: () => boolean } = {},
  ) {}

  child(scope: string): Logger {
    return new ConsoleLogger(joinScope(this.scope, scope), this.opts);
  }

  private line(event: string): string {
    return this.scope ? `[${this.scope}] ${event}` : event;
  }

  debug(event: string, data?: Record<string, unknown>): void {
    const on = this.opts.isDebugEnabled?.() ?? import.meta.env.DEV;
    if (on) console.log(this.line(event), data ?? "");
  }
  info(event: string, data?: Record<string, unknown>): void {
    console.log(this.line(event), data ?? "");
  }
  warn(event: string, data?: Record<string, unknown>): void {
    console.warn(this.line(event), data ?? "");
  }
  error(event: string, data?: Record<string, unknown>): void {
    console.error(this.line(event), data ?? "");
  }
}
