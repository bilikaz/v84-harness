// Renderer app init — the owners populate config.llm, then the singleton ctx reads it live.
// (The main process builds its own Ctx from the Config that crosses the bridge.)

import { Ctx } from "./ctx.ts";
import { getConfig } from "./config/index.ts";
import { syncMainToConfigLLM } from "./settings.ts";
import { syncMediaToConfigLLM } from "./media.ts";

syncMainToConfigLLM();
syncMediaToConfigLLM();

export const ctx = new Ctx(getConfig);
