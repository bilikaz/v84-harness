// Public face of the provider layer — a barrel only (naming convention rule 5).
// The consumer-facing API lives in client.ts; the shared vocabulary in types.ts.
export {
  streamModel,
  listModels,
  listModelInfos,
  defaultBaseUrl,
  collectText,
  chatOnce,
  healLoop,
  healCorrection,
  MAX_HEAL_ATTEMPTS,
  type HealMessage,
  type ModelInfo,
} from "./client.ts";
export type { ChatMessage, ModelConfig, ProviderKind, StreamEvent, StreamUsage, ToolSpec } from "./types.ts";
