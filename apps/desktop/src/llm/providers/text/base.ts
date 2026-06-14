// Abstract text provider — subclasses implement stream() wire mapping.

import type { ResponseHandler, StreamEvent, ToolSpec } from "../../types.ts";
import { withRetry } from "../../transport.ts";
import { BaseProvider } from "../base.ts";
import { textHandler } from "../../responseHandlers/text.ts";

export abstract class BaseTextProvider extends BaseProvider {
  protected abstract stream(): AsyncGenerator<StreamEvent>;

  call<T>(handler: ResponseHandler<T>): Promise<T> {
    return handler.handle({
      kind: "chat",
      events: this.demuxInlineThink(withRetry(() => this.stream(), this.callCtx.signal)),
    });
  }

  defaultHandler(): ResponseHandler<unknown> {
    return textHandler();
  }

  protected tools(): ToolSpec[] | undefined {
    return this.callCtx.tools?.length ? this.callCtx.tools : undefined;
  }

  private static readonly OPEN_TAGS = [" thinking", "<thinking>"];
  private static readonly CLOSE_TAGS = [" response", "</thinking>"];

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
