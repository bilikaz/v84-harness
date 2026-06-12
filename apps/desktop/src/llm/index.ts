// Public face of the LLM layer — a barrel only (naming convention rule 5),
// and the ONLY barrel: the modality folders need none (the client's factory
// resolves provider files directly; bases live in each folder's base.ts).
// Exports are exactly what the outside world consumes: the client, the
// standard handlers, the settings-side model catalogs, and the vocabulary
// types. Provider classes are deliberately NOT exported — nothing outside
// the llm layer talks to a provider except through client.call().
export { createClient, listProviderModels, HealError, healCorrection, type CallOptions, type Client, type ConfigSource } from "./client/index.ts";
export type { ChatOutcome } from "./client/types.ts";
export { textHandler, bufferedTextHandler, bufferEvents } from "./responseHandlers/text.ts";
export { jsonHandler } from "./responseHandlers/json.ts";
export { imageHandler } from "./responseHandlers/image.ts";
export { videoHandler } from "./responseHandlers/video.ts";
export type {
  ResponseHandler,
  ModelInfo,
  CallTarget,
  ChatMessage,
  GenParams,
  MediaApiFlavor,
  MediaService,
  ModelService,
  ProviderKind,
  ProviderType,
  StreamEvent,
  StreamUsage,
  ToolSpec,
} from "./types.ts";
