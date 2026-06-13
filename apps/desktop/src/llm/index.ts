// Public face of the LLM layer.
export { createClient, listProviderModels, HealError, healCorrection, type CallOptions, type LLMClient, type ConfigSource } from "./client/index.ts";
export type { ChatOutcome } from "./client/types.ts";
export { textHandler, bufferedTextHandler, bufferEvents } from "./responseHandlers/text.ts";
export { jsonHandler } from "./responseHandlers/json.ts";
export { imageHandler } from "./responseHandlers/image.ts";
export { videoHandler } from "./responseHandlers/video.ts";
export type {
  ResponseHandler,
  ModelInfo,
  ConfigLLM,
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
