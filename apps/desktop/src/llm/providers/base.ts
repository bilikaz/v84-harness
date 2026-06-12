// The provider base — every provider IS one of these: constructed by the
// client's factory with its MODEL DATA (the CallTarget) and the call's
// CONTEXT wired into the instance, one call(handler) that owns the whole
// wire side (requests, streaming, polling, time) and hands the handler the
// interaction, and a defaultHandler() naming the shape the provider
// naturally produces (used when the caller brings none). Subclasses never
// override the constructor — init() is the hook for the few that need extra
// setup. The wire plumbing every provider shares lives here too. (The text
// providers ride transport.ts — sseRequest + retry — instead of request().)

import type { CallContext, ResponseHandler, CallTarget, Provider } from "../types.ts";
import { trimBase } from "../../lib/format.ts";

export interface RequestOpts {
  what: string; // names the call in the error message
  method?: "GET" | "POST";
  json?: unknown;
  form?: FormData;
}

export abstract class BaseProvider implements Provider {
  constructor(
    protected target: CallTarget,
    protected ctx: CallContext,
  ) {
    this.init();
  }

  // Per-class extra setup — a no-op for most providers.
  protected init(): void {}

  abstract call<T>(handler: ResponseHandler<T>): Promise<T>;
  abstract defaultHandler(): ResponseHandler<unknown>;

  // Raw HTTP against the target's provider: base trim + auth + body encoding
  // + status check with the response body in the error. Cancellation rides
  // the wired ctx.
  protected async request(path: string, opts: RequestOpts): Promise<Response> {
    const { provider } = this.target;
    const res = await fetch(`${trimBase(provider.baseUrl)}${path}`, {
      method: opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET"),
      signal: this.ctx.signal,
      headers: {
        ...(opts.json !== undefined ? { "content-type": "application/json" } : {}),
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.form,
    });
    if (!res.ok) {
      throw new Error(`${opts.what} returned ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`);
    }
    return res;
  }

  // The conversation flattened for single-prompt endpoints — the newest user
  // message's content (generation servers take one prompt, not a thread).
  protected prompt(): string {
    const { messages } = this.ctx;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && messages[i].content) return messages[i].content;
    }
    return "";
  }
}
