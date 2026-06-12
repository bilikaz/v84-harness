// Cross-cutting helpers shared by the tools — mechanics, not contract (the
// vocabulary lives in types.ts per conventions/types-placement.md).

import type { ChatMessage, ModelConfig } from "../../providers/types.ts";
import { collectText } from "../../providers/client.ts";
import type { MediaModelConfig } from "./types.ts";

// 64 KB per tool result is plenty; truncate beyond so a runaway command can't
// blow up the model's context.
export const OUTPUT_CAP = 64 * 1024;

export function cap(s: string): string {
  if (s.length <= OUTPUT_CAP) return s;
  return s.slice(0, OUTPUT_CAP) + `\n\n[...output truncated; ${s.length - OUTPUT_CAP} more bytes dropped]`;
}

// One chat call against a media-registry model. A tool says WHICH model (its
// ToolCtx slot config) and WHAT to ask — the registry→provider translation
// and the transport (retry, SSE, think-demux) are not its business. Media
// models on the chat path are OpenAI-compatible by construction (the registry
// gates that), so the mapping is fixed.
export async function mediaChat(opts: {
  media: MediaModelConfig;
  message: ChatMessage;
  system?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const cfg: ModelConfig = {
    id: opts.media.id,
    label: opts.media.label,
    provider: "openai",
    baseUrl: opts.media.baseUrl,
    model: opts.media.model ?? "",
    apiKey: opts.media.apiKey ?? "",
  };
  const { text } = await collectText(cfg, [opts.message], opts.signal ?? new AbortController().signal, opts.system);
  return text.trim();
}
