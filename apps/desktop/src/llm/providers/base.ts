// Provider base — every provider IS one of these.

import type { CallContext, ResponseHandler, LLMConfig, Provider } from "../types.ts";
import { trimBase } from "../../lib/format.ts";

export interface RequestOpts {
  what: string;
  method?: "GET" | "POST";
  json?: unknown;
  form?: FormData;
}

export abstract class BaseProvider implements Provider {
  constructor(
    protected target: LLMConfig,
    protected callCtx: CallContext,
  ) {
    this.init();
  }

  protected init(): void {}

  abstract call<T>(handler: ResponseHandler<T>): Promise<T>;
  abstract defaultHandler(): ResponseHandler<unknown>;

  protected async request(path: string, opts: RequestOpts): Promise<Response> {
    const { provider } = this.target;
    const res = await fetch(`${trimBase(provider.baseUrl)}${path}`, {
      method: opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET"),
      signal: this.callCtx.signal,
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

  protected prompt(): string {
    const { messages } = this.callCtx;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && messages[i].content) return messages[i].content;
    }
    return "";
  }
}
