// The abstract text provider — the shared chat flow every text/<type>.ts
// Provider extends: transport retry (withRetry re-sends the step on lost
// connections / 429 / 5xx, emitting "retry" so consumers discard partial
// output), inline-think demuxing, and handing the handler the LIVE event
// stream — text deltas, thinking, tool calls, usage, retries — so a streaming
// handler can land them where they need to go as they arrive. The handler's
// return value is the call's return value. Validation heal stays one level up
// (the client's cycle). Subclasses are pure wire-format mappers: same
// ChatMessage/ToolSpec in, same StreamEvent out (`stream`).

import type { ResponseHandler, StreamEvent, ToolSpec } from "../../types.ts";
import { withRetry } from "../../transport.ts";
import { BaseProvider } from "../base.ts";
import { textHandler } from "../../responseHandlers/text.ts";

export abstract class BaseTextProvider extends BaseProvider {
  protected abstract stream(): AsyncGenerator<StreamEvent>;

  call<T>(handler: ResponseHandler<T>): Promise<T> {
    return handler.handle({
      kind: "chat",
      events: this.demuxInlineThink(withRetry(() => this.stream(), this.ctx.signal)),
    });
  }

  defaultHandler(): ResponseHandler<unknown> {
    return textHandler();
  }

  protected tools(): ToolSpec[] | undefined {
    return this.ctx.tools?.length ? this.ctx.tools : undefined;
  }

  // Some models (DeepSeek-R1 distills, Qwen, local llama.cpp builds) emit
  // reasoning as inline `<think>…</think>` in the text channel rather than via
  // a reasoning field. These split the text stream into text/thinking events,
  // holding back any trailing chunk that could be a partial tag until the
  // next delta.
  private static readonly OPEN_TAGS = ["<think>", "<thinking>"];
  private static readonly CLOSE_TAGS = ["</think>", "</thinking>"];

  private static couldBePrefix(s: string, tags: readonly string[]): boolean {
    for (const t of tags) if (t.startsWith(s)) return true;
    return false;
  }

  protected async *demuxInlineThink(src: AsyncGenerator<StreamEvent>): AsyncGenerator<StreamEvent> {
    let inThink = false;
    let pending = "";

    function* processText(delta: string): Generator<StreamEvent> {
      let buf = pending + delta;
      pending = "";
      while (buf.length) {
        const tags = inThink ? BaseTextProvider.CLOSE_TAGS : BaseTextProvider.OPEN_TAGS;
        const passThroughType: "text" | "thinking" = inThink ? "thinking" : "text";
        const idx = buf.indexOf("<");
        if (idx === -1) {
          yield { type: passThroughType, delta: buf };
          return;
        }
        if (idx > 0) {
          yield { type: passThroughType, delta: buf.slice(0, idx) };
          buf = buf.slice(idx);
        }
        let matched: string | null = null;
        for (const t of tags) {
          if (buf.startsWith(t)) {
            matched = t;
            break;
          }
        }
        if (matched) {
          buf = buf.slice(matched.length);
          inThink = !inThink;
          continue;
        }
        if (BaseTextProvider.couldBePrefix(buf, tags)) {
          pending = buf;
          return;
        }
        yield { type: passThroughType, delta: buf[0]! };
        buf = buf.slice(1);
      }
    }

    for await (const evt of src) {
      if (evt.type === "text") {
        yield* processText(evt.delta);
      } else if (evt.type === "retry") {
        // The attempt's output is being discarded — drop our half-parsed state too.
        inThink = false;
        pending = "";
        yield evt;
      } else if (evt.type === "done") {
        if (pending) {
          yield { type: inThink ? "thinking" : "text", delta: pending };
          pending = "";
        }
        yield evt;
      } else {
        yield evt;
      }
    }
    if (pending) {
      yield { type: inThink ? "thinking" : "text", delta: pending };
    }
  }
}
