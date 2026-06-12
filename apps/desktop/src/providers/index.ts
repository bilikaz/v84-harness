// Public face of the provider layer — a barrel only (naming convention rule 5).
// The consumer-facing API lives in client.ts; the shared vocabulary in types.ts.
export {
  streamModel,
  listModels,
  listModelInfos,
  defaultBaseUrl,
  collectText,
  healCorrection,
  MAX_HEAL_ATTEMPTS,
  type ModelInfo,
} from "./client.ts";
export { ask, type AskOptions, type AskResult, type AskTarget } from "./ask.ts";
export { askImage, askVideo, type AskMediaResult, type ImageAsk, type VideoAsk } from "./media.ts";
export type { ChatMessage, MediaApiFlavor, MediaTarget, ModelConfig, ProviderKind, StreamEvent, StreamUsage, ToolSpec } from "./types.ts";
